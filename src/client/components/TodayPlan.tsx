import { useState, useEffect, useRef } from 'react';
import { trpc } from '../lib/trpc';
import { EnergySlider } from './EnergySlider';
import { GuardrailBanner } from './GuardrailBanner';
import confetti from 'canvas-confetti';

interface TodayPlanProps {
  className?: string;
}

export function TodayPlan({ className = '' }: TodayPlanProps) {
  const [energyLevel, setEnergyLevel] = useState<number>(5);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const confettiFired = useRef(false);

  const utils = trpc.useUtils();

  // Queries
  const { data: plan, isLoading } = trpc.planner.getToday.useQuery(
    { date: getTodayDate() },
    { refetchOnWindowFocus: true }
  );

  const { data: syncStatus } = trpc.sync.getSyncStatus.useQuery();
  const { data: domains } = trpc.domain.list.useQuery();
  const { data: dailyProgress } = trpc.planner.getDailyProgress.useQuery(
    { date: getTodayDate() },
    { refetchOnWindowFocus: true }
  );

  // Mutations
  const importFromGoogle = trpc.sync.importFromGoogle.useMutation();
  const generatePlan = trpc.planner.generate.useMutation({
    onSuccess: () => {
      utils.planner.getToday.invalidate();
      utils.planner.getDailyProgress.invalidate();
    },
  });
  const completeTask = trpc.task.complete.useMutation({
    onSuccess: () => {
      utils.planner.getToday.invalidate();
      utils.planner.getDailyProgress.invalidate();
    },
  });
  const skipItem = trpc.planner.skipPlanItem.useMutation({
    onSuccess: () => {
      utils.planner.getToday.invalidate();
      utils.planner.getDailyProgress.invalidate();
    },
  });
  const replanMutation = trpc.planner.replan.useMutation({
    onSuccess: () => {
      utils.planner.getToday.invalidate();
      utils.planner.getDailyProgress.invalidate();
      confettiFired.current = false;
    },
  });

  // Helpers
  const getDomainName = (domainId: number): string => {
    const domain = domains?.find(d => d.id === domainId);
    return domain?.name || 'Unknown';
  };

  /**
   * Start My Day: sync Google (if connected) then generate plan
   */
  const handleStartDay = async () => {
    setIsSyncing(true);
    try {
      // Sync from Google if connected
      if (syncStatus?.isConnected) {
        try {
          await importFromGoogle.mutateAsync();
        } catch (err) {
          // Sync failure shouldn't block plan generation
          console.error('Google sync failed (continuing):', err);
        }
      }
      // Generate plan
      await generatePlan.mutateAsync({
        energyLevel,
        date: getTodayDate(),
      });
    } catch (err) {
      console.error('Failed to start day:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  /**
   * Re-plan: sync + generate more tasks
   */
  const handleReplan = async () => {
    setIsSyncing(true);
    try {
      if (syncStatus?.isConnected) {
        try {
          await importFromGoogle.mutateAsync();
        } catch (err) {
          console.error('Google sync failed (continuing):', err);
        }
      }
      await replanMutation.mutateAsync({
        energyLevel,
        date: getTodayDate(),
      });
    } catch (err) {
      console.error('Failed to replan:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleComplete = (taskId: number, status: string) => {
    if (status === 'done') return;
    completeTask.mutate({ id: taskId });
  };

  const handleSkip = (planItemId: number) => {
    skipItem.mutate({ planItemId });
  };

  // Fire confetti when all active items are resolved
  useEffect(() => {
    if (!plan || plan.items.length === 0) return;
    const activeItems = plan.items.filter(i => !i.snoozed);
    if (activeItems.length === 0) return;
    const allResolved = activeItems.every(i => i.task.status === 'done');
    if (allResolved && !confettiFired.current) {
      confettiFired.current = true;
      const end = Date.now() + 2000;
      const frame = () => {
        confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0, y: 0.7 } });
        confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1, y: 0.7 } });
        if (Date.now() < end) requestAnimationFrame(frame);
      };
      frame();
    }
  }, [plan]);

  // Loading
  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold">Today</h2>
        <div className="p-6 bg-card rounded-lg border">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Compute active/resolved state
  const activeItems = plan?.items.filter(i => !i.snoozed) ?? [];
  const allActiveResolved = activeItems.length > 0 && activeItems.every(i => i.task.status === 'done');
  const completedToday = dailyProgress?.completedCount ?? 0;
  const skippedToday = dailyProgress?.skippedCount ?? 0;

  return (
    <div className={`space-y-6 ${className}`}>
      <GuardrailBanner />

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Today</h2>
        <div className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          })}
        </div>
      </div>

      {/* Daily Progress Bar (always visible if there's any activity) */}
      {(completedToday > 0 || skippedToday > 0) && (
        <button
          onClick={() => setShowProgress(!showProgress)}
          className="w-full p-4 bg-card rounded-lg border hover:border-primary/50 transition-colors text-left"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-green-600">{completedToday}</span>
              <span className="text-sm text-muted-foreground">
                task{completedToday !== 1 ? 's' : ''} completed today
                {skippedToday > 0 && ` · ${skippedToday} skipped`}
              </span>
            </div>
            <svg
              className={`w-5 h-5 text-muted-foreground transition-transform ${showProgress ? 'rotate-180' : ''}`}
              fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              viewBox="0 0 24 24" stroke="currentColor"
            >
              <path d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
      )}

      {/* Expanded Progress Panel */}
      {showProgress && dailyProgress && (
        <DailyProgressPanel
          progress={dailyProgress}
          onCompleteSkipped={(taskId) => handleComplete(taskId, 'todo')}
        />
      )}

      {/* STATE: No plan — show energy prompt */}
      {!plan && (
        <NoPlanState
          energyLevel={energyLevel}
          onEnergyChange={setEnergyLevel}
          onStart={handleStartDay}
          isSyncing={isSyncing}
          isGoogleConnected={syncStatus?.isConnected ?? false}
          error={generatePlan.error?.message || importFromGoogle.error?.message}
        />
      )}

      {/* STATE: Plan exists with active items */}
      {plan && !allActiveResolved && (
        <ActivePlanState
          plan={plan}
          activeItems={activeItems}
          getDomainName={getDomainName}
          onComplete={handleComplete}
          onSkip={handleSkip}
          isCompleting={completeTask.isPending}
          isSkipping={skipItem.isPending}
        />
      )}

      {/* STATE: All active items resolved — celebration + replan */}
      {plan && allActiveResolved && (
        <AllDoneState
          energyLevel={energyLevel}
          onEnergyChange={setEnergyLevel}
          onReplan={handleReplan}
          isSyncing={isSyncing}
          error={replanMutation.error?.message}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

/** No plan state — energy slider + Start My Day */
function NoPlanState({
  energyLevel, onEnergyChange, onStart, isSyncing, isGoogleConnected, error,
}: {
  energyLevel: number;
  onEnergyChange: (v: number) => void;
  onStart: () => void;
  isSyncing: boolean;
  isGoogleConnected: boolean;
  error?: string;
}) {
  return (
    <div className="p-8 bg-card rounded-lg border space-y-6">
      <div className="text-center space-y-2">
        <p className="text-lg font-medium">Ready to start your day?</p>
        <p className="text-muted-foreground">
          Set your energy level and we'll build a plan for you
          {isGoogleConnected && ' (syncing from Google first)'}
        </p>
      </div>

      <div className="max-w-md mx-auto">
        <EnergySlider value={energyLevel} onChange={onEnergyChange} label="How's your energy?" />
      </div>

      <div className="flex justify-center">
        <button
          onClick={onStart}
          disabled={isSyncing}
          className="px-8 py-3 bg-primary text-primary-foreground rounded-lg font-medium
                   hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSyncing ? 'Syncing & generating...' : 'Start My Day'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}

/** Active plan — task list with complete/skip */
function ActivePlanState({
  plan, activeItems, getDomainName, onComplete, onSkip, isCompleting, isSkipping,
}: {
  plan: { energyLevel: number; items: any[] };
  activeItems: any[];
  getDomainName: (id: number) => string;
  onComplete: (taskId: number, status: string) => void;
  onSkip: (planItemId: number) => void;
  isCompleting: boolean;
  isSkipping: boolean;
}) {
  const mustDo = activeItems.filter(i => i.category === 'must-do');
  const wantTo = activeItems.filter(i => i.category === 'want-to');
  const health = activeItems.filter(i => i.category === 'health');
  const completedCount = activeItems.filter(i => i.task.status === 'done').length;
  const totalMinutes = activeItems.reduce((s: number, i: any) => s + i.task.estimatedMinutes, 0);

  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-card rounded-lg border">
          <div className="text-sm text-muted-foreground">Energy</div>
          <div className="text-2xl font-bold mt-1">{plan.energyLevel}/10</div>
        </div>
        <div className="p-4 bg-card rounded-lg border">
          <div className="text-sm text-muted-foreground">This Batch</div>
          <div className="text-2xl font-bold mt-1">{completedCount}/{activeItems.length}</div>
        </div>
        <div className="p-4 bg-card rounded-lg border">
          <div className="text-sm text-muted-foreground">Est. Time</div>
          <div className="text-2xl font-bold mt-1">{formatMinutes(totalMinutes)}</div>
        </div>
      </div>

      {/* Task categories */}
      <TaskCategory label="Must Do" color="bg-red-500" items={mustDo}
        getDomainName={getDomainName} onComplete={onComplete} onSkip={onSkip}
        isCompleting={isCompleting} isSkipping={isSkipping} />
      <TaskCategory label="Want To" color="bg-blue-500" items={wantTo}
        getDomainName={getDomainName} onComplete={onComplete} onSkip={onSkip}
        isCompleting={isCompleting} isSkipping={isSkipping} />
      <TaskCategory label="Health" color="bg-green-500" items={health}
        getDomainName={getDomainName} onComplete={onComplete} onSkip={onSkip}
        isCompleting={isCompleting} isSkipping={isSkipping} />
    </>
  );
}

/** Task category group */
function TaskCategory({
  label, color, items, getDomainName, onComplete, onSkip, isCompleting, isSkipping,
}: {
  label: string; color: string; items: any[];
  getDomainName: (id: number) => string;
  onComplete: (taskId: number, status: string) => void;
  onSkip: (planItemId: number) => void;
  isCompleting: boolean; isSkipping: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <span className={`w-3 h-3 rounded-full ${color}`} />
        {label}
      </h3>
      <div className="space-y-2">
        {items.map((item: any) => (
          <PlanItem key={item.id} item={item} domainName={getDomainName(item.task.domainId)}
            onComplete={onComplete} onSkip={onSkip}
            isCompleting={isCompleting} isSkipping={isSkipping} />
        ))}
      </div>
    </div>
  );
}

/** All done — confetti already fired, show celebration + replan */
function AllDoneState({
  energyLevel, onEnergyChange, onReplan, isSyncing, error,
}: {
  energyLevel: number;
  onEnergyChange: (v: number) => void;
  onReplan: () => void;
  isSyncing: boolean;
  error?: string;
}) {
  return (
    <div className="p-6 bg-card rounded-lg border space-y-6">
      <div className="text-center space-y-2">
        <p className="text-2xl">✓</p>
        <p className="text-lg font-medium">All done</p>
        <p className="text-sm text-muted-foreground">
          Ready for more?
        </p>
      </div>

      <div className="max-w-md mx-auto">
        <EnergySlider value={energyLevel} onChange={onEnergyChange} label="Current energy" />
      </div>

      <div className="flex justify-center">
        <button
          onClick={onReplan}
          disabled={isSyncing}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium
                   hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSyncing ? 'Loading...' : 'Get More Tasks'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}

/** Single plan item with complete + skip */
function PlanItem({
  item, domainName, onComplete, onSkip, isCompleting, isSkipping,
}: {
  item: any; domainName: string;
  onComplete: (taskId: number, status: string) => void;
  onSkip: (planItemId: number) => void;
  isCompleting: boolean; isSkipping: boolean;
}) {
  const isDone = item.task.status === 'done';
  const isOverdue = item.task.dueDate && new Date(item.task.dueDate) < new Date();

  return (
    <div className={`p-4 bg-card rounded-lg border transition-all ${
      isDone ? 'opacity-60 bg-muted' : 'hover:border-primary/50'
    }`}>
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={() => onComplete(item.task.id, item.task.status)}
          disabled={isDone || isCompleting}
          className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            isDone ? 'bg-primary border-primary' : 'border-muted-foreground hover:border-primary'
          } disabled:cursor-not-allowed`}
          aria-label={isDone ? 'Task completed' : 'Mark as complete'}
        >
          {isDone && (
            <svg className="w-3 h-3 text-primary-foreground" fill="none" strokeLinecap="round"
              strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
              <path d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className={`font-medium ${isDone ? 'line-through text-muted-foreground' : ''}`}>
              {item.task.title}
            </h4>
            {!isDone && (
              <button
                onClick={() => onSkip(item.id)}
                disabled={isSkipping}
                className="px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground
                         border border-muted hover:border-foreground rounded transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                aria-label="Skip this task"
              >
                Skip
              </button>
            )}
          </div>
          {item.task.description && (
            <p className="text-sm text-muted-foreground mt-1">{item.task.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" strokeLinecap="round" strokeLinejoin="round"
                strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              {domainName}
            </span>
            <span className="inline-flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" strokeLinecap="round" strokeLinejoin="round"
                strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatMinutes(item.task.estimatedMinutes)}
            </span>
            {isOverdue && !isDone && (
              <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                Overdue
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Daily progress panel — shows completed + skipped tasks */
function DailyProgressPanel({
  progress, onCompleteSkipped,
}: {
  progress: {
    completedTasks: Array<{ taskId: number; title: string; completedAt: string; status: string }>;
    skippedTasks: Array<{ taskId: number; planItemId: number; title: string; status: string }>;
  };
  onCompleteSkipped: (taskId: number) => void;
}) {
  return (
    <div className="p-4 bg-card rounded-lg border space-y-4">
      {progress.completedTasks.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-green-700">Completed</h4>
          {progress.completedTasks.map(t => (
            <div key={`done-${t.taskId}`} className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="text-green-600">✓</span>
              <span className="line-through">{t.title}</span>
            </div>
          ))}
        </div>
      )}
      {progress.skippedTasks.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-yellow-700">Skipped</h4>
          {progress.skippedTasks.map(t => (
            <div key={`skip-${t.taskId}`} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="text-yellow-600">→</span>
                <span>{t.title}</span>
              </div>
              <button
                onClick={() => onCompleteSkipped(t.taskId)}
                className="px-2 py-0.5 text-xs text-primary hover:text-primary/80 border border-primary/30
                         hover:border-primary rounded transition-colors"
              >
                Complete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
