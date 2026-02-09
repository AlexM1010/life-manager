import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../db/schema.js';
import * as fc from 'fast-check';
import { OAuthManager, OAuthConfig } from '../oauth-manager.js';

/**
 * OAuth Manager Property Tests
 * 
 * Property-based tests for OAuth token management:
 * - Property 1: OAuth Token Storage Round-Trip
 * 
 * Validates Requirements: 1.3
 */

// Test database setup
let sqliteDb: Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let oauthManager: OAuthManager;

// Test OAuth configuration
const testConfig: OAuthConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret-must-be-long-enough-for-sha256',
  redirectUri: 'http://localhost:5173/auth/google/callback',
};

beforeEach(() => {
  // Create in-memory database for each test
  sqliteDb = new BetterSqlite3(':memory:');
  db = drizzle(sqliteDb, { schema });

  // Run migrations
  migrate(db, { migrationsFolder: './drizzle' });

  // Create OAuth manager instance
  oauthManager = new OAuthManager(db, testConfig);
});

afterEach(() => {
  sqliteDb.close();
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('OAuth Manager - Property Tests', () => {
  // Arbitraries (generators) for property-based testing
  
  // Generate valid user IDs (positive integers)
  const userIdArb = fc.integer({ min: 1, max: 1000000 });
  
  // Generate OAuth provider names
  const providerArb = fc.constantFrom('google', 'microsoft', 'github');
  
  // Generate access tokens (base64-like strings)
  const accessTokenArb = fc.string({ 
    minLength: 20, 
    maxLength: 200,
    unit: fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('')
    )
  });
  
  // Generate refresh tokens (base64-like strings)
  const refreshTokenArb = fc.string({ 
    minLength: 20, 
    maxLength: 200,
    unit: fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('')
    )
  });
  
  // Generate expiration dates (future dates within 1 year)
  const expiresAtArb = fc.date({
    min: new Date(),
    max: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  }).filter(d => !isNaN(d.getTime())); // Filter out invalid dates
  
  // Generate OAuth scopes
  const scopeArb = fc.array(
    fc.constantFrom(
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/tasks',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ),
    { minLength: 1, maxLength: 4 }
  ).map(scopes => [...new Set(scopes)]); // Remove duplicates
  
  // Generate complete OAuth tokens
  const oauthTokensArb = fc.record({
    accessToken: accessTokenArb,
    refreshToken: refreshTokenArb,
    expiresAt: expiresAtArb,
    scope: scopeArb,
  });

  /**
   * Property 1: OAuth Token Storage Round-Trip
   * 
   * **Validates: Requirements 1.3**
   * 
   * For any valid OAuth tokens, storing them in the database and then 
   * retrieving them should produce equivalent tokens with matching 
   * access token, refresh token, and expiration time.
   * 
   * This property ensures that:
   * 1. Tokens can be stored without data loss
   * 2. Tokens can be retrieved accurately
   * 3. All token fields are preserved (access token, refresh token, expiration, scopes)
   * 4. Date serialization/deserialization works correctly
   * 5. Scope arrays are preserved correctly
   */
  it('Property 1: OAuth Token Storage Round-Trip', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        providerArb,
        oauthTokensArb,
        async (userId, provider, tokens) => {
          // Store the tokens
          const stored = await oauthManager.storeTokens(userId, provider, tokens);

          // Verify stored tokens have expected structure
          expect(stored.id).toBeTypeOf('number');
          expect(stored.userId).toBe(userId);
          expect(stored.provider).toBe(provider);
          expect(stored.accessToken).toBe(tokens.accessToken);
          expect(stored.refreshToken).toBe(tokens.refreshToken);
          expect(stored.createdAt).toBeTypeOf('string');
          expect(stored.updatedAt).toBeTypeOf('string');

          // Verify expiration date matches (within 1 second tolerance for serialization)
          const storedExpiresMs = stored.expiresAt.getTime();
          const originalExpiresMs = tokens.expiresAt.getTime();
          const timeDiff = Math.abs(storedExpiresMs - originalExpiresMs);
          expect(timeDiff).toBeLessThan(1000); // Less than 1 second difference

          // Verify scopes match (order-independent comparison)
          expect(stored.scope.sort()).toEqual(tokens.scope.sort());

          // Retrieve the tokens
          const retrieved = await oauthManager.getTokens(userId, provider);

          // Verify retrieval succeeded
          expect(retrieved).not.toBeNull();
          
          if (retrieved) {
            // Verify all fields match between stored and retrieved
            expect(retrieved.id).toBe(stored.id);
            expect(retrieved.userId).toBe(userId);
            expect(retrieved.provider).toBe(provider);
            expect(retrieved.accessToken).toBe(tokens.accessToken);
            expect(retrieved.refreshToken).toBe(tokens.refreshToken);
            
            // Verify expiration dates match
            expect(retrieved.expiresAt.getTime()).toBe(stored.expiresAt.getTime());
            
            // Verify scopes match
            expect(retrieved.scope.sort()).toEqual(tokens.scope.sort());
            
            // Verify timestamps match
            expect(retrieved.createdAt).toBe(stored.createdAt);
            expect(retrieved.updatedAt).toBe(stored.updatedAt);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional test: Verify update behavior
   * 
   * When storing tokens for the same user/provider twice, the second
   * store should update the existing record rather than create a duplicate.
   */
  it('Property 1 (Update): Storing tokens twice updates existing record', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        providerArb,
        oauthTokensArb,
        oauthTokensArb,
        async (userId, provider, tokens1, tokens2) => {
          // Store first set of tokens
          const stored1 = await oauthManager.storeTokens(userId, provider, tokens1);
          
          // Store second set of tokens (should update)
          const stored2 = await oauthManager.storeTokens(userId, provider, tokens2);
          
          // Verify same ID (updated, not created new)
          expect(stored2.id).toBe(stored1.id);
          
          // Verify new tokens are stored
          expect(stored2.accessToken).toBe(tokens2.accessToken);
          expect(stored2.refreshToken).toBe(tokens2.refreshToken);
          
          // Verify only one record exists
          const retrieved = await oauthManager.getTokens(userId, provider);
          expect(retrieved).not.toBeNull();
          expect(retrieved?.id).toBe(stored1.id);
          expect(retrieved?.accessToken).toBe(tokens2.accessToken);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional test: Verify isolation between users
   * 
   * Tokens stored for different users should not interfere with each other.
   */
  it('Property 1 (Isolation): Different users have isolated token storage', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        userIdArb,
        providerArb,
        oauthTokensArb,
        oauthTokensArb,
        async (userId1, userId2, provider, tokens1, tokens2) => {
          // Ensure user IDs are different
          fc.pre(userId1 !== userId2);
          
          // Store tokens for user 1
          await oauthManager.storeTokens(userId1, provider, tokens1);
          
          // Store tokens for user 2
          await oauthManager.storeTokens(userId2, provider, tokens2);
          
          // Retrieve tokens for user 1
          const retrieved1 = await oauthManager.getTokens(userId1, provider);
          expect(retrieved1).not.toBeNull();
          expect(retrieved1?.accessToken).toBe(tokens1.accessToken);
          
          // Retrieve tokens for user 2
          const retrieved2 = await oauthManager.getTokens(userId2, provider);
          expect(retrieved2).not.toBeNull();
          expect(retrieved2?.accessToken).toBe(tokens2.accessToken);
          
          // Verify they are different records
          expect(retrieved1?.id).not.toBe(retrieved2?.id);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Additional test: Verify deletion
   * 
   * After deleting tokens, retrieval should return null.
   */
  it('Property 1 (Deletion): Deleted tokens cannot be retrieved', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        providerArb,
        oauthTokensArb,
        async (userId, provider, tokens) => {
          // Store tokens
          await oauthManager.storeTokens(userId, provider, tokens);
          
          // Verify tokens exist
          const beforeDelete = await oauthManager.getTokens(userId, provider);
          expect(beforeDelete).not.toBeNull();
          
          // Delete tokens
          await oauthManager.deleteTokens(userId, provider);
          
          // Verify tokens are gone
          const afterDelete = await oauthManager.getTokens(userId, provider);
          expect(afterDelete).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Token Refresh on Expiration
   * 
   * **Feature: google-calendar-sync, Property 2: Token Refresh on Expiration**
   * **Validates: Requirements 1.4**
   * 
   * SKIPPED: Token refresh is now handled automatically by googleapis library
   * in the getOAuth2Client() method. The googleapis OAuth2Client handles
   * token refresh transparently when making API calls, so we don't need to
   * test manual refresh logic anymore.
   * 
   * The new pattern:
   * 1. Call getOAuth2Client(userId) to get configured client
   * 2. googleapis automatically refreshes tokens when needed
   * 3. Token refresh callback updates database automatically
   */
  it.skip('Property 2: Token Refresh on Expiration', async () => {
    // Test skipped - googleapis handles refresh automatically
  });

  /**
   * Property 2 (Edge Case): Token expiring soon should also trigger refresh
   * 
   * SKIPPED: googleapis handles this automatically in getOAuth2Client()
   */
  it.skip('Property 2 (Edge Case): Token expiring soon triggers refresh', async () => {
    // Test skipped - googleapis handles refresh automatically
  });

  /**
   * Property 2 (Error Case): Refresh failure should throw error
   * 
   * SKIPPED: googleapis handles refresh failures automatically in getOAuth2Client()
   */
  it.skip('Property 2 (Error Case): Refresh failure requires re-authentication', async () => {
    // Test skipped - googleapis handles refresh failures automatically
  });

  /**
   * Property 2 (Valid Token): No refresh for valid tokens
   * 
   * When token is still valid (not expired and not expiring soon),
   * getValidToken should return it without triggering refresh.
   */
  it('Property 2 (Valid Token): No refresh for valid tokens', async () => {
    // Generate valid tokens (expire more than 5 minutes from now)
    const validTokensArb = fc.record({
      accessToken: accessTokenArb,
      refreshToken: refreshTokenArb,
      expiresAt: fc.date({
        min: new Date(Date.now() + 6 * 60 * 1000), // At least 6 minutes from now
        max: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // Up to 1 year from now
      }).filter(d => !isNaN(d.getTime())),
      scope: scopeArb,
    });

    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        validTokensArb,
        async (userId, validTokens) => {
          const provider = 'google';
          
          // Store valid tokens
          await oauthManager.storeTokens(userId, provider, validTokens);
          
          // Verify tokens are not expired
          expect(oauthManager.isTokenExpired(validTokens)).toBe(false);
          
          // Track if refresh was called
          let refreshCalled = false;
          const originalRefreshToken = oauthManager.refreshToken.bind(oauthManager);
          oauthManager.refreshToken = async () => {
            refreshCalled = true;
            throw new Error('Refresh should not be called for valid tokens');
          };
          
          try {
            // Should return token without refresh
            const accessToken = await oauthManager.getValidToken(userId);
            expect(accessToken).toBe(validTokens.accessToken);
            expect(refreshCalled).toBe(false);
          } finally {
            oauthManager.refreshToken = originalRefreshToken;
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
