/**
 * Property-Based Tests for Guardrails Service
 * 
 * Feature: life-manager
 * - Property 20: Safety Guardrail — Doctor Suggestion Trigger
 * - Property 21: Safety Guardrail — Support Suggestion Trigger
 * 
 * Validates: Requirements 8.3, 8.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { checkGuardrails, type GuardrailInput, type DailyLog, type TodayPlan, type TodayPlanItem } from '../guardrails';

// ============================================================================
// Arbitraries (Generators)
// ============================================================================

/**
 * Generate a valid ISO date string (YYYY-MM-DD)
 */
const isoDateArb = fc.date({
  min: new Date('2020-01-01'),
  max: new Date('2030-12-31'),
}).map(date => {
  // Ensure valid date
  if (isNaN(date.getTime())) {
    return '2026-01-01';
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
});

/**
 * Generate a sequence of consecutive dates going backwards from a start date
 */
function generateConsecutiveDates(startDate: string, count: number): string[] {
  const dates: string[] = [];
  const date = new Date(startDate + 'T00:00:00Z');
  
  for (let i = 0; i < count; i++) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    date.setUTCDate(date.getUTCDate() - 1);
  }
  
  return dates;
}

/**
 * Generate a daily log for a specific date
 */
const dailyLogArb = (date: string, options?: {
  mood?: number;
  energy?: number;
}) => fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  date: fc.constant(date),
  hoursSlept: fc.float({ min: 0, max: 24 }),
  energy: options?.energy !== undefined ? fc.constant(options.energy) : fc.integer({ min: 0, max: 10 }),
  mood: options?.mood !== undefined ? fc.constant(options.mood) : fc.integer({ min: 0, max: 10 }),
  medicationTaken: fc.oneof(fc.constant('yes'), fc.constant('no')),
  createdAt: fc.constant(`${date}T00:00:00Z`),
  updatedAt: fc.constant(`${date}T00:00:00Z`),
}) as fc.Arbitrary<DailyLog>;

// ============================================================================
// Property 20: Safety Guardrail — Doctor Suggestion Trigger
// ============================================================================

/**
 * Property 20: Safety Guardrail — Doctor Suggestion Trigger
 * 
 * **Validates: Requirements 8.3**
 * 
 * For any sequence of 3 or more consecutive daily logs where mood ≤ 3 or
 * energy ≤ 3, the guardrail check should return shouldSuggestDoctor = true
 * with a message recommending contacting a doctor or care team.
 */
describe('Property 20: Safety Guardrail — Doctor Suggestion Trigger', () => {
  it('should trigger doctor suggestion for 3+ consecutive days with mood ≤ 3', async () => {
    await fc.assert(
      fc.asyncProperty(
        isoDateArb,
        fc.integer({ min: 3, max: 10 }), // Number of consecutive low mood days
        async (currentDate, consecutiveDays) => {
          const dates = generateConsecutiveDates(currentDate, consecutiveDays);
          
          // Create daily logs with mood ≤ 3 for all consecutive days
          const dailyLogs: DailyLog[] = [];
          for (let i = 0; i < consecutiveDays; i++) {
            dailyLogs.push({
              id: i + 1,
              date: dates[i],
              hoursSlept: 8,
              energy: 5, // Normal energy
              mood: fc.sample(fc.integer({ min: 0, max: 3 }), 1)[0], // mood ≤ 3
              medicationTaken: 'yes',
              createdAt: `${dates[i]}T00:00:00Z`,
              updatedAt: `${dates[i]}T00:00:00Z`,
            });
          }
          
          const input: GuardrailInput = {
            dailyLogs,
            todayPlans: [],
            todayPlanItems: [],
            currentDate,
          };
          
          const result = checkGuardrails(input);
          
          // Should trigger doctor suggestion
          expect(result.shouldSuggestDoctor).toBe(true);
          expect(result.messages.length).toBeGreaterThan(0);
          
          // Message should mention doctor or care team
          const hasRelevantMessage = result.messages.some(msg =>
            msg.toLowerCase().includes('doctor') || msg.toLowerCase().includes('care team')
          );
          expect(hasRelevantMessage).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should trigger doctor suggestion for 3+ consecutive days with energy ≤ 3', async () => {
    await fc.assert(
      fc.asyncProperty(
        isoDateArb,
        fc.integer({ min: 3, max: 10 }), // Number of consecutive low energy days
        async (currentDate, consecutiveDays) => {
          const dates = generateConsecutiveDates(currentDate, consecutiveDays);
          
          // Create daily logs with energy ≤ 3 for all consecutive days
          const dailyLogs: DailyLog[] = [];
          for (let i = 0; i < consecutiveDays; i++) {
            dailyLogs.push({
              id: i + 1,
              date: dates[i],
              hoursSlept: 8,
              energy: fc.sample(fc.integer({ min: 0, max: 3 }), 1)[0], // energy ≤ 3
              mood: 5, // Normal mood
              medicationTaken: 'yes',
              createdAt: `${dates[i]}T00:00:00Z`,
              updatedAt: `${dates[i]}T00:00:00Z`,
            });
          }
          
          const input: GuardrailInput = {
            dailyLogs,
            todayPlans: [],
            todayPlanItems: [],
            currentDate,
          };
          
          const result = checkGuardrails(input);
          
          // Should trigger doctor suggestion
          expect(result.shouldSuggestDoctor).toBe(true);
          expect(result.messages.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should NOT trigger doctor suggestion for fewer than 3 consecutive days', async () => {
    await fc.assert(
      fc.asyncProperty(
        isoDateArb,
        fc.integer({ min: 1, max: 2 }), // Only 1-2 consecutive days
        async (currentDate, consecutiveDays) => {
          const dates = generateConsecutiveDates(currentDate, consecutiveDays);
          
          // Create daily logs with low mood/energy
          const dailyLogs: DailyLog[] = [];
          for (let i = 0; i < consecutiveDays; i++) {
            dailyLogs.push({
              id: i + 1,
              date: dates[i],
              hoursSlept: 8,
              energy: 2, // Low energy
              mood: 2, // Low mood
              medicationTaken: 'yes',
              createdAt: `${dates[i]}T00:00:00Z`,
              updatedAt: `${dates[i]}T00:00:00Z`,
            });
          }
          
          const input: GuardrailInput = {
            dailyLogs,
            todayPlans: [],
            todayPlanItems: [],
            currentDate,
          };
          
          const result = checkGuardrails(input);
          
          // Should NOT trigger doctor suggestion (need 3+ days)
          expect(result.shouldSuggestDoctor).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should NOT trigger doctor suggestion when streak is broken', async () => {
    await fc.assert(
      fc.asyncProperty(
        isoDateArb,
        async (currentDate) => {
          const dates = generateConsecutiveDates(currentDate, 5);
          
          // Create daily logs: 2 low days, 1 normal day, 2 low days
          const dailyLogs: DailyLog[] = [
            // Day 0 (today): low
            {
              id: 1,
              date: dates[0],
              hoursSlept: 8,
              energy: 2,
              mood: 2,
              medicationTaken: 'yes',
              createdAt: `${dates[0]}T00:00:00Z`,
              updatedAt: `${dates[0]}T00:00:00Z`,
            },
            // Day 1: low
            {
              id: 2,
              date: dates[1],
              hoursSlept: 8,
              energy: 2,
              mood: 2,
              medicationTaken: 'yes',
              createdAt: `${dates[1]}T00:00:00Z`,
              updatedAt: `${dates[1]}T00:00:00Z`,
            },
            // Day 2: NORMAL (breaks streak)
            {
              id: 3,
              date: dates[2],
              hoursSlept: 8,
              energy: 7,
              mood: 7,
              medicationTaken: 'yes',
              createdAt: `${dates[2]}T00:00:00Z`,
              updatedAt: `${dates[2]}T00:00:00Z`,
            },
            // Day 3: low
            {
              id: 4,
              date: dates[3],
              hoursSlept: 8,
              energy: 2,
              mood: 2,
              medicationTaken: 'yes',
              createdAt: `${dates[3]}T00:00:00Z`,
              updatedAt: `${dates[3]}T00:00:00Z`,
            },
            // Day 4: low
            {
              id: 5,
              date: dates[4],
              hoursSlept: 8,
              energy: 2,
              mood: 2,
              medicationTaken: 'yes',
              createdAt: `${dates[4]}T00:00:00Z`,
              updatedAt: `${dates[4]}T00:00:00Z`,
            },
          ];
          
          const input: GuardrailInput = {
            dailyLogs,
            todayPlans: [],
            todayPlanItems: [],
            currentDate,
          };
          
          const result = checkGuardrails(input);
          
          // Should NOT trigger because streak is broken (only 2 consecutive from today)
          expect(result.shouldSuggestDoctor).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 21: Safety Guardrail — Support Suggestion Trigger
// ============================================================================

/**
 * Property 21: Safety Guardrail — Support Suggestion Trigger
 * 
 * **Validates: Requirements 8.4**
 * 
 * For any sequence of 5 or more consecutive days where Today Plan completion
 * rate is below 50% and average mood or energy is ≤ 4, the guardrail check
 * should return shouldSuggestSupport = true with a message recommending
 * reaching out to support network.
 */
describe('Property 21: Safety Guardrail — Support Suggestion Trigger', () => {
  it('should trigger support suggestion for 5+ days with <50% completion and avg mood/energy ≤ 4', async () => {
    await fc.assert(
      fc.asyncProperty(
        isoDateArb,
        fc.integer({ min: 5, max: 10 }), // Number of consecutive concerning days
        async (currentDate, consecutiveDays) => {
          const dates = generateConsecutiveDates(currentDate, consecutiveDays);
          
          // Create daily logs with mood and energy that average ≤ 4
          const dailyLogs: DailyLog[] = [];
          const todayPlans: TodayPlan[] = [];
          const todayPlanItems: TodayPlanItem[] = [];
          
          for (let i = 0; i < consecutiveDays; i++) {
            const planId = i + 1;
            
            // Create log with mood=3, energy=5 (avg = 4)
            dailyLogs.push({
              id: i + 1,
              date: dates[i],
              hoursSlept: 8,
              energy: 5,
              mood: 3,
              medicationTaken: 'yes',
              createdAt: `${dates[i]}T00:00:00Z`,
              updatedAt: `${dates[i]}T00:00:00Z`,
            });
            
            // Create plan
            todayPlans.push({
              id: planId,
              date: dates[i],
              energyLevel: 5,
              createdAt: `${dates[i]}T00:00:00Z`,
            });
            
            // Create plan items with <50% completion (2 out of 5 completed = 40%)
            for (let j = 0; j < 5; j++) {
              todayPlanItems.push({
                id: i * 5 + j + 1,
                planId,
                taskId: i * 5 + j + 1,
                category: 'must-do',
                completed: j < 2, // Only first 2 completed (40%)
                snoozed: false,
              });
            }
          }
          
          const input: GuardrailInput = {
            dailyLogs,
            todayPlans,
            todayPlanItems,
            currentDate,
          };
          
          const result = checkGuardrails(input);
          
          // Should trigger support suggestion
          expect(result.shouldSuggestSupport).toBe(true);
          expect(result.messages.length).toBeGreaterThan(0);
          
          // Message should mention support network
          const hasRelevantMessage = result.messages.some(msg =>
            msg.toLowerCase().includes('support')
          );
          expect(hasRelevantMessage).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should NOT trigger support suggestion for fewer than 5 consecutive days', async () => {
    await fc.assert(
      fc.asyncProperty(
        isoDateArb,
        fc.integer({ min: 1, max: 4 }), // Only 1-4 consecutive days
        async (currentDate, consecutiveDays) => {
          const dates = generateConsecutiveDates(currentDate, consecutiveDays);
          
          const dailyLogs: DailyLog[] = [];
          const todayPlans: TodayPlan[] = [];
          const todayPlanItems: TodayPlanItem[] = [];
          
          for (let i = 0; i < consecutiveDays; i++) {
            const planId = i + 1;
            
            // Create log with low mood/energy
            dailyLogs.push({
              id: i + 1,
              date: dates[i],
              hoursSlept: 8,
              energy: 4,
              mood: 4,
              medicationTaken: 'yes',
              createdAt: `${dates[i]}T00:00:00Z`,
              updatedAt: `${dates[i]}T00:00:00Z`,
            });
            
            // Create plan
            todayPlans.push({
              id: planId,
              date: dates[i],
              energyLevel: 5,
              createdAt: `${dates[i]}T00:00:00Z`,
            });
            
            // Create plan items with <50% completion
            for (let j = 0; j < 5; j++) {
              todayPlanItems.push({
                id: i * 5 + j + 1,
                planId,
                taskId: i * 5 + j + 1,
                category: 'must-do',
                completed: j < 2, // 40% completion
                snoozed: false,
              });
            }
          }
          
          const input: GuardrailInput = {
            dailyLogs,
            todayPlans,
            todayPlanItems,
            currentDate,
          };
          
          const result = checkGuardrails(input);
          
          // Should NOT trigger support suggestion (need 5+ days)
          expect(result.shouldSuggestSupport).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should NOT trigger support suggestion when completion rate is ≥ 50%', async () => {
    await fc.assert(
      fc.asyncProperty(
        isoDateArb,
        async (currentDate) => {
          const dates = generateConsecutiveDates(currentDate, 5);
          
          const dailyLogs: DailyLog[] = [];
          const todayPlans: TodayPlan[] = [];
          const todayPlanItems: TodayPlanItem[] = [];
          
          for (let i = 0; i < 5; i++) {
            const planId = i + 1;
            
            // Create log with low mood/energy
            dailyLogs.push({
              id: i + 1,
              date: dates[i],
              hoursSlept: 8,
              energy: 4,
              mood: 4,
              medicationTaken: 'yes',
              createdAt: `${dates[i]}T00:00:00Z`,
              updatedAt: `${dates[i]}T00:00:00Z`,
            });
            
            // Create plan
            todayPlans.push({
              id: planId,
              date: dates[i],
              energyLevel: 5,
              createdAt: `${dates[i]}T00:00:00Z`,
            });
            
            // Create plan items with ≥50% completion (3 out of 5 = 60%)
            for (let j = 0; j < 5; j++) {
              todayPlanItems.push({
                id: i * 5 + j + 1,
                planId,
                taskId: i * 5 + j + 1,
                category: 'must-do',
                completed: j < 3, // 60% completion
                snoozed: false,
              });
            }
          }
          
          const input: GuardrailInput = {
            dailyLogs,
            todayPlans,
            todayPlanItems,
            currentDate,
          };
          
          const result = checkGuardrails(input);
          
          // Should NOT trigger support suggestion (completion rate is good)
          expect(result.shouldSuggestSupport).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should NOT trigger support suggestion when avg mood/energy > 4', async () => {
    await fc.assert(
      fc.asyncProperty(
        isoDateArb,
        async (currentDate) => {
          const dates = generateConsecutiveDates(currentDate, 5);
          
          const dailyLogs: DailyLog[] = [];
          const todayPlans: TodayPlan[] = [];
          const todayPlanItems: TodayPlanItem[] = [];
          
          for (let i = 0; i < 5; i++) {
            const planId = i + 1;
            
            // Create log with mood=5, energy=6 (avg = 5.5 > 4)
            dailyLogs.push({
              id: i + 1,
              date: dates[i],
              hoursSlept: 8,
              energy: 6,
              mood: 5,
              medicationTaken: 'yes',
              createdAt: `${dates[i]}T00:00:00Z`,
              updatedAt: `${dates[i]}T00:00:00Z`,
            });
            
            // Create plan
            todayPlans.push({
              id: planId,
              date: dates[i],
              energyLevel: 5,
              createdAt: `${dates[i]}T00:00:00Z`,
            });
            
            // Create plan items with <50% completion
            for (let j = 0; j < 5; j++) {
              todayPlanItems.push({
                id: i * 5 + j + 1,
                planId,
                taskId: i * 5 + j + 1,
                category: 'must-do',
                completed: j < 2, // 40% completion
                snoozed: false,
              });
            }
          }
          
          const input: GuardrailInput = {
            dailyLogs,
            todayPlans,
            todayPlanItems,
            currentDate,
          };
          
          const result = checkGuardrails(input);
          
          // Should NOT trigger support suggestion (mood/energy is good)
          expect(result.shouldSuggestSupport).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should NOT trigger support suggestion when streak is broken', async () => {
    await fc.assert(
      fc.asyncProperty(
        isoDateArb,
        async (currentDate) => {
          const dates = generateConsecutiveDates(currentDate, 7);
          
          const dailyLogs: DailyLog[] = [];
          const todayPlans: TodayPlan[] = [];
          const todayPlanItems: TodayPlanItem[] = [];
          
          for (let i = 0; i < 7; i++) {
            const planId = i + 1;
            
            // Day 2 (index 2) will be a "good" day that breaks the streak
            const isGoodDay = i === 2;
            
            dailyLogs.push({
              id: i + 1,
              date: dates[i],
              hoursSlept: 8,
              energy: isGoodDay ? 8 : 4,
              mood: isGoodDay ? 8 : 4,
              medicationTaken: 'yes',
              createdAt: `${dates[i]}T00:00:00Z`,
              updatedAt: `${dates[i]}T00:00:00Z`,
            });
            
            todayPlans.push({
              id: planId,
              date: dates[i],
              energyLevel: 5,
              createdAt: `${dates[i]}T00:00:00Z`,
            });
            
            // Good day has high completion, bad days have low completion
            const numCompleted = isGoodDay ? 4 : 2;
            for (let j = 0; j < 5; j++) {
              todayPlanItems.push({
                id: i * 5 + j + 1,
                planId,
                taskId: i * 5 + j + 1,
                category: 'must-do',
                completed: j < numCompleted,
                snoozed: false,
              });
            }
          }
          
          const input: GuardrailInput = {
            dailyLogs,
            todayPlans,
            todayPlanItems,
            currentDate,
          };
          
          const result = checkGuardrails(input);
          
          // Should NOT trigger because streak is broken (only 2 consecutive from today)
          expect(result.shouldSuggestSupport).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Additional Property Tests
// ============================================================================

describe('Guardrails - General Properties', () => {
  it('should never return negative values or undefined fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        isoDateArb,
        fc.array(dailyLogArb('2026-01-01'), { maxLength: 30 }),
        async (currentDate, logs) => {
          const input: GuardrailInput = {
            dailyLogs: logs,
            todayPlans: [],
            todayPlanItems: [],
            currentDate,
          };
          
          const result = checkGuardrails(input);
          
          // All fields should be defined
          expect(result.shouldSuggestDoctor).toBeDefined();
          expect(result.shouldSuggestSupport).toBeDefined();
          expect(result.messages).toBeDefined();
          
          // Booleans should be boolean
          expect(typeof result.shouldSuggestDoctor).toBe('boolean');
          expect(typeof result.shouldSuggestSupport).toBe('boolean');
          
          // Messages should be an array
          expect(Array.isArray(result.messages)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return empty messages when no triggers are met', async () => {
    await fc.assert(
      fc.asyncProperty(
        isoDateArb,
        async (currentDate) => {
          const dates = generateConsecutiveDates(currentDate, 5);
          
          // Create "good" logs (high mood/energy, good completion)
          const dailyLogs: DailyLog[] = [];
          const todayPlans: TodayPlan[] = [];
          const todayPlanItems: TodayPlanItem[] = [];
          
          for (let i = 0; i < 5; i++) {
            const planId = i + 1;
            
            dailyLogs.push({
              id: i + 1,
              date: dates[i],
              hoursSlept: 8,
              energy: 8,
              mood: 8,
              medicationTaken: 'yes',
              createdAt: `${dates[i]}T00:00:00Z`,
              updatedAt: `${dates[i]}T00:00:00Z`,
            });
            
            todayPlans.push({
              id: planId,
              date: dates[i],
              energyLevel: 8,
              createdAt: `${dates[i]}T00:00:00Z`,
            });
            
            // High completion rate
            for (let j = 0; j < 5; j++) {
              todayPlanItems.push({
                id: i * 5 + j + 1,
                planId,
                taskId: i * 5 + j + 1,
                category: 'must-do',
                completed: j < 4, // 80% completion
                snoozed: false,
              });
            }
          }
          
          const input: GuardrailInput = {
            dailyLogs,
            todayPlans,
            todayPlanItems,
            currentDate,
          };
          
          const result = checkGuardrails(input);
          
          // No triggers should be met
          expect(result.shouldSuggestDoctor).toBe(false);
          expect(result.shouldSuggestSupport).toBe(false);
          expect(result.messages).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
