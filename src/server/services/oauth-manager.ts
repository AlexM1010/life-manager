import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { oauthTokens } from '../db/schema.js';
import { google } from 'googleapis';
import crypto from 'crypto';

/**
 * OAuth Manager
 * 
 * Handles OAuth token storage, retrieval, and refresh for Google Calendar/Tasks sync.
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

// Encryption configuration
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY_LENGTH = 32; // 256 bits

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string[];
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface StoredOAuthTokens extends OAuthTokens {
  id: number;
  userId: number;
  provider: string;
  createdAt: string;
  updatedAt: string;
}

export class OAuthManager {
  private oauth2Client: any;
  private encryptionKey: Buffer;

  constructor(
    private db: ReturnType<typeof drizzle<typeof schema>>,
    private config: OAuthConfig,
    encryptionKey?: string
  ) {
    // Initialize Google OAuth2 client
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );

    // Initialize encryption key (use provided key or generate from client secret)
    if (encryptionKey) {
      this.encryptionKey = Buffer.from(encryptionKey, 'hex');
    } else {
      // Derive encryption key from client secret (for backward compatibility)
      this.encryptionKey = crypto
        .createHash('sha256')
        .update(config.clientSecret)
        .digest();
    }

    if (this.encryptionKey.length !== ENCRYPTION_KEY_LENGTH) {
      throw new Error(`Encryption key must be ${ENCRYPTION_KEY_LENGTH} bytes`);
    }
  }

  /**
   * Initiate OAuth flow by generating authorization URL
   * 
   * Validates: Requirements 1.1
   * 
   * @returns Authorization URL for user to visit
   */
  initiateAuth(): { authUrl: string } {
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/tasks',
    ];

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline', // Request refresh token
      scope: scopes,
      prompt: 'consent', // Force consent screen to get refresh token
    });

    return { authUrl };
  }

  /**
   * Exchange authorization code for OAuth tokens
   * 
   * Validates: Requirements 1.2
   * 
   * @param code - Authorization code from Google OAuth callback
   * @returns OAuth tokens (access token, refresh token, expiration)
   */
  async exchangeCode(code: string): Promise<OAuthTokens> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);

      if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
        throw new Error('Invalid token response from Google');
      }

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(tokens.expiry_date),
        scope: tokens.scope?.split(' ') || [],
      };
    } catch (error) {
      throw new Error(`Failed to exchange authorization code: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Refresh expired access token using refresh token
   * 
   * Validates: Requirements 1.4
   * 
   * @param refreshToken - Refresh token
   * @returns New OAuth tokens
   */
  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    try {
      this.oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();

      if (!credentials.access_token || !credentials.expiry_date) {
        throw new Error('Invalid token response from Google');
      }

      return {
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token || refreshToken, // Use existing if not provided
        expiresAt: new Date(credentials.expiry_date),
        scope: credentials.scope?.split(' ') || [],
      };
    } catch (error) {
      throw new Error(`Failed to refresh token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get OAuth2 client configured with user's tokens
   * 
   * This method retrieves stored tokens and configures an OAuth2 client.
   * The googleapis library handles automatic token refresh transparently.
   * 
   * Validates: Requirements 1.4, 1.5
   * 
   * @param userId - User ID
   * @returns Configured OAuth2 client (auto-refreshes tokens)
   * @throws Error if tokens not found or refresh fails
   */
  async getOAuth2Client(userId: number): Promise<any> {
    const tokens = await this.getTokens(userId, 'google');

    if (!tokens) {
      throw new Error('No OAuth tokens found for user');
    }

    // Create a new OAuth2 client instance for this user
    const oauth2Client = new google.auth.OAuth2(
      this.config.clientId,
      this.config.clientSecret,
      this.config.redirectUri
    );

    // Set credentials - googleapis will auto-refresh when expired
    oauth2Client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiresAt.getTime(),
    });

    // Set up token refresh callback to update database
    oauth2Client.on('tokens', async (newTokens) => {
      if (newTokens.refresh_token) {
        // Full token refresh - update both access and refresh tokens
        await this.storeTokens(userId, 'google', {
          accessToken: newTokens.access_token!,
          refreshToken: newTokens.refresh_token,
          expiresAt: new Date(newTokens.expiry_date!),
          scope: tokens.scope, // Preserve existing scopes
        });
      } else if (newTokens.access_token) {
        // Access token refresh only - update access token and expiry
        await this.storeTokens(userId, 'google', {
          accessToken: newTokens.access_token,
          refreshToken: tokens.refreshToken, // Keep existing refresh token
          expiresAt: new Date(newTokens.expiry_date!),
          scope: tokens.scope,
        });
      }
    });

    return oauth2Client;
  }

  /**
   * Get valid access token, automatically refreshing if expired
   * 
   * DEPRECATED: Use getOAuth2Client() instead for automatic refresh handling.
   * This method is kept for backward compatibility.
   * 
   * Validates: Requirements 1.4
   * 
   * @param userId - User ID
   * @returns Valid access token
   * @throws Error if tokens not found or refresh fails
   */
  async getValidToken(userId: number): Promise<string> {
    const oauth2Client = await this.getOAuth2Client(userId);
    const credentials = oauth2Client.credentials;
    
    if (!credentials.access_token) {
      throw new Error('No access token available');
    }
    
    return credentials.access_token;
  }

  /**
   * Revoke OAuth tokens (disconnect Google account)
   * 
   * @param userId - User ID
   */
  async revokeTokens(userId: number): Promise<void> {
    const tokens = await this.getTokens(userId, 'google');

    if (tokens) {
      try {
        // Revoke token with Google
        await this.oauth2Client.revokeToken(tokens.accessToken);
      } catch (error) {
        // Log error but continue with deletion
        console.error('Failed to revoke token with Google:', error);
      }

      // Delete from database
      await this.deleteTokens(userId, 'google');
    }
  }

  /**
   * Encrypt a token for secure storage
   * 
   * @param token - Token to encrypt
   * @returns Encrypted token (format: iv:authTag:encryptedData)
   */
  private encryptToken(token: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Return format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt a token from storage
   * 
   * @param encryptedToken - Encrypted token (format: iv:authTag:encryptedData)
   * @returns Decrypted token
   */
  private decryptToken(encryptedToken: string): string {
    const parts = encryptedToken.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted token format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Store OAuth tokens in the database
   * 
   * Validates: Requirements 1.3
   * 
   * @param userId - User ID
   * @param provider - OAuth provider (e.g., 'google')
   * @param tokens - OAuth tokens to store
   * @returns Stored token record
   */
  async storeTokens(
    userId: number,
    provider: string,
    tokens: OAuthTokens
  ): Promise<StoredOAuthTokens> {
    const now = new Date().toISOString();
    
    // Encrypt tokens before storage
    const encryptedAccessToken = this.encryptToken(tokens.accessToken);
    const encryptedRefreshToken = this.encryptToken(tokens.refreshToken);
    
    // Check if tokens already exist for this user/provider
    const existing = await this.db
      .select()
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.userId, userId),
          eq(oauthTokens.provider, provider)
        )
      )
      .limit(1);

    const tokenData = {
      userId,
      provider,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiresAt: tokens.expiresAt.toISOString(),
      scope: JSON.stringify(tokens.scope),
      updatedAt: now,
    };

    if (existing.length > 0) {
      // Update existing tokens
      const [updated] = await this.db
        .update(oauthTokens)
        .set(tokenData)
        .where(eq(oauthTokens.id, existing[0].id))
        .returning();

      return this.deserializeTokens(updated);
    } else {
      // Insert new tokens
      const [inserted] = await this.db
        .insert(oauthTokens)
        .values({
          ...tokenData,
          createdAt: now,
        })
        .returning();

      return this.deserializeTokens(inserted);
    }
  }

  /**
   * Retrieve OAuth tokens from the database
   * 
   * Validates: Requirements 1.3
   * 
   * @param userId - User ID
   * @param provider - OAuth provider (e.g., 'google')
   * @returns Stored token record or null if not found
   */
  async getTokens(
    userId: number,
    provider: string
  ): Promise<StoredOAuthTokens | null> {
    const [tokens] = await this.db
      .select()
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.userId, userId),
          eq(oauthTokens.provider, provider)
        )
      )
      .limit(1);

    if (!tokens) {
      return null;
    }

    return this.deserializeTokens(tokens);
  }

  /**
   * Delete OAuth tokens from the database
   * 
   * @param userId - User ID
   * @param provider - OAuth provider (e.g., 'google')
   */
  async deleteTokens(userId: number, provider: string): Promise<void> {
    await this.db
      .delete(oauthTokens)
      .where(
        and(
          eq(oauthTokens.userId, userId),
          eq(oauthTokens.provider, provider)
        )
      );
  }

  /**
   * Check if access token is expired
   * 
   * @param tokens - OAuth tokens
   * @returns True if token is expired or will expire within 5 minutes
   */
  isTokenExpired(tokens: OAuthTokens): boolean {
    const now = new Date();
    const expiresAt = new Date(tokens.expiresAt);
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
    
    return expiresAt <= fiveMinutesFromNow;
  }

  /**
   * Deserialize stored tokens from database format
   * 
   * @param stored - Raw database record
   * @returns Deserialized tokens
   */
  private deserializeTokens(stored: any): StoredOAuthTokens {
    return {
      id: stored.id,
      userId: stored.userId,
      provider: stored.provider,
      accessToken: this.decryptToken(stored.accessToken),
      refreshToken: this.decryptToken(stored.refreshToken),
      expiresAt: new Date(stored.expiresAt),
      scope: JSON.parse(stored.scope),
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
  }
}
