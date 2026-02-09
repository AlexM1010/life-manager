/**
 * Unit Tests for Streak Service
 * 
 * Tests specific examples and edge cases for streak calculation
 */

import { describe, it, expect } from 'vitest';
import { calculateStreaks, type StreakInput, type DailyLog, type TaskCompletion, type Domain } from '../streaks';

// ============================================================================
// Test Data Helpers
// ============================================================================

function createDomain(id: number, name: string, boringButImportant: boolean = false): Domain {
  return {
    id,
    name,
    description: '',
    whyItMatters: '',
    boringButImportant,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function createDailyLog(date: string, medicationTaken: 'yes' | 'no'): DailyLog {
  return {
    id: 1,
    date,
    hoursSlept: 8,
    energy: 5,
    mood: 5,
    medicationTaken,
    createdAt: `${date}T00:00:00Z`,
    updatedAt: `${date}T00:00:00Z`,
  };
}

function createTaskCompletion(id: number, domainId: number, completedDate: string): TaskCompletion {
  return {
    id,
    taskId: id,
    domainId,
    completedAt: `${completedDate}T12:00:00Z`,
    completedDate,
  };
}

// ============================================================================
// Medication Streak Tests
// ============================================================================

describe('Medication Streak', () => {
  it('should return 0 when no daily logs exist', () => {
    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [],
      domains: [],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.medication).toBe(0);
  });

  it('should return 1 when only today has medication taken', () => {
    const input: StreakInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 'yes'),
      ],
      taskCompletions: [],
      domains: [],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.medication).toBe(1);
  });

  it('should return 0 when today medication is not taken', () => {
    const input: StreakInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 'no'),
      ],
      taskCompletions: [],
      domains: [],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.medication).toBe(0);
  });

  it('should count consecutive days with medication taken', () => {
    const input: StreakInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 'yes'),
        createDailyLog('2026-02-03', 'yes'),
        createDailyLog('2026-02-02', 'yes'),
      ],
      taskCompletions: [],
      domains: [],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.medication).toBe(3);
  });

  it('should break streak when medication is not taken', () => {
    const input: StreakInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 'yes'),
        createDailyLog('2026-02-03', 'yes'),
        createDailyLog('2026-02-02', 'no'), // Breaks streak
        createDailyLog('2026-02-01', 'yes'),
      ],
      taskCompletions: [],
      domains: [],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.medication).toBe(2);
  });

  it('should break streak when a day is missing', () => {
    const input: StreakInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 'yes'),
        createDailyLog('2026-02-03', 'yes'),
        // 2026-02-02 missing - breaks streak
        createDailyLog('2026-02-01', 'yes'),
      ],
      taskCompletions: [],
      domains: [],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.medication).toBe(2);
  });

  it('should handle long streaks correctly', () => {
    const logs: DailyLog[] = [];
    for (let i = 0; i < 30; i++) {
      const date = new Date('2026-02-04T00:00:00Z');
      date.setUTCDate(date.getUTCDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      logs.push(createDailyLog(dateStr, 'yes'));
    }

    const input: StreakInput = {
      dailyLogs: logs,
      taskCompletions: [],
      domains: [],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.medication).toBe(30);
  });
});

// ============================================================================
// Health Task Streak Tests
// ============================================================================

describe('Health Task Streak', () => {
  const healthDomain = createDomain(1, 'Health', false);
  const otherDomain = createDomain(2, 'Work', false);

  it('should return 0 when no health domains exist', () => {
    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [
        createTaskCompletion(1, 2, '2026-02-04'),
      ],
      domains: [otherDomain],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.healthTask).toBe(0);
  });

  it('should return 0 when no task completions exist', () => {
    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [],
      domains: [healthDomain],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.healthTask).toBe(0);
  });

  it('should return 1 when only today has health task completed', () => {
    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [
        createTaskCompletion(1, 1, '2026-02-04'),
      ],
      domains: [healthDomain],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.healthTask).toBe(1);
  });

  it('should count consecutive days with health task completions', () => {
    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [
        createTaskCompletion(1, 1, '2026-02-04'),
        createTaskCompletion(2, 1, '2026-02-03'),
        createTaskCompletion(3, 1, '2026-02-02'),
      ],
      domains: [healthDomain],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.healthTask).toBe(3);
  });

  it('should break streak when no health task completed on a day', () => {
    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [
        createTaskCompletion(1, 1, '2026-02-04'),
        createTaskCompletion(2, 1, '2026-02-03'),
        // 2026-02-02 missing - breaks streak
        createTaskCompletion(3, 1, '2026-02-01'),
      ],
      domains: [healthDomain],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.healthTask).toBe(2);
  });

  it('should ignore non-health domain completions', () => {
    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [
        createTaskCompletion(1, 1, '2026-02-04'), // Health
        createTaskCompletion(2, 2, '2026-02-03'), // Non-health - breaks streak
        createTaskCompletion(3, 1, '2026-02-02'), // Health
      ],
      domains: [healthDomain, otherDomain],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.healthTask).toBe(1);
  });

  it('should identify health domains case-insensitively', () => {
    const domains = [
      createDomain(1, 'HEALTH', false),
      createDomain(2, 'Mental Health', false),
      createDomain(3, 'healthcare', false),
    ];

    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [
        createTaskCompletion(1, 1, '2026-02-04'),
        createTaskCompletion(2, 2, '2026-02-03'),
        createTaskCompletion(3, 3, '2026-02-02'),
      ],
      domains,
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.healthTask).toBe(3);
  });

  it('should count multiple health completions on same day as one', () => {
    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [
        createTaskCompletion(1, 1, '2026-02-04'),
        createTaskCompletion(2, 1, '2026-02-04'), // Same day
        createTaskCompletion(3, 1, '2026-02-04'), // Same day
      ],
      domains: [healthDomain],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.healthTask).toBe(1);
  });
});

// ============================================================================
// Boring-But-Important Streak Tests
// ============================================================================

describe('Boring-But-Important Streak', () => {
  const bbiDomain = createDomain(1, 'Admin', true);
  const nonBbiDomain = createDomain(2, 'Fun', false);

  it('should return 0 when no BBI domains exist', () => {
    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [
        createTaskCompletion(1, 2, '2026-02-04'),
      ],
      domains: [nonBbiDomain],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.boringButImportant).toBe(0);
  });

  it('should return 0 when no task completions exist', () => {
    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [],
      domains: [bbiDomain],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.boringButImportant).toBe(0);
  });

  it('should return 1 when only today has BBI task completed', () => {
    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [
        createTaskCompletion(1, 1, '2026-02-04'),
      ],
      domains: [bbiDomain],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.boringButImportant).toBe(1);
  });

  it('should count consecutive days with BBI task completions', () => {
    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [
        createTaskCompletion(1, 1, '2026-02-04'),
        createTaskCompletion(2, 1, '2026-02-03'),
        createTaskCompletion(3, 1, '2026-02-02'),
      ],
      domains: [bbiDomain],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.boringButImportant).toBe(3);
  });

  it('should break streak when no BBI task completed on a day', () => {
    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [
        createTaskCompletion(1, 1, '2026-02-04'),
        createTaskCompletion(2, 1, '2026-02-03'),
        // 2026-02-02 missing - breaks streak
        createTaskCompletion(3, 1, '2026-02-01'),
      ],
      domains: [bbiDomain],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.boringButImportant).toBe(2);
  });

  it('should ignore non-BBI domain completions', () => {
    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [
        createTaskCompletion(1, 1, '2026-02-04'), // BBI
        createTaskCompletion(2, 2, '2026-02-03'), // Non-BBI - breaks streak
        createTaskCompletion(3, 1, '2026-02-02'), // BBI
      ],
      domains: [bbiDomain, nonBbiDomain],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.boringButImportant).toBe(1);
  });
});

// ============================================================================
// Combined Streak Tests
// ============================================================================

describe('Combined Streaks', () => {
  it('should calculate all three streaks independently', () => {
    const healthDomain = createDomain(1, 'Health', false);
    const bbiDomain = createDomain(2, 'Admin', true);

    const input: StreakInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 'yes'),
        createDailyLog('2026-02-03', 'yes'),
        createDailyLog('2026-02-02', 'yes'),
      ],
      taskCompletions: [
        createTaskCompletion(1, 1, '2026-02-04'), // Health
        createTaskCompletion(2, 1, '2026-02-03'), // Health
        createTaskCompletion(3, 2, '2026-02-04'), // BBI
        createTaskCompletion(4, 2, '2026-02-03'), // BBI
        createTaskCompletion(5, 2, '2026-02-02'), // BBI
        createTaskCompletion(6, 2, '2026-02-01'), // BBI
      ],
      domains: [healthDomain, bbiDomain],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.medication).toBe(3);
    expect(result.healthTask).toBe(2);
    expect(result.boringButImportant).toBe(4);
  });

  it('should handle empty input gracefully', () => {
    const input: StreakInput = {
      dailyLogs: [],
      taskCompletions: [],
      domains: [],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.medication).toBe(0);
    expect(result.healthTask).toBe(0);
    expect(result.boringButImportant).toBe(0);
  });

  it('should handle first day of use correctly', () => {
    const healthDomain = createDomain(1, 'Health', false);
    const bbiDomain = createDomain(2, 'Admin', true);

    const input: StreakInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 'yes'),
      ],
      taskCompletions: [
        createTaskCompletion(1, 1, '2026-02-04'),
        createTaskCompletion(2, 2, '2026-02-04'),
      ],
      domains: [healthDomain, bbiDomain],
      currentDate: '2026-02-04',
    };

    const result = calculateStreaks(input);
    expect(result.medication).toBe(1);
    expect(result.healthTask).toBe(1);
    expect(result.boringButImportant).toBe(1);
  });
});
