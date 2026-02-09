import { trpc } from '../lib/trpc';

/**
 * StreakDisplay Component
 * 
 * Displays three types of streaks to motivate consistent behavior:
 * 
 * 1. Medication Streak: Consecutive days with medication adherence (yes)
 * 2. Health Task Streak: Consecutive days with ≥1 health domain task completed
 * 3. Boring-But-Important Streak: Consecutive days with ≥1 BBI domain task completed
 * 
 * Design principles:
 * - Visual clarity: Large numbers, clear labels, color-coded indicators
 * - Motivational: Celebrates progress, encourages consistency
 * - Honest: Shows zero streaks without softening
 * - Accessible: Clear contrast, semantic HTML, ARIA labels
 * 
 * Requirements: 6.1, 6.2, 6.3
 */

interface StreakDisplayProps {
  className?: string;
}

export function StreakDisplay({ className = '' }: StreakDisplayProps) {
  // Fetch current streaks
  const { data: streaks, isLoading, error } = trpc.stats.streaks.useQuery(
    undefined,
    {
      // Refetch when window regains focus
      refetchOnWindowFocus: true,
      // Keep data fresh (refetch every 5 minutes)
      staleTime: 5 * 60 * 1000,
    }
  );

  // Loading state
  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold">Streaks</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-6 bg-card rounded-lg border animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-4"></div>
              <div className="h-12 bg-muted rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold">Streaks</h2>
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800">Failed to load streaks</p>
          <p className="text-sm text-red-600 mt-2">{error.message}</p>
        </div>
      </div>
    );
  }

  // No data state (shouldn't happen, but handle gracefully)
  if (!streaks) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold">Streaks</h2>
        <div className="p-6 bg-card rounded-lg border">
          <p className="text-muted-foreground">No streak data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Streaks</h2>
        <p className="text-sm text-muted-foreground">
          Keep the momentum going! 🔥
        </p>
      </div>

      {/* Streak Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Medication Streak */}
        <StreakCard
          title="Medication"
          streak={streaks.medication}
          icon={<MedicationIcon />}
          color="blue"
          description="Days with medication adherence"
          ariaLabel={`Medication streak: ${streaks.medication} ${streaks.medication === 1 ? 'day' : 'days'}`}
        />

        {/* Health Task Streak */}
        <StreakCard
          title="Health Tasks"
          streak={streaks.healthTask}
          icon={<HealthIcon />}
          color="green"
          description="Days with health domain tasks completed"
          ariaLabel={`Health task streak: ${streaks.healthTask} ${streaks.healthTask === 1 ? 'day' : 'days'}`}
        />

        {/* Boring-But-Important Streak */}
        <StreakCard
          title="Boring But Important"
          streak={streaks.boringButImportant}
          icon={<BBIIcon />}
          color="purple"
          description="Days with BBI domain tasks completed"
          ariaLabel={`Boring-but-important streak: ${streaks.boringButImportant} ${streaks.boringButImportant === 1 ? 'day' : 'days'}`}
        />
      </div>

      {/* Motivational Message */}
      <StreakMessage streaks={streaks} />
    </div>
  );
}

/**
 * StreakCard Component
 * 
 * Displays a single streak with:
 * - Icon and title
 * - Large streak number
 * - Description
 * - Color-coded styling
 */

interface StreakCardProps {
  title: string;
  streak: number;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'purple';
  description: string;
  ariaLabel: string;
}

function StreakCard({ title, streak, icon, color, description, ariaLabel }: StreakCardProps) {
  // Color mappings
  const colorStyles = {
    blue: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      icon: 'text-blue-600',
      number: 'text-blue-700',
      accent: 'bg-blue-500',
    },
    green: {
      bg: 'bg-green-50',
      border: 'border-green-200',
      icon: 'text-green-600',
      number: 'text-green-700',
      accent: 'bg-green-500',
    },
    purple: {
      bg: 'bg-purple-50',
      border: 'border-purple-200',
      icon: 'text-purple-600',
      number: 'text-purple-700',
      accent: 'bg-purple-500',
    },
  };

  const styles = colorStyles[color];

  return (
    <div
      className={`p-6 rounded-lg border-2 ${styles.bg} ${styles.border} transition-all hover:shadow-md`}
      role="region"
      aria-label={ariaLabel}
    >
      {/* Header with Icon */}
      <div className="flex items-center gap-3 mb-4">
        <div className={`${styles.icon}`}>{icon}</div>
        <h3 className="font-semibold text-lg">{title}</h3>
      </div>

      {/* Streak Number */}
      <div className="mb-2">
        <div className={`text-5xl font-bold ${styles.number} tabular-nums`}>
          {streak}
        </div>
        <div className="text-sm text-muted-foreground mt-1">
          {streak === 1 ? 'day' : 'days'}
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground leading-relaxed">
        {description}
      </p>

      {/* Visual Indicator Bar */}
      <div className="mt-4 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${styles.accent} transition-all duration-500`}
          style={{ width: streak > 0 ? '100%' : '0%' }}
        ></div>
      </div>
    </div>
  );
}

/**
 * StreakMessage Component
 * 
 * Displays a motivational message based on streak status:
 * - All streaks active: Celebration
 * - Some streaks active: Encouragement
 * - No streaks active: Gentle nudge to start
 */

interface StreakMessageProps {
  streaks: {
    medication: number;
    healthTask: number;
    boringButImportant: number;
  };
}

function StreakMessage({ streaks }: StreakMessageProps) {
  const activeStreaks = [
    streaks.medication > 0,
    streaks.healthTask > 0,
    streaks.boringButImportant > 0,
  ].filter(Boolean).length;

  const totalDays = streaks.medication + streaks.healthTask + streaks.boringButImportant;

  // All streaks active
  if (activeStreaks === 3) {
    return (
      <div className="p-4 bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg">
        <p className="text-sm font-medium text-green-900">
          🎉 All streaks active! You're building powerful habits. Total: {totalDays} days of consistency.
        </p>
      </div>
    );
  }

  // Some streaks active
  if (activeStreaks > 0) {
    return (
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm font-medium text-blue-900">
          💪 {activeStreaks} {activeStreaks === 1 ? 'streak' : 'streaks'} active. Keep going — consistency compounds.
        </p>
      </div>
    );
  }

  // No streaks active
  return (
    <div className="p-4 bg-muted border border-muted-foreground/20 rounded-lg">
      <p className="text-sm font-medium text-foreground">
        Start a streak today. Even one day is progress. The first step is the hardest — and the most important.
      </p>
    </div>
  );
}

/**
 * Icon Components
 */

function MedicationIcon() {
  return (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    </svg>
  );
}

function HealthIcon() {
  return (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
      />
    </svg>
  );
}

function BBIIcon() {
  return (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}
