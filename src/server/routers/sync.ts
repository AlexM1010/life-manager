import { router, publicProcedure } from '../trpc.js';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { OAuthManager, OAuthConfig } from '../services/oauth-manager.js';
import { SyncEngine } from '../services/sync-engine.js';

/**
 * Get OAuth config from environment variables
 */
function getOAuthConfig(): OAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5173/auth/google/callback';

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing Google OAuth credentials. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env'
    );
  }

  return { clientId, clientSecret, redirectUri };
}

/**
 * Sync Router
 * 
 * Provides Google Calendar/Tasks sync operations:
 * - initiateAuth: Start OAuth flow
 * - completeAuth: Complete OAuth flow and store tokens
 * - disconnectGoogle: Revoke tokens and disconnect
 * - importFromGoogle: Import calendar events and tasks (morning import)
 * - getSyncStatus: Get current sync status
 * - retryFailedOperations: Retry failed sync operations
 * 
 * Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 9.2, 9.5
 */
export const syncRouter = router({
  /**
   * Initiate Google OAuth flow
   * 
   * Returns authorization URL for user to visit.
   * User will be redirected back with authorization code.
   * 
   * Requirement 1.1: Redirect to Google's OAuth 2.0 consent screen
   */
  initiateAuth: publicProcedure
    .mutation(async ({ ctx }) => {
      try {
        const oauthManager = new OAuthManager(ctx.db, getOAuthConfig());
        const result = oauthManager.initiateAuth();
        
        return {
          success: true,
          authUrl: result.authUrl,
        };
      } catch (error) {
        console.error('Failed to initiate auth:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to initiate Google authentication',
        });
      }
    }),

  /**
   * Complete OAuth flow
   * 
   * Exchanges authorization code for tokens and stores them securely.
   * 
   * Requirements: 1.2, 1.3
   */
  completeAuth: publicProcedure
    .input(z.object({
      code: z.string().min(1, 'Authorization code is required'),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        // TODO: Get actual userId from context when auth is implemented
        const userId = 1; // Hardcoded for single-user app
        
        const oauthManager = new OAuthManager(ctx.db, getOAuthConfig());
        
        // Exchange code for tokens
        const tokens = await oauthManager.exchangeCode(input.code);
        
        // Store tokens securely
        await oauthManager.storeTokens(userId, 'google', tokens);
        
        return {
          success: true,
          message: 'Google account connected successfully',
        };
      } catch (error) {
        console.error('Failed to complete auth:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to complete authentication',
        });
      }
    }),

  /**
   * Disconnect Google account
   * 
   * Revokes OAuth tokens and removes them from database.
   */
  disconnectGoogle: publicProcedure
    .mutation(async ({ ctx }) => {
      try {
        // TODO: Get actual userId from context when auth is implemented
        const userId = 1; // Hardcoded for single-user app
        
        const oauthManager = new OAuthManager(ctx.db, getOAuthConfig());
        await oauthManager.revokeTokens(userId);
        
        return {
          success: true,
          message: 'Google account disconnected successfully',
        };
      } catch (error) {
        console.error('Failed to disconnect Google:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to disconnect Google account',
        });
      }
    }),

  /**
   * Import from Google (morning import)
   * 
   * Imports today's calendar events and tasks from Google.
   * This is a one-way sync: Google → Life Manager.
   * 
   * Requirements: 2.1, 2.2, 3.1, 3.2
   */
  importFromGoogle: publicProcedure
    .mutation(async ({ ctx }) => {
      try {
        // TODO: Get actual userId from context when auth is implemented
        const userId = 1; // Hardcoded for single-user app
        const defaultDomainId = 1;
        
        const oauthManager = new OAuthManager(ctx.db, getOAuthConfig());
        const syncEngine = new SyncEngine(ctx.db, oauthManager, userId, defaultDomainId);
        
        const result = await syncEngine.importFromGoogle();
        
        return {
          success: true,
          calendarEventsImported: result.calendarEventsImported,
          tasksImported: result.tasksImported,
          conflicts: result.conflicts,
          errors: result.errors,
        };
      } catch (error) {
        console.error('Failed to import from Google:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to import from Google',
        });
      }
    }),

  /**
   * Get sync status
   * 
   * Returns current sync status including:
   * - Connection status
   * - Last sync time
   * - Pending operations count
   * - Failed operations
   * 
   * Requirement 9.2: Display sync status indicators
   */
  getSyncStatus: publicProcedure
    .query(async ({ ctx }) => {
      try {
        // TODO: Get actual userId from context when auth is implemented
        const userId = 1; // Hardcoded for single-user app
        const defaultDomainId = 1;
        
        const oauthManager = new OAuthManager(ctx.db, getOAuthConfig());
        const syncEngine = new SyncEngine(ctx.db, oauthManager, userId, defaultDomainId);
        
        const status = await syncEngine.getSyncStatus();
        
        return {
          isConnected: status.isConnected,
          hasTokens: status.hasTokens,
          connectionError: status.connectionError,
          lastSyncTime: status.lastSyncTime?.toISOString(),
          pendingOperations: status.pendingOperations,
          failedOperations: status.failedOperations.map(err => ({
            operation: err.operation,
            entityType: err.entityType,
            entityId: err.entityId,
            error: err.error,
            timestamp: err.timestamp.toISOString(),
            retryCount: err.retryCount,
          })),
        };
      } catch (error) {
        console.error('Failed to get sync status:', error);
        // Return disconnected status on error
        return {
          isConnected: false,
          hasTokens: false,
          connectionError: undefined,
          lastSyncTime: undefined,
          pendingOperations: 0,
          failedOperations: [],
        };
      }
    }),

  /**
   * Retry failed operations
   * 
   * Manually triggers retry of all failed sync operations.
   * 
   * Requirement 9.5: Manual retry button for failed operations
   */
  retryFailedOperations: publicProcedure
    .mutation(async ({ ctx }) => {
      try {
        // TODO: Get actual userId from context when auth is implemented
        const userId = 1; // Hardcoded for single-user app
        const defaultDomainId = 1;
        
        const oauthManager = new OAuthManager(ctx.db, getOAuthConfig());
        const syncEngine = new SyncEngine(ctx.db, oauthManager, userId, defaultDomainId);
        
        await syncEngine.retryFailedOperations();
        
        return {
          success: true,
          message: 'Retry initiated for failed operations',
        };
      } catch (error) {
        console.error('Failed to retry operations:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retry operations',
        });
      }
    }),
});
