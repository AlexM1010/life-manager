/**
 * Property-Based Tests for Streak Service
 * 
 * Feature: life-manager, Property 16: Streak Calculation
 * 
 * Validates: Requirements 6.1, 6.2, 6.3
 * 
 * Property 16: Streak Calculation
 * For any ordered sequence of daily records (logs and task completions), each streak type
 * should equal the count of consecutive days from today backwards where its condition holds:
 * - Medication streak: consecutive days with medicationTaken = "yes"
 * - Health-task streak: consecutive days with ≥1 completion in a health domain
 * - BBI streak: consecutive days with ≥1 completion in a BBI domain
 * A gap (missing day or condition not met) resets the streak to zero.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { calculateStreaks, type StreakInput, type DailyLog, type TaskCompletion, type Domain } from '../streaks';

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
  // Ensure we have a valid date
  if (isNaN(date.getTime())) {
    return '2026-01-01'; // Fallback to a valid date
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
});

/**
 * Generate a domain
 */
const domainArb = fc.record({
  id: fc.integer({ min: 1, max: 100 }),
  name: fc.oneof(
    fc.constant('Health'),
    fc.constant('Mental Health'),
    fc.constant('Physical Health'),
    fc.constant('Admin'),
    fc.constant('Work'),
    fc.constant('Creative'),
    fc.constant('Relationships'),
  ),
  description: fc.constant(''),
  whyItMatters: fc.constant(''),
  boringButImportant: fc.boolean(),
  createdAt: fc.constant('2026-01-01T00:00:00Z'),
  updatedAt: fc.constant('2026-01-01T00:00:00Z'),
});

/**
 * Generate a sequence of consecutive dates going backwards from a start date
 */
function generateConsecutiveDates(startDate: string, count: number): string[] {
  const dates: string[] = [];
  const date = new Date(startDate + 'T00:00:00Z');
  
  // Validate the input date
  if (isNaN(date.getTime())) {
    // Return empty array for invalid dates
    return [];
  }
  
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
 * Manually calculate expected medication streak
 */
function expectedMedicationStreak(logs: DailyLog[], currentDate: string): number {
  const logsByDate = new Map(logs.map(log => [log.date, log]));
  const dates = generateConsecutiveDates(currentDate, 365);
  
  let streak = 0;
  for (const date of dates) {
    const log = logsByDate.get(date);
    if (!log || log.medicationTaken !== 'yes') {
      break;
    }
    streak++;
  }
  
  return streak;
}

/**
 * Manually calculate expected health task streak
 */
function expectedHealthTaskStreak(
  completions: TaskCompletion[],
  domains: Domain[],
  currentDate: string
): number {
  const healthDomainIds = new Set(
    domains.filter(d => d.name.toLowerCase().includes('health')).map(d => d.id)
  );
  
  if (healthDomainIds.size === 0) {
    return 0;
  }
  
  const completionsByDate = new Map<string, TaskCompletion[]>();
  for (const completion of completions) {
    if (!completionsByDate.has(completion.completedDate)) {
      completionsByDate.set(completion.completedDate, []);
    }
    completionsByDate.get(completion.completedDate)!.push(completion);
  }
  
  const dates = generateConsecutiveDates(currentDate, 365);
  let streak = 0;
  
  for (const date of dates) {
    const dayCompletions = completionsByDate.get(date) || [];
    const hasHealthCompletion = dayCompletions.some(c => healthDomainIds.has(c.domainId));
    
    if (!hasHealthCompletion) {
      break;
    }
    streak++;
  }
  
  return streak;
}

/**
 * Manually calculate expected BBI streak
 */
function expectedBBIStreak(
  completions: TaskCompletion[],
  domains: Domain[],
  currentDate: string
): number {
  const bbiDomainIds = new Set(
    domains.filter(d => d.boringButImportant).map(d => d.id)
  );
  
  if (bbiDomainIds.size === 0) {
    return 0;
  }
  
  const completionsByDate = new Map<string, TaskCompletion[]>();
  for (const completion of completions) {
    if (!completionsByDate.has(completion.completedDate)) {
      completionsByDate.set(completion.completedDate, []);
    }
    completionsByDate.get(completion.completedDate)!.push(completion);
  }
  
  const dates = generateConsecutiveDates(currentDate, 365);
  let streak = 0;
  
  for (const date of dates) {
    const dayCompletions = completionsByDate.get(date) || [];
    const hasBBICompletion = dayCompletions.some(c => bbiDomainIds.has(c.domainId));
    
    if (!hasBBICompletion) {
      break;
    }
    streak++;
  }
  
  return streak;
}

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 16: Streak Calculation', () => {
  it('medication streak should match manual calculation for any sequence of logs', () => {
    fc.assert(
      fc.property(
        isoDateArb,
        fc.integer({ min: 0, max: 30 }),
        fc.array(fc.boolean(), { minLength: 0, maxLength: 30 }),
        (currentDate, numDays, medicationPattern) => {
          // Generate consecutive dates
          const dates = generateConsecutiveDates(currentDate, numDays);
          
          // Create daily logs based on medication pattern
          const dailyLogs: DailyLog[] = dates.slice(0, medicationPattern.length).map((date, i) => ({
            id: i + 1,
            date,
            hoursSlept: 8,
            energy: 5,
            mood: 5,
            medicationTaken: medicationPattern[i] ? 'yes' : 'no',
            createdAt: `${date}T00:00:00Z`,
            updatedAt: `${date}T00:00:00Z`,
          }));
          
          const input: StreakInput = {
            dailyLogs,
            taskCompletions: [],
            domains: [],
            currentDate,
          };
          
          const result = calculateStreaks(input);
          const expected = expectedMedicationStreak(dailyLogs, currentDate);
          
          expect(result.medication).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('health task streak should match manual calculation for any sequence of completions', () => {
    fc.assert(
      fc.property(
        isoDateArb,
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 30 }),
        fc.array(fc.boolean(), { minLength: 0, maxLength: 30 }),
        (currentDate, numDomains, numDays, completionPattern) => {
          // Generate domains (at least one health domain)
          const domains: Domain[] = [];
          for (let i = 0; i < numDomains; i++) {
            domains.push({
              id: i + 1,
              name: i === 0 ? 'Health' : `Domain${i}`,
              description: '',
              whyItMatters: '',
              boringButImportant: false,
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            });
          }
          
          // Generate consecutive dates
          const dates = generateConsecutiveDates(currentDate, numDays);
          
          // Create task completions based on completion pattern
          const taskCompletions: TaskCompletion[] = [];
          dates.slice(0, completionPattern.length).forEach((date, i) => {
            if (completionPattern[i]) {
              taskCompletions.push({
                id: taskCompletions.length + 1,
                taskId: taskCompletions.length + 1,
                domainId: 1, // Health domain
                completedAt: `${date}T12:00:00Z`,
                completedDate: date,
              });
            }
          });
          
          const input: StreakInput = {
            dailyLogs: [],
            taskCompletions,
            domains,
            currentDate,
          };
          
          const result = calculateStreaks(input);
          const expected = expectedHealthTaskStreak(taskCompletions, domains, currentDate);
          
          expect(result.healthTask).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('BBI streak should match manual calculation for any sequence of completions', () => {
    fc.assert(
      fc.property(
        isoDateArb,
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 30 }),
        fc.array(fc.boolean(), { minLength: 0, maxLength: 30 }),
        (currentDate, numDomains, numDays, completionPattern) => {
          // Generate domains (at least one BBI domain)
          const domains: Domain[] = [];
          for (let i = 0; i < numDomains; i++) {
            domains.push({
              id: i + 1,
              name: `Domain${i}`,
              description: '',
              whyItMatters: '',
              boringButImportant: i === 0, // First domain is BBI
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            });
          }
          
          // Generate consecutive dates
          const dates = generateConsecutiveDates(currentDate, numDays);
          
          // Create task completions based on completion pattern
          const taskCompletions: TaskCompletion[] = [];
          dates.slice(0, completionPattern.length).forEach((date, i) => {
            if (completionPattern[i]) {
              taskCompletions.push({
                id: taskCompletions.length + 1,
                taskId: taskCompletions.length + 1,
                domainId: 1, // BBI domain
                completedAt: `${date}T12:00:00Z`,
                completedDate: date,
              });
            }
          });
          
          const input: StreakInput = {
            dailyLogs: [],
            taskCompletions,
            domains,
            currentDate,
          };
          
          const result = calculateStreaks(input);
          const expected = expectedBBIStreak(taskCompletions, domains, currentDate);
          
          expect(result.boringButImportant).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('streaks should never be negative', () => {
    fc.assert(
      fc.property(
        isoDateArb,
        fc.array(domainArb, { minLength: 0, maxLength: 10 }),
        fc.integer({ min: 0, max: 30 }),
        (currentDate, domains, numDays) => {
          // Ensure unique domain IDs
          const uniqueDomains = domains.map((d, i) => ({ ...d, id: i + 1 }));
          const domainIds = uniqueDomains.map(d => d.id);
          
          const dates = generateConsecutiveDates(currentDate, numDays);
          
          // Generate random logs and completions
          const dailyLogs: DailyLog[] = dates.map((date, i) => ({
            id: i + 1,
            date,
            hoursSlept: 8,
            energy: 5,
            mood: 5,
            medicationTaken: Math.random() > 0.5 ? 'yes' : 'no',
            createdAt: `${date}T00:00:00Z`,
            updatedAt: `${date}T00:00:00Z`,
          }));
          
          const taskCompletions: TaskCompletion[] = [];
          if (domainIds.length > 0) {
            dates.forEach((date) => {
              if (Math.random() > 0.5) {
                taskCompletions.push({
                  id: taskCompletions.length + 1,
                  taskId: taskCompletions.length + 1,
                  domainId: domainIds[Math.floor(Math.random() * domainIds.length)],
                  completedAt: `${date}T12:00:00Z`,
                  completedDate: date,
                });
              }
            });
          }
          
          const input: StreakInput = {
            dailyLogs,
            taskCompletions,
            domains: uniqueDomains,
            currentDate,
          };
          
          const result = calculateStreaks(input);
          
          expect(result.medication).toBeGreaterThanOrEqual(0);
          expect(result.healthTask).toBeGreaterThanOrEqual(0);
          expect(result.boringButImportant).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('streaks should not exceed the number of available days', () => {
    fc.assert(
      fc.property(
        isoDateArb,
        fc.array(domainArb, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 30 }),
        (currentDate, domains, numDays) => {
          // Ensure unique domain IDs and at least one health and one BBI domain
          const uniqueDomains = domains.map((d, i) => ({
            ...d,
            id: i + 1,
            name: i === 0 ? 'Health' : d.name,
            boringButImportant: i === 1 || d.boringButImportant,
          }));
          
          const dates = generateConsecutiveDates(currentDate, numDays);
          
          // Create perfect streaks (all conditions met every day)
          const dailyLogs: DailyLog[] = dates.map((date, i) => ({
            id: i + 1,
            date,
            hoursSlept: 8,
            energy: 5,
            mood: 5,
            medicationTaken: 'yes',
            createdAt: `${date}T00:00:00Z`,
            updatedAt: `${date}T00:00:00Z`,
          }));
          
          const taskCompletions: TaskCompletion[] = [];
          dates.forEach((date) => {
            // Add health completion
            taskCompletions.push({
              id: taskCompletions.length + 1,
              taskId: taskCompletions.length + 1,
              domainId: 1, // Health domain
              completedAt: `${date}T12:00:00Z`,
              completedDate: date,
            });
            
            // Add BBI completion
            if (uniqueDomains.length > 1) {
              taskCompletions.push({
                id: taskCompletions.length + 1,
                taskId: taskCompletions.length + 1,
                domainId: 2, // BBI domain
                completedAt: `${date}T12:00:00Z`,
                completedDate: date,
              });
            }
          });
          
          const input: StreakInput = {
            dailyLogs,
            taskCompletions,
            domains: uniqueDomains,
            currentDate,
          };
          
          const result = calculateStreaks(input);
          
          expect(result.medication).toBeLessThanOrEqual(numDays);
          expect(result.healthTask).toBeLessThanOrEqual(numDays);
          expect(result.boringButImportant).toBeLessThanOrEqual(numDays);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty input should always return zero streaks', () => {
    fc.assert(
      fc.property(
        isoDateArb,
        (currentDate) => {
          const input: StreakInput = {
            dailyLogs: [],
            taskCompletions: [],
            domains: [],
            currentDate,
          };
          
          const result = calculateStreaks(input);
          
          expect(result.medication).toBe(0);
          expect(result.healthTask).toBe(0);
          expect(result.boringButImportant).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('streak should break at first gap in consecutive days', () => {
    fc.assert(
      fc.property(
        isoDateArb,
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        (currentDate, streakLength, gapSize) => {
          const dates = generateConsecutiveDates(currentDate, streakLength + gapSize + 10);
          
          // Create logs for streak days, skip gap days, then add more logs
          const dailyLogs: DailyLog[] = [];
          
          // Streak days (from currentDate backwards)
          for (let i = 0; i < streakLength; i++) {
            dailyLogs.push({
              id: i + 1,
              date: dates[i],
              hoursSlept: 8,
              energy: 5,
              mood: 5,
              medicationTaken: 'yes',
              createdAt: `${dates[i]}T00:00:00Z`,
              updatedAt: `${dates[i]}T00:00:00Z`,
            });
          }
          
          // Gap (no logs for gapSize days)
          
          // More logs after gap (should not count)
          for (let i = streakLength + gapSize; i < dates.length; i++) {
            dailyLogs.push({
              id: i + 1,
              date: dates[i],
              hoursSlept: 8,
              energy: 5,
              mood: 5,
              medicationTaken: 'yes',
              createdAt: `${dates[i]}T00:00:00Z`,
              updatedAt: `${dates[i]}T00:00:00Z`,
            });
          }
          
          const input: StreakInput = {
            dailyLogs,
            taskCompletions: [],
            domains: [],
            currentDate,
          };
          
          const result = calculateStreaks(input);
          
          // Streak should equal streakLength (stops at gap)
          expect(result.medication).toBe(streakLength);
        }
      ),
      { numRuns: 100 }
    );
  });
});
