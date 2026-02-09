import { useState, useEffect, useRef } from 'react';
import { trpc } from './lib/trpc';
import { TodayPlan } from './components/TodayPlan';
import { DomainList } from './components/DomainList';
import { TaskList } from './components/TaskList';
import { DailyLogForm } from './components/DailyLogForm';
import { StreakDisplay } from './components/StreakDisplay';
import { BalanceChart } from './components/BalanceChart';
import { GuardrailBanner } from './components/GuardrailBanner';
import { WeeklySummary } from './components/WeeklySummary';
import { GoogleSyncSettings } from './components/GoogleSyncSettings';
import { useBackgroundSync } from './hooks/useBackgroundSync';

/**
 * Life Manager App Component
 * 
 * This is the main application component with:
 * - Simple state-based navigation (no React Router dependency)
 * - Navigation menu for switching between views
 * - Today Plan as the default view
 * 
 * Views:
 * - today: Today Plan (default)
 * - domains: Domain management
 * - tasks: Task management
 * - log: Daily Log entry
 * - stats: Streaks and balance
 * - summary: Weekly Summary
 * 
 * Requirements: 10.1, 10.3
 */

type View = 'today' | 'domains' | 'tasks' | 'log' | 'stats' | 'summary' | 'settings';

function App() {
  const [currentView, setCurrentView] = useState<View>('today');
  const hasAutoImported = useRef(false);

  // Enable background sync worker
  useBackgroundSync();

  // Test tRPC connection with a simple query
  const healthCheck = trpc.domain.list.useQuery(undefined, {
    // Only run on mount to test connection
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Get sync status to check if Google is connected
  const { data: syncStatus } = trpc.sync.getSyncStatus.useQuery(undefined, {
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  // Auto-import mutation
  const importFromGoogle = trpc.sync.importFromGoogle.useMutation();

  /**
   * Auto-import on app open
   * 
   * Requirements: 2.1, 3.1
   * 
   * When the application opens:
   * 1. Check if Google is connected
   * 2. Trigger importFromGoogle if connected
   * 3. Handle import errors gracefully (log, don't crash)
   * 
   * Note: Auto-import is always enabled in this implementation.
   * Future enhancement: Add user preference to disable auto-import.
   */
  useEffect(() => {
    // Only run once on mount
    if (hasAutoImported.current) {
      return;
    }

    // Check if Google is connected
    const isConnected = syncStatus?.isConnected ?? false;
    
    if (isConnected) {
      hasAutoImported.current = true;
      
      // Trigger import in background
      importFromGoogle.mutate(undefined, {
        onSuccess: (result) => {
          console.log('Auto-import completed:', {
            calendarEvents: result.calendarEventsImported,
            tasks: result.tasksImported,
            conflicts: result.conflicts.length,
            errors: result.errors.length,
          });
        },
        onError: (error) => {
          // Handle errors gracefully - log but don't crash or show intrusive UI
          console.error('Auto-import failed:', error);
          // User can manually trigger import from settings if needed
        },
      });
    }
  }, [syncStatus?.isConnected, importFromGoogle]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <h1 className="text-3xl font-bold text-foreground">Life Manager</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Integration creates wellbeing
          </p>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-card border-b">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto">
            <NavButton
              active={currentView === 'today'}
              onClick={() => setCurrentView('today')}
            >
              Today Plan
            </NavButton>
            <NavButton
              active={currentView === 'domains'}
              onClick={() => setCurrentView('domains')}
            >
              Domains
            </NavButton>
            <NavButton
              active={currentView === 'tasks'}
              onClick={() => setCurrentView('tasks')}
            >
              Tasks
            </NavButton>
            <NavButton
              active={currentView === 'log'}
              onClick={() => setCurrentView('log')}
            >
              Daily Log
            </NavButton>
            <NavButton
              active={currentView === 'stats'}
              onClick={() => setCurrentView('stats')}
            >
              Stats
            </NavButton>
            <NavButton
              active={currentView === 'summary'}
              onClick={() => setCurrentView('summary')}
            >
              Summary
            </NavButton>
            <NavButton
              active={currentView === 'settings'}
              onClick={() => setCurrentView('settings')}
            >
              Settings
            </NavButton>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Connection Status */}
        {healthCheck.isLoading && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-blue-800">Connecting to server...</p>
          </div>
        )}
        {healthCheck.isError && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800">
              ⚠️ Cannot connect to server. Make sure the backend is running on port 4000.
            </p>
            <p className="text-sm text-red-600 mt-2">
              Run: <code className="bg-red-100 px-2 py-1 rounded">npm run dev:server</code>
            </p>
          </div>
        )}

        {/* View Content */}
        {currentView === 'today' && <TodayView />}
        {currentView === 'domains' && <DomainsView />}
        {currentView === 'tasks' && <TasksView />}
        {currentView === 'log' && <LogView />}
        {currentView === 'stats' && <StatsView />}
        {currentView === 'summary' && <SummaryView />}
        {currentView === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

/**
 * Navigation Button Component
 */
interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function NavButton({ active, onClick, children }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`
        px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap
        ${
          active
            ? 'text-foreground border-b-2 border-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }
      `}
    >
      {children}
    </button>
  );
}

/**
 * Placeholder Views
 * 
 * These will be replaced with actual components in subsequent tasks.
 */

function TodayView() {
  return (
    <div className="space-y-6">
      {/* Today Plan (includes guardrail banner) */}
      <TodayPlan />
    </div>
  );
}

function DomainsView() {
  return <DomainList />;
}

function TasksView() {
  return <TaskList />;
}

function LogView() {
  return <DailyLogForm />;
}

function StatsView() {
  return (
    <div className="space-y-8">
      {/* Safety Guardrails */}
      <GuardrailBanner />
      
      {/* Streaks */}
      <StreakDisplay />
      
      {/* Domain Balance */}
      <BalanceChart />
    </div>
  );
}

function SummaryView() {
  return <WeeklySummary />;
}

function SettingsView() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your Life Manager preferences
        </p>
      </div>
      
      <GoogleSyncSettings />
    </div>
  );
}

export default App;
