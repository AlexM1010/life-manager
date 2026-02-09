import { useState, useEffect } from 'react';
import { trpc } from '../lib/trpc';

/**
 * GoogleSyncSettings Component
 * 
 * Provides Google Calendar/Tasks sync controls:
 * - Connect/Disconnect Google account
 * - Manual re-import button
 * - Sync status indicators
 * - Last sync time display
 * - Pending operations count
 * - Failed operations with retry button
 * 
 * Requirements: 1.1, 2.2, 3.2, 9.5, 12.1, 12.2, 12.5
 */

interface GoogleSyncSettingsProps {
  className?: string;
}

export function GoogleSyncSettings({ className = '' }: GoogleSyncSettingsProps) {
  const utils = trpc.useUtils();
  const [isConnecting, setIsConnecting] = useState(false);

  // Get sync status
  const { data: syncStatus, isLoading: statusLoading } = trpc.sync.getSyncStatus.useQuery(
    undefined,
    {
      refetchInterval: 10000, // Refresh every 10 seconds
    }
  );

  // Mutations
  const initiateAuth = trpc.sync.initiateAuth.useMutation();
  const disconnectGoogle = trpc.sync.disconnectGoogle.useMutation({
    onSuccess: () => {
      utils.sync.getSyncStatus.invalidate();
    },
  });
  const importFromGoogle = trpc.sync.importFromGoogle.useMutation({
    onSuccess: () => {
      utils.sync.getSyncStatus.invalidate();
      utils.task.list.invalidate();
    },
  });
  const retryFailedOperations = trpc.sync.retryFailedOperations.useMutation({
    onSuccess: () => {
      utils.sync.getSyncStatus.invalidate();
    },
  });

  // Complete auth mutation
  const completeAuth = trpc.sync.completeAuth.useMutation({
    onSuccess: () => {
      window.history.replaceState({}, document.title, window.location.pathname);
      utils.sync.getSyncStatus.invalidate();
      setIsConnecting(false);
    },
    onError: (error) => {
      console.error('Failed to complete auth:', error);
      alert('Failed to connect Google account. Please try again.');
      window.history.replaceState({}, document.title, window.location.pathname);
      setIsConnecting(false);
    },
  });

  // Handle OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    
    if (code && !isConnecting) {
      setIsConnecting(true);
      completeAuth.mutate({ code });
    }
  }, []);

  // Handle connect button
  const handleConnect = async () => {
    try {
      const result = await initiateAuth.mutateAsync();
      if (result.authUrl) {
        // Redirect to Google OAuth
        window.location.href = result.authUrl;
      }
    } catch (error) {
      console.error('Failed to initiate auth:', error);
      alert('Failed to start Google authentication. Please try again.');
    }
  };

  // Handle disconnect button
  const handleDisconnect = async () => {
    if (!confirm('Disconnect Google account? You can reconnect anytime.')) {
      return;
    }
    
    try {
      await disconnectGoogle.mutateAsync();
    } catch (error) {
      console.error('Failed to disconnect:', error);
      alert('Failed to disconnect Google account. Please try again.');
    }
  };

  // Handle manual import
  const handleImport = async () => {
    try {
      const result = await importFromGoogle.mutateAsync();
      const errorDetails = result.errors?.length > 0
        ? `\n\nErrors (${result.errors.length}):\n${result.errors.slice(0, 5).map((e: any) => `• ${e.entityType} ${e.entityId}: ${e.error}`).join('\n')}${result.errors.length > 5 ? `\n...and ${result.errors.length - 5} more` : ''}`
        : '';
      alert(
        `Import complete!\n\n` +
        `Calendar events: ${result.calendarEventsImported}\n` +
        `Tasks: ${result.tasksImported}\n` +
        `${result.conflicts.length > 0 ? `\nConflicts detected: ${result.conflicts.length}` : ''}` +
        errorDetails
      );
    } catch (error) {
      console.error('Failed to import:', error);
      alert('Failed to import from Google. Please check your connection and try again.');
    }
  };

  // Handle retry failed operations
  const handleRetry = async () => {
    try {
      await retryFailedOperations.mutateAsync();
    } catch (error) {
      console.error('Failed to retry:', error);
      alert('Failed to retry operations. Please try again.');
    }
  };

  // Loading state
  if (statusLoading || isConnecting) {
    return (
      <div className={`p-6 bg-card rounded-lg border ${className}`}>
        <h3 className="text-lg font-semibold mb-4">Google Calendar Sync</h3>
        <p className="text-muted-foreground">
          {isConnecting ? 'Connecting to Google...' : 'Loading sync status...'}
        </p>
      </div>
    );
  }

  const isConnected = syncStatus?.isConnected ?? false;
  const hasTokens = syncStatus?.hasTokens ?? false;
  const connectionError = syncStatus?.connectionError;
  const hasPendingOps = (syncStatus?.pendingOperations ?? 0) > 0;
  const hasFailedOps = (syncStatus?.failedOperations?.length ?? 0) > 0;
  
  // Broken connection: tokens exist but can't connect (refresh failed, etc.)
  const isBrokenConnection = hasTokens && !isConnected;

  return (
    <div className={`p-6 bg-card rounded-lg border ${className}`}>
      <h3 className="text-lg font-semibold mb-4">Google Calendar Sync</h3>

      {/* Connection Status */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div
            className={`w-3 h-3 rounded-full ${
              isConnected ? 'bg-green-500' : 'bg-gray-300'
            }`}
          />
          <span className="font-medium">
            {isConnected ? 'Connected' : 'Not Connected'}
          </span>
        </div>

        {isConnected ? (
          <div className="space-y-3">
            {/* Last Sync Time */}
            {syncStatus?.lastSyncTime && (
              <div className="text-sm text-muted-foreground">
                Last sync: {formatDateTime(syncStatus.lastSyncTime)}
              </div>
            )}

            {/* Pending Operations */}
            {hasPendingOps && (
              <div className="flex items-center gap-2 text-sm">
                <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                <span className="text-yellow-700">
                  {syncStatus.pendingOperations} operation{syncStatus.pendingOperations !== 1 ? 's' : ''} pending
                </span>
              </div>
            )}

            {/* Failed Operations */}
            {hasFailedOps && (
              <div className="p-3 bg-red-50 border border-red-200 rounded">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-red-800">
                    {syncStatus.failedOperations.length} failed operation{syncStatus.failedOperations.length !== 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={handleRetry}
                    disabled={retryFailedOperations.isPending}
                    className="px-3 py-1 text-xs font-medium text-red-700 hover:text-red-800
                             border border-red-300 hover:border-red-400 rounded transition-colors
                             disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {retryFailedOperations.isPending ? 'Retrying...' : 'Retry All'}
                  </button>
                </div>
                <div className="space-y-1">
                  {syncStatus.failedOperations.slice(0, 3).map((error, idx) => (
                    <div key={idx} className="text-xs text-red-700">
                      {error.operation} {error.entityType} failed: {error.error}
                    </div>
                  ))}
                  {syncStatus.failedOperations.length > 3 && (
                    <div className="text-xs text-red-600">
                      ...and {syncStatus.failedOperations.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-3">
              <button
                onClick={handleImport}
                disabled={importFromGoogle.isPending}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium
                         hover:bg-primary/90 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importFromGoogle.isPending ? 'Importing...' : 'Re-import from Google'}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnectGoogle.isPending}
                className="px-4 py-2 border border-input rounded-lg font-medium
                         hover:bg-muted transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {disconnectGoogle.isPending ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        ) : isBrokenConnection ? (
          /* Broken connection: tokens exist but refresh failed */
          <div className="space-y-3">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded">
              <p className="text-sm font-medium text-amber-800 mb-1">
                Connection expired
              </p>
              <p className="text-xs text-amber-700">
                {connectionError || 'Your Google connection needs to be refreshed.'}
              </p>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={handleConnect}
                disabled={initiateAuth.isPending}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium
                         hover:bg-primary/90 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {initiateAuth.isPending ? 'Connecting...' : 'Reconnect Google'}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnectGoogle.isPending}
                className="px-4 py-2 border border-input rounded-lg font-medium
                         hover:bg-muted transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {disconnectGoogle.isPending ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect your Google account to sync calendar events and tasks with Life Manager.
            </p>
            <button
              onClick={handleConnect}
              disabled={initiateAuth.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium
                       hover:bg-primary/90 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {initiateAuth.isPending ? 'Connecting...' : 'Connect Google Account'}
            </button>
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h4 className="text-sm font-semibold text-blue-900 mb-2">How it works</h4>
        <ul className="text-xs text-blue-800 space-y-1">
          <li>• Calendar events become Fixed Tasks (cannot be rescheduled)</li>
          <li>• Google Tasks become Flexible Tasks (can be rescheduled)</li>
          <li>• Changes in Life Manager sync back to Google automatically</li>
          <li>• Import runs automatically each morning</li>
        </ul>
      </div>
    </div>
  );
}

/**
 * Helper function to format datetime
 */
function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}
