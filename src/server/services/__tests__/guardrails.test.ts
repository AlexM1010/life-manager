/**
 * Unit Tests for Guardrails Service
 * 
 * Tests specific examples and edge cases for safety guardrail checks
 */

import { describe, it, expect } from 'vitest';
import { checkGuardrails, type GuardrailInput, type DailyLog, type TodayPlan, type TodayPlanItem } from '../guardrails';

// ============================================================================
// Test Data Helpers
// ============================================================================

function createDailyLog(date: string, mood: number, energy: number): DailyLog {
  return {
    id: 1,
    date,
    hoursSlept: 8,
    energy,
    mood,
    medicationTaken: 'yes',
    createdAt: `${date}T00:00:00Z`,
    updatedAt: `${date}T00:00:00Z`,
  };
}

function createTodayPlan(id: number, date: string): TodayPlan {
  return {
    id,
    date,
    energyLevel: 5,
    createdAt: `${date}T00:00:00Z`,
  };
}

function createPlanItem(id: number, planId: number, completed: boolean): TodayPlanItem {
  return {
    id,
    planId,
    taskId: id,
    category: 'must-do',
    completed,
    snoozed: false,
  };
}

// ============================================================================
// Doctor Suggestion Tests
// ============================================================================

describe('Doctor Suggestion Trigger', () => {
  it('should not trigger when no logs exist', () => {
    const input: GuardrailInput = {
      dailyLogs: [],
      todayPlans: [],
      todayPlanItems: [],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestDoctor).toBe(false);
    expect(result.messages).toHaveLength(0);
  });

  it('should not trigger with only 1 day of low mood', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 3, 5), // Low mood, normal energy
      ],
      todayPlans: [],
      todayPlanItems: [],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestDoctor).toBe(false);
  });

  it('should not trigger with only 2 consecutive days of low mood', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 3, 5),
        createDailyLog('2026-02-03', 3, 5),
      ],
      todayPlans: [],
      todayPlanItems: [],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestDoctor).toBe(false);
  });

  it('should trigger with exactly 3 consecutive days of low mood', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 3, 5),
        createDailyLog('2026-02-03', 3, 5),
        createDailyLog('2026-02-02', 3, 5),
      ],
      todayPlans: [],
      todayPlanItems: [],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestDoctor).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toContain('doctor or care team');
  });

  it('should trigger with exactly 3 consecutive days of low energy', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 5, 3),
        createDailyLog('2026-02-03', 5, 3),
        createDailyLog('2026-02-02', 5, 3),
      ],
      todayPlans: [],
      todayPlanItems: [],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestDoctor).toBe(true);
    expect(result.messages).toHaveLength(1);
  });

  it('should trigger with 3 consecutive days of low mood OR low energy (mixed)', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 3, 5), // Low mood
        createDailyLog('2026-02-03', 5, 2), // Low energy
        createDailyLog('2026-02-02', 3, 3), // Both low
      ],
      todayPlans: [],
      todayPlanItems: [],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestDoctor).toBe(true);
  });

  it('should trigger with more than 3 consecutive days', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 2, 5),
        createDailyLog('2026-02-03', 3, 5),
        createDailyLog('2026-02-02', 1, 5),
        createDailyLog('2026-02-01', 3, 5),
        createDailyLog('2026-01-31', 2, 5),
      ],
      todayPlans: [],
      todayPlanItems: [],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestDoctor).toBe(true);
  });

  it('should not trigger when streak is broken by a good day', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 3, 5),
        createDailyLog('2026-02-03', 3, 5),
        createDailyLog('2026-02-02', 7, 7), // Good day - breaks streak
        createDailyLog('2026-02-01', 3, 5),
        createDailyLog('2026-01-31', 3, 5),
      ],
      todayPlans: [],
      todayPlanItems: [],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestDoctor).toBe(false);
  });

  it('should not trigger when streak is broken by a missing day', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 3, 5),
        createDailyLog('2026-02-03', 3, 5),
        // 2026-02-02 missing - breaks streak
        createDailyLog('2026-02-01', 3, 5),
        createDailyLog('2026-01-31', 3, 5),
      ],
      todayPlans: [],
      todayPlanItems: [],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestDoctor).toBe(false);
  });

  it('should use boundary value of 3 (inclusive)', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 3, 3), // Exactly 3 - should count
        createDailyLog('2026-02-03', 3, 3),
        createDailyLog('2026-02-02', 3, 3),
      ],
      todayPlans: [],
      todayPlanItems: [],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestDoctor).toBe(true);
  });

  it('should not trigger when values are just above threshold', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 4, 4), // Just above 3
        createDailyLog('2026-02-03', 4, 4),
        createDailyLog('2026-02-02', 4, 4),
      ],
      todayPlans: [],
      todayPlanItems: [],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestDoctor).toBe(false);
  });
});

// ============================================================================
// Support Suggestion Tests
// ============================================================================

describe('Support Suggestion Trigger', () => {
  it('should not trigger when no data exists', () => {
    const input: GuardrailInput = {
      dailyLogs: [],
      todayPlans: [],
      todayPlanItems: [],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestSupport).toBe(false);
  });

  it('should not trigger with only 4 consecutive concerning days', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 4, 4), // avg = 4
        createDailyLog('2026-02-03', 4, 4),
        createDailyLog('2026-02-02', 4, 4),
        createDailyLog('2026-02-01', 4, 4),
      ],
      todayPlans: [
        createTodayPlan(1, '2026-02-04'),
        createTodayPlan(2, '2026-02-03'),
        createTodayPlan(3, '2026-02-02'),
        createTodayPlan(4, '2026-02-01'),
      ],
      todayPlanItems: [
        // Day 1: 1/3 completed (33%)
        createPlanItem(1, 1, true),
        createPlanItem(2, 1, false),
        createPlanItem(3, 1, false),
        // Day 2: 1/3 completed (33%)
        createPlanItem(4, 2, true),
        createPlanItem(5, 2, false),
        createPlanItem(6, 2, false),
        // Day 3: 1/3 completed (33%)
        createPlanItem(7, 3, true),
        createPlanItem(8, 3, false),
        createPlanItem(9, 3, false),
        // Day 4: 1/3 completed (33%)
        createPlanItem(10, 4, true),
        createPlanItem(11, 4, false),
        createPlanItem(12, 4, false),
      ],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestSupport).toBe(false);
  });

  it('should trigger with exactly 5 consecutive concerning days', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 4, 4), // avg = 4
        createDailyLog('2026-02-03', 4, 4),
        createDailyLog('2026-02-02', 4, 4),
        createDailyLog('2026-02-01', 4, 4),
        createDailyLog('2026-01-31', 4, 4),
      ],
      todayPlans: [
        createTodayPlan(1, '2026-02-04'),
        createTodayPlan(2, '2026-02-03'),
        createTodayPlan(3, '2026-02-02'),
        createTodayPlan(4, '2026-02-01'),
        createTodayPlan(5, '2026-01-31'),
      ],
      todayPlanItems: [
        // Each day: 1/3 completed (33% < 50%)
        createPlanItem(1, 1, true),
        createPlanItem(2, 1, false),
        createPlanItem(3, 1, false),
        
        createPlanItem(4, 2, true),
        createPlanItem(5, 2, false),
        createPlanItem(6, 2, false),
        
        createPlanItem(7, 3, true),
        createPlanItem(8, 3, false),
        createPlanItem(9, 3, false),
        
        createPlanItem(10, 4, true),
        createPlanItem(11, 4, false),
        createPlanItem(12, 4, false),
        
        createPlanItem(13, 5, true),
        createPlanItem(14, 5, false),
        createPlanItem(15, 5, false),
      ],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestSupport).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toContain('support network');
  });

  it('should not trigger when completion rate is exactly 50%', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 4, 4),
        createDailyLog('2026-02-03', 4, 4),
        createDailyLog('2026-02-02', 4, 4),
        createDailyLog('2026-02-01', 4, 4),
        createDailyLog('2026-01-31', 4, 4),
      ],
      todayPlans: [
        createTodayPlan(1, '2026-02-04'),
        createTodayPlan(2, '2026-02-03'),
        createTodayPlan(3, '2026-02-02'),
        createTodayPlan(4, '2026-02-01'),
        createTodayPlan(5, '2026-01-31'),
      ],
      todayPlanItems: [
        // Each day: 2/4 completed (50% - should NOT trigger)
        createPlanItem(1, 1, true),
        createPlanItem(2, 1, true),
        createPlanItem(3, 1, false),
        createPlanItem(4, 1, false),
        
        createPlanItem(5, 2, true),
        createPlanItem(6, 2, true),
        createPlanItem(7, 2, false),
        createPlanItem(8, 2, false),
        
        createPlanItem(9, 3, true),
        createPlanItem(10, 3, true),
        createPlanItem(11, 3, false),
        createPlanItem(12, 3, false),
        
        createPlanItem(13, 4, true),
        createPlanItem(14, 4, true),
        createPlanItem(15, 4, false),
        createPlanItem(16, 4, false),
        
        createPlanItem(17, 5, true),
        createPlanItem(18, 5, true),
        createPlanItem(19, 5, false),
        createPlanItem(20, 5, false),
      ],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestSupport).toBe(false);
  });

  it('should not trigger when avg mood/energy is above 4', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 5, 5), // avg = 5 (above threshold)
        createDailyLog('2026-02-03', 5, 5),
        createDailyLog('2026-02-02', 5, 5),
        createDailyLog('2026-02-01', 5, 5),
        createDailyLog('2026-01-31', 5, 5),
      ],
      todayPlans: [
        createTodayPlan(1, '2026-02-04'),
        createTodayPlan(2, '2026-02-03'),
        createTodayPlan(3, '2026-02-02'),
        createTodayPlan(4, '2026-02-01'),
        createTodayPlan(5, '2026-01-31'),
      ],
      todayPlanItems: [
        // Each day: 0/3 completed (0% < 50%)
        createPlanItem(1, 1, false),
        createPlanItem(2, 1, false),
        createPlanItem(3, 1, false),
        
        createPlanItem(4, 2, false),
        createPlanItem(5, 2, false),
        createPlanItem(6, 2, false),
        
        createPlanItem(7, 3, false),
        createPlanItem(8, 3, false),
        createPlanItem(9, 3, false),
        
        createPlanItem(10, 4, false),
        createPlanItem(11, 4, false),
        createPlanItem(12, 4, false),
        
        createPlanItem(13, 5, false),
        createPlanItem(14, 5, false),
        createPlanItem(15, 5, false),
      ],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestSupport).toBe(false);
  });

  it('should not trigger when streak is broken by missing plan', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 4, 4),
        createDailyLog('2026-02-03', 4, 4),
        createDailyLog('2026-02-02', 4, 4),
        // 2026-02-01 has log but no plan - breaks streak
        createDailyLog('2026-02-01', 4, 4),
        createDailyLog('2026-01-31', 4, 4),
      ],
      todayPlans: [
        createTodayPlan(1, '2026-02-04'),
        createTodayPlan(2, '2026-02-03'),
        createTodayPlan(3, '2026-02-02'),
        // Missing plan for 2026-02-01
        createTodayPlan(5, '2026-01-31'),
      ],
      todayPlanItems: [
        createPlanItem(1, 1, false),
        createPlanItem(2, 1, false),
        createPlanItem(3, 1, false),
        
        createPlanItem(4, 2, false),
        createPlanItem(5, 2, false),
        createPlanItem(6, 2, false),
        
        createPlanItem(7, 3, false),
        createPlanItem(8, 3, false),
        createPlanItem(9, 3, false),
        
        createPlanItem(13, 5, false),
        createPlanItem(14, 5, false),
        createPlanItem(15, 5, false),
      ],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestSupport).toBe(false);
  });

  it('should handle empty plan (0 items) as 0% completion', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 4, 4),
        createDailyLog('2026-02-03', 4, 4),
        createDailyLog('2026-02-02', 4, 4),
        createDailyLog('2026-02-01', 4, 4),
        createDailyLog('2026-01-31', 4, 4),
      ],
      todayPlans: [
        createTodayPlan(1, '2026-02-04'),
        createTodayPlan(2, '2026-02-03'),
        createTodayPlan(3, '2026-02-02'),
        createTodayPlan(4, '2026-02-01'),
        createTodayPlan(5, '2026-01-31'),
      ],
      todayPlanItems: [], // No items for any plan
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestSupport).toBe(true);
  });
});

// ============================================================================
// Combined Guardrail Tests
// ============================================================================

describe('Combined Guardrails', () => {
  it('should trigger both guardrails when both conditions are met', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 3, 3), // Low mood/energy for doctor trigger
        createDailyLog('2026-02-03', 3, 3),
        createDailyLog('2026-02-02', 3, 3),
        createDailyLog('2026-02-01', 3, 3),
        createDailyLog('2026-01-31', 3, 3),
      ],
      todayPlans: [
        createTodayPlan(1, '2026-02-04'),
        createTodayPlan(2, '2026-02-03'),
        createTodayPlan(3, '2026-02-02'),
        createTodayPlan(4, '2026-02-01'),
        createTodayPlan(5, '2026-01-31'),
      ],
      todayPlanItems: [
        // Low completion for support trigger
        createPlanItem(1, 1, false),
        createPlanItem(2, 1, false),
        createPlanItem(3, 1, false),
        
        createPlanItem(4, 2, false),
        createPlanItem(5, 2, false),
        createPlanItem(6, 2, false),
        
        createPlanItem(7, 3, false),
        createPlanItem(8, 3, false),
        createPlanItem(9, 3, false),
        
        createPlanItem(10, 4, false),
        createPlanItem(11, 4, false),
        createPlanItem(12, 4, false),
        
        createPlanItem(13, 5, false),
        createPlanItem(14, 5, false),
        createPlanItem(15, 5, false),
      ],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestDoctor).toBe(true);
    expect(result.shouldSuggestSupport).toBe(true);
    expect(result.messages).toHaveLength(2);
  });

  it('should return empty messages when no triggers are met', () => {
    const input: GuardrailInput = {
      dailyLogs: [
        createDailyLog('2026-02-04', 8, 8), // Good mood/energy
        createDailyLog('2026-02-03', 8, 8),
        createDailyLog('2026-02-02', 8, 8),
      ],
      todayPlans: [
        createTodayPlan(1, '2026-02-04'),
        createTodayPlan(2, '2026-02-03'),
        createTodayPlan(3, '2026-02-02'),
      ],
      todayPlanItems: [
        // High completion
        createPlanItem(1, 1, true),
        createPlanItem(2, 1, true),
        createPlanItem(3, 1, true),
        
        createPlanItem(4, 2, true),
        createPlanItem(5, 2, true),
        createPlanItem(6, 2, true),
        
        createPlanItem(7, 3, true),
        createPlanItem(8, 3, true),
        createPlanItem(9, 3, true),
      ],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestDoctor).toBe(false);
    expect(result.shouldSuggestSupport).toBe(false);
    expect(result.messages).toHaveLength(0);
  });

  it('should handle completely empty input gracefully', () => {
    const input: GuardrailInput = {
      dailyLogs: [],
      todayPlans: [],
      todayPlanItems: [],
      currentDate: '2026-02-04',
    };

    const result = checkGuardrails(input);
    expect(result.shouldSuggestDoctor).toBe(false);
    expect(result.shouldSuggestSupport).toBe(false);
    expect(result.messages).toHaveLength(0);
  });
});
