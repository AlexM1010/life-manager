import { useState, useEffect } from 'react';
import { trpc } from '../lib/trpc';
import { EnergySlider } from './EnergySlider';

/**
 * DailyLogForm Component
 * 
 * Form for submitting daily health logs with:
 * - Hours slept (0-24)
 * - Energy level (0-10)
 * - Mood level (0-10)
 * - Medication adherence (yes/no)
 * 
 * Features:
 * - Auto-loads today's log if it exists (allows editing)
 * - Real-time validation
 * - Visual feedback for submission
 * - Reuses EnergySlider component for energy and mood
 * - One log per day (upsert behavior)
 * 
 * Requirements: 5.1, 10.3
 */

interface DailyLogFormProps {
  className?: string;
  /** Optional callback when log is successfully submitted */
  onSuccess?: () => void;
}

export function DailyLogForm({ className = '', onSuccess }: DailyLogFormProps) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

  const [hoursSlept, setHoursSlept] = useState<number>(7);
  const [energy, setEnergy] = useState<number>(5);
  const [mood, setMood] = useState<number>(5);
  const [medicationTaken, setMedicationTaken] = useState<'yes' | 'no'>('yes');
  const [isEditing, setIsEditing] = useState(false);

  const utils = trpc.useUtils();

  // Fetch today's log if it exists
  const { data: existingLog, isLoading } = trpc.dailyLog.getToday.useQuery(
    { date: today },
    {
      retry: false,
    }
  );

  // Submit daily log mutation
  const submitLog = trpc.dailyLog.submit.useMutation({
    onSuccess: () => {
      utils.dailyLog.getToday.invalidate();
      setIsEditing(false);
      onSuccess?.();
    },
  });

  // Load existing log data when it's fetched
  useEffect(() => {
    if (existingLog) {
      setHoursSlept(existingLog.hoursSlept);
      setEnergy(existingLog.energy);
      setMood(existingLog.mood);
      setMedicationTaken(existingLog.medicationTaken as 'yes' | 'no');
    }
  }, [existingLog]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    submitLog.mutate({
      date: today,
      hoursSlept,
      energy,
      mood,
      medicationTaken,
    });
  };

  // Loading state
  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold">Daily Health Log</h2>
        <div className="p-6 bg-card rounded-lg border">
          <p className="text-muted-foreground">Loading today's log...</p>
        </div>
      </div>
    );
  }

  // Show read-only view if log exists and not editing
  if (existingLog && !isEditing) {
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Daily Health Log</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {formatDate(today)}
            </p>
          </div>
          <button
            onClick={() => setIsEditing(true)}
            className="px-4 py-2 border border-input rounded-lg font-medium
                     hover:bg-muted transition-colors"
          >
            Edit Today's Log
          </button>
        </div>

        <div className="p-6 bg-card rounded-lg border space-y-4">
          {/* Success Message */}
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800 font-medium">
              ✓ Today's log has been recorded
            </p>
          </div>

          {/* Log Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Hours Slept</p>
              <p className="text-2xl font-bold">{existingLog.hoursSlept}h</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Energy Level</p>
              <p className="text-2xl font-bold">{existingLog.energy}/10</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Mood Level</p>
              <p className="text-2xl font-bold">{existingLog.mood}/10</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Medication Taken</p>
              <p className="text-2xl font-bold capitalize">
                {existingLog.medicationTaken}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show form (for new log or editing)
  return (
    <div className={`space-y-4 ${className}`}>
      <div>
        <h2 className="text-2xl font-bold">Daily Health Log</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {formatDate(today)}
          {existingLog && ' (Editing)'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="p-6 bg-card rounded-lg border space-y-6">
        {/* Hours Slept */}
        <div>
          <label htmlFor="hours-slept" className="block text-sm font-medium mb-2">
            Hours Slept
          </label>
          <div className="flex items-center gap-4">
            <input
              id="hours-slept"
              type="number"
              value={hoursSlept}
              onChange={(e) => setHoursSlept(parseFloat(e.target.value))}
              min={0}
              max={24}
              step={0.5}
              required
              className="w-32 px-3 py-2 border border-input rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-sm text-muted-foreground">
              (0-24 hours)
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            How many hours did you sleep last night?
          </p>
        </div>

        {/* Energy Level */}
        <EnergySlider
          value={energy}
          onChange={setEnergy}
          label="Energy Level"
        />
        <p className="text-xs text-muted-foreground -mt-4">
          How energetic and motivated do you feel today?
        </p>

        {/* Mood Level */}
        <EnergySlider
          value={mood}
          onChange={setMood}
          label="Mood Level"
        />
        <p className="text-xs text-muted-foreground -mt-4">
          How would you rate your overall mood today?
        </p>

        {/* Medication Taken */}
        <div>
          <label className="block text-sm font-medium mb-3">
            Medication Taken Today
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="medication"
                value="yes"
                checked={medicationTaken === 'yes'}
                onChange={(e) => setMedicationTaken(e.target.value as 'yes' | 'no')}
                className="w-4 h-4 text-primary focus:ring-2 focus:ring-ring"
              />
              <span className="text-sm font-medium">Yes</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="medication"
                value="no"
                checked={medicationTaken === 'no'}
                onChange={(e) => setMedicationTaken(e.target.value as 'yes' | 'no')}
                className="w-4 h-4 text-primary focus:ring-2 focus:ring-ring"
              />
              <span className="text-sm font-medium">No</span>
            </label>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Did you take your prescribed medication as directed?
          </p>
        </div>

        {/* Error Message */}
        {submitLog.error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{submitLog.error.message}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitLog.isPending}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium
                     hover:bg-primary/90 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitLog.isPending
              ? 'Saving...'
              : existingLog
              ? 'Update Log'
              : 'Submit Log'}
          </button>
          {existingLog && isEditing && (
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                // Reset to existing values
                setHoursSlept(existingLog.hoursSlept);
                setEnergy(existingLog.energy);
                setMood(existingLog.mood);
                setMedicationTaken(existingLog.medicationTaken as 'yes' | 'no');
              }}
              disabled={submitLog.isPending}
              className="px-6 py-2 border border-input rounded-lg font-medium
                       hover:bg-muted transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/**
 * Helper Functions
 */

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
