import { useEffect, useRef } from 'react';
import { trpc } from '../lib/trpc';

/**
 * Background Sync Hook
 * 
 * Implements periodic retry of failed sync operations.
 * 
 * Requirements: 4.3, 5.4, 6.4, 9.3, 11.3
 * 
 * Features:
 * - Checks sync queue every 30 seconds
 * - Processes pending operations that are ready for retry
 * - Respects exponential backoff timing (handled by sync engine)
 * - Updates sync status after processing
 * - Runs only when Google is connected
 * - Pauses when tab is not visible (saves resources)
 * 
 * Usage:
 * ```tsx
 * function App() {
 *   useBackgroundSync();
 *   // ... rest of app
 * }
 * ```
 */

const RETRY_INTERVAL_MS = 30000; // 30 seconds

export function useBackgroundSync() {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingRef = useRef(false);

  // Get sync status to check if connected
  const { data: syncStatus } = trpc.sync.getSyncStatus.useQuery(undefined, {
    refetchInterval: RETRY_INTERVAL_MS,
    refetchOnWindowFocus: false,
  });

  // Retry mutation
  const retryFailedOperations = trpc.sync.retryFailedOperations.useMutation();

  /**
   * Process retry queue
   * 
   * Called periodically to retry failed operations.
   * Only runs if:
   * - Google is connected
   * - Not already processing
   * - There are pending operations
   */
  const processRetryQueue = async () => {
    // Skip if already processing
    if (isProcessingRef.current) {
      return;
    }

    // Skip if not connected
    const isConnected = syncStatus?.isConnected ?? false;
    if (!isConnected) {
      return;
    }

    // Skip if no pending operations
    const hasPendingOps = (syncStatus?.pendingOperations ?? 0) > 0;
    if (!hasPendingOps) {
      return;
    }

    // Mark as processing
    isProcessingRef.current = true;

    try {
      await retryFailedOperations.mutateAsync();
      console.log('Background sync: Retry queue processed successfully');
    } catch (error) {
      // Log error but don't crash
      console.error('Background sync: Failed to process retry queue:', error);
    } finally {
      // Mark as not processing
      isProcessingRef.current = false;
    }
  };

  /**
   * Set up background worker
   * 
   * Runs every 30 seconds to check for pending operations.
   * Pauses when tab is not visible to save resources.
   */
  useEffect(() => {
    // Only start if connected
    const isConnected = syncStatus?.isConnected ?? false;
    if (!isConnected) {
      return;
    }

    // Start interval
    intervalRef.current = setInterval(() => {
      // Only process if tab is visible
      if (document.visibilityState === 'visible') {
        processRetryQueue();
      }
    }, RETRY_INTERVAL_MS);

    // Cleanup on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [syncStatus?.isConnected, syncStatus?.pendingOperations]);

  /**
   * Handle visibility change
   * 
   * When tab becomes visible, immediately check for pending operations.
   * This ensures we don't wait up to 30 seconds after user returns.
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Tab became visible - check for pending operations
        processRetryQueue();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [syncStatus?.isConnected, syncStatus?.pendingOperations]);
}
