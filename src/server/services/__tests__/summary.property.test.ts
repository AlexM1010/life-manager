/**
 * Property-Based Tests for Summary Service
 * 
 * Feature: life-manager
 * - Property 18: Weekly Summary Completeness
 * - Property 19: Weekly Summary Plain Text Format
 * 
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { generateWeeklySummary, type SummaryInput, type DailyLog, type TaskCompletion, type Domain, type Streaks, type DomainBalance } from '../summary';

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
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
});

/**
 * Generate a sequence of consecutive dates
 */
function generateConsecutiveDates(startDate: string, count: number): string[] {
  const dates: string[] = [];
  const date = new Date(startDate + 'T00:00:00Z');
  
  for (let i = 0; i < count; i++) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    date.setUTCDate(date.getUTCDate() + 1);
  }
  
  return dates;
}

/**
 * Generate a daily log
 */
const dailyLogArb = (date: string) => fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  date: fc.constant(date),
  hoursSlept: fc.float({ min: 0, max: 24, noNaN: true }),
  energy: fc.integer({ min: 0, max: 10 }),
  mood: fc.integer({ min: 0, max: 10 }),
  medicationTaken: fc.oneof(fc.constant('yes'), fc.constant('no')),
  createdAt: fc.constant(`${date}T00:00:00Z`),
  updatedAt: fc.constant(`${date}T00:00:00Z`),
}) as fc.Arbitrary<DailyLog>;

/**
 * Generate a domain with realistic names (alphanumeric + spaces, no special chars)
 */
const domainArb = fc.record({
  id: fc.integer({ min: 1, max: 1000 }),
  name: fc.stringMatching(/^[A-Za-z0-9 ]{1,50}$/).filter(s => s.trim().length > 0),
  description: fc.string({ maxLength: 200 }),
  whyItMatters: fc.string({ maxLength: 200 }),
  boringButImportant: fc.boolean(),
  createdAt: fc.constant('2024-01-01T00:00:00Z'),
  updatedAt: fc.constant('2024-01-01T00:00:00Z'),
}) as fc.Arbitrary<Domain>;

/**
 * Generate a task completion
 */
const taskCompletionArb = (date: string, domainIds: number[]) => {
  if (domainIds.length === 0) {
    domainIds = [1];
  }
  
  return fc.record({
    id: fc.integer({ min: 1, max: 10000 }),
    taskId: fc.integer({ min: 1, max: 10000 }),
    domainId: fc.constantFrom(...domainIds),
    completedAt: fc.constant(`${date}T12:00:00Z`),
    completedDate: fc.constant(date),
  }) as fc.Arbitrary<TaskCompletion>;
};

/**
 * Generate streaks
 */
const streaksArb = fc.record({
  medication: fc.integer({ min: 0, max: 365 }),
  healthTask: fc.integer({ min: 0, max: 365 }),
  boringButImportant: fc.integer({ min: 0, max: 365 }),
}) as fc.Arbitrary<Streaks>;

/**
 * Generate a complete SummaryInput
 */
const summaryInputArb = fc.record({
  startDate: isoDateArb,
}).chain(({ startDate }) => {
  const dates = generateConsecutiveDates(startDate, 7);
  const endDate = dates[6];
  
  return fc.record({
    domains: fc.array(domainArb, { minLength: 1, maxLength: 10 })
      .map(domains => {
        // Ensure unique domain IDs
        const uniqueDomains = new Map<number, Domain>();
        for (const domain of domains) {
          uniqueDomains.set(domain.id, domain);
        }
        return Array.from(uniqueDomains.values());
      }),
  }).chain(({ domains }) => {
    const domainIds = domains.map(d => d.id);
    
    return fc.record({
      domains: fc.constant(domains),
      dailyLogs: fc.array(
        fc.constantFrom(...dates).chain(date => dailyLogArb(date)),
        { maxLength: 7 }
      ),
      taskCompletions: fc.array(
        fc.constantFrom(...dates).chain(date => taskCompletionArb(date, domainIds)),
        { maxLength: 50 }
      ),
      streaks: streaksArb,
    }).chain(({ domains, dailyLogs, taskCompletions, streaks }) => {
      // Generate domain balance based on actual completions
      const completionCounts = new Map<number, number>();
      for (const domain of domains) {
        completionCounts.set(domain.id, 0);
      }
      for (const completion of taskCompletions) {
        const count = completionCounts.get(completion.domainId) || 0;
        completionCounts.set(completion.domainId, count + 1);
      }
      
      const balance: DomainBalance[] = domains.map(domain => ({
        domainId: domain.id,
        name: domain.name,
        completions7d: completionCounts.get(domain.id) || 0,
        neglected: (completionCounts.get(domain.id) || 0) === 0,
      }));
      
      return fc.constant({
        dailyLogs,
        taskCompletions,
        domains,
        streaks,
        balance,
        startDate,
        endDate,
      });
    });
  });
}) as fc.Arbitrary<SummaryInput>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate average of an array of numbers
 */
function average(numbers: number[]): number {
  if (numbers.length === 0) {
    return 0;
  }
  const sum = numbers.reduce((acc, n) => acc + n, 0);
  return sum / numbers.length;
}

/**
 * Format a number to 1 decimal place
 */
function formatDecimal(num: number): string {
  return num.toFixed(1);
}

// ============================================================================
// Property 18: Weekly Summary Completeness
// ============================================================================

/**
 * Property 18: Weekly Summary Completeness
 * 
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
 * 
 * For any 7-day window of daily logs and task completions, the generated
 * weekly summary text should contain:
 * (a) the arithmetic mean of hoursSlept, energy, and mood
 * (b) task completion count per domain
 * (c) current streak values
 * (d) names of all neglected domains
 */
describe('Property 18: Weekly Summary Completeness', () => {
  it('should contain arithmetic mean of hoursSlept, energy, and mood', async () => {
    await fc.assert(
      fc.asyncProperty(
        summaryInputArb,
        async (input) => {
          const summary = generateWeeklySummary(input);
          
          if (input.dailyLogs.length === 0) {
            // If no logs, summary should indicate this
            expect(summary).toContain('No daily logs');
            return;
          }
          
          // Calculate expected averages
          const avgSleep = average(input.dailyLogs.map(log => log.hoursSlept));
          const avgEnergy = average(input.dailyLogs.map(log => log.energy));
          const avgMood = average(input.dailyLogs.map(log => log.mood));
          
          // Summary should contain these averages (formatted to 1 decimal place)
          expect(summary).toContain(formatDecimal(avgSleep));
          expect(summary).toContain(formatDecimal(avgEnergy));
          expect(summary).toContain(formatDecimal(avgMood));
          
          // Should contain labels for these metrics
          expect(summary.toLowerCase()).toContain('sleep');
          expect(summary.toLowerCase()).toContain('energy');
          expect(summary.toLowerCase()).toContain('mood');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should contain task completion count per domain', async () => {
    await fc.assert(
      fc.asyncProperty(
        summaryInputArb,
        async (input) => {
          const summary = generateWeeklySummary(input);
          
          if (input.taskCompletions.length === 0) {
            // If no completions, summary should indicate this
            expect(summary).toContain('No tasks completed');
            return;
          }
          
          // Count completions per domain
          const completionCounts = new Map<number, number>();
          for (const domain of input.domains) {
            completionCounts.set(domain.id, 0);
          }
          for (const completion of input.taskCompletions) {
            const count = completionCounts.get(completion.domainId) || 0;
            completionCounts.set(completion.domainId, count + 1);
          }
          
          // Summary should contain each domain name and its completion count
          for (const domain of input.domains) {
            const count = completionCounts.get(domain.id) || 0;
            
            // Domain name should appear
            expect(summary).toContain(domain.name);
            
            // Count should appear (as a number in the text)
            expect(summary).toContain(count.toString());
          }
          
          // Total completion count should appear
          const totalCompletions = input.taskCompletions.length;
          expect(summary).toContain(totalCompletions.toString());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should contain current streak values', async () => {
    await fc.assert(
      fc.asyncProperty(
        summaryInputArb,
        async (input) => {
          const summary = generateWeeklySummary(input);
          
          // Summary should contain all three streak values
          expect(summary).toContain(input.streaks.medication.toString());
          expect(summary).toContain(input.streaks.healthTask.toString());
          expect(summary).toContain(input.streaks.boringButImportant.toString());
          
          // Should contain labels for streaks
          expect(summary.toLowerCase()).toContain('streak');
          expect(summary.toLowerCase()).toContain('medication');
          expect(summary.toLowerCase()).toContain('health');
          expect(summary.toLowerCase()).toContain('boring');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should contain names of all neglected domains', async () => {
    await fc.assert(
      fc.asyncProperty(
        summaryInputArb,
        async (input) => {
          const summary = generateWeeklySummary(input);
          
          const neglectedDomains = input.balance.filter(b => b.neglected);
          
          if (neglectedDomains.length === 0) {
            // If no neglected domains, summary should indicate this
            expect(summary.toLowerCase()).toContain('all domains');
            return;
          }
          
          // Summary should contain each neglected domain name
          for (const domain of neglectedDomains) {
            expect(summary).toContain(domain.name);
          }
          
          // Should have a section about neglected/balance domains
          const lowerSummary = summary.toLowerCase();
          expect(
            lowerSummary.includes('neglect') || 
            lowerSummary.includes('no tasks completed')
          ).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should contain all required sections', async () => {
    await fc.assert(
      fc.asyncProperty(
        summaryInputArb,
        async (input) => {
          const summary = generateWeeklySummary(input);
          
          // Should contain section headers (case-insensitive)
          const lowerSummary = summary.toLowerCase();
          
          expect(lowerSummary).toContain('weekly summary');
          expect(lowerSummary).toContain('period');
          expect(lowerSummary).toContain('health');
          expect(lowerSummary).toContain('task');
          expect(lowerSummary).toContain('streak');
          expect(lowerSummary).toContain('domain');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 19: Weekly Summary Plain Text Format
// ============================================================================

/**
 * Property 19: Weekly Summary Plain Text Format
 * 
 * **Validates: Requirements 7.5**
 * 
 * For any generated weekly summary, the output string should not contain
 * HTML tags or markdown formatting characters.
 */
describe('Property 19: Weekly Summary Plain Text Format', () => {
  it('should not contain HTML tags', async () => {
    await fc.assert(
      fc.asyncProperty(
        summaryInputArb,
        async (input) => {
          const summary = generateWeeklySummary(input);
          
          // Should not contain HTML opening tags
          expect(summary).not.toMatch(/<[a-zA-Z][^>]*>/);
          
          // Should not contain HTML closing tags
          expect(summary).not.toMatch(/<\/[a-zA-Z][^>]*>/);
          
          // Should not contain self-closing tags
          expect(summary).not.toMatch(/<[a-zA-Z][^>]*\/>/);
          
          // Common HTML tags should not appear
          expect(summary).not.toContain('<div');
          expect(summary).not.toContain('<span');
          expect(summary).not.toContain('<p>');
          expect(summary).not.toContain('<br>');
          expect(summary).not.toContain('<strong>');
          expect(summary).not.toContain('<em>');
          expect(summary).not.toContain('<ul>');
          expect(summary).not.toContain('<li>');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not contain markdown formatting characters', async () => {
    await fc.assert(
      fc.asyncProperty(
        summaryInputArb,
        async (input) => {
          const summary = generateWeeklySummary(input);
          
          // Should not contain markdown headers (# ## ###)
          expect(summary).not.toMatch(/^#{1,6}\s/m);
          
          // Should not contain markdown bold (**text** or __text__)
          expect(summary).not.toMatch(/\*\*[^*]+\*\*/);
          expect(summary).not.toMatch(/__[^_]+__/);
          
          // Should not contain markdown italic (*text* or _text_)
          // Note: We need to be careful here as underscores might appear in text
          // So we check for the pattern with non-underscore characters
          expect(summary).not.toMatch(/\*[^*\s][^*]*[^*\s]\*/);
          
          // Should not contain markdown code blocks (```text```)
          expect(summary).not.toContain('```');
          
          // Should not contain markdown inline code (`text`)
          // Note: backticks might appear in normal text, so we check for the pattern
          expect(summary).not.toMatch(/`[^`]+`/);
          
          // Should not contain markdown links ([text](url))
          expect(summary).not.toMatch(/\[([^\]]+)\]\(([^)]+)\)/);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should be plain text suitable for copying', async () => {
    await fc.assert(
      fc.asyncProperty(
        summaryInputArb,
        async (input) => {
          const summary = generateWeeklySummary(input);
          
          // Should be a non-empty string
          expect(typeof summary).toBe('string');
          expect(summary.length).toBeGreaterThan(0);
          
          // Should contain only printable ASCII and common whitespace
          // Allow: letters, numbers, spaces, newlines, punctuation
          const printablePattern = /^[\x20-\x7E\n\r\t]*$/;
          expect(summary).toMatch(printablePattern);
          
          // Should not contain control characters (except newline, carriage return, tab)
          const controlCharsPattern = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/;
          expect(summary).not.toMatch(controlCharsPattern);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should use plain text separators instead of markdown', async () => {
    await fc.assert(
      fc.asyncProperty(
        summaryInputArb,
        async (input) => {
          const summary = generateWeeklySummary(input);
          
          // If there are separators, they should be plain text (like ---)
          // not markdown horizontal rules (*** or ___)
          if (summary.includes('---')) {
            // This is acceptable (plain text separator)
            expect(summary).toContain('---');
          }
          
          // Should not use markdown horizontal rules
          expect(summary).not.toMatch(/^\*\*\*+$/m);
          expect(summary).not.toMatch(/^___+$/m);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Additional Property Tests
// ============================================================================

describe('Summary - General Properties', () => {
  it('should always return a non-empty string', async () => {
    await fc.assert(
      fc.asyncProperty(
        summaryInputArb,
        async (input) => {
          const summary = generateWeeklySummary(input);
          
          expect(typeof summary).toBe('string');
          expect(summary.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should contain the date range', async () => {
    await fc.assert(
      fc.asyncProperty(
        summaryInputArb,
        async (input) => {
          const summary = generateWeeklySummary(input);
          
          // Should contain some representation of the date range
          // The exact format may vary, but it should mention the period
          expect(summary.toLowerCase()).toContain('period');
          
          // Should contain year
          const year = input.endDate.split('-')[0];
          expect(summary).toContain(year);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle empty logs gracefully', async () => {
    await fc.assert(
      fc.asyncProperty(
        isoDateArb,
        fc.array(domainArb, { minLength: 1, maxLength: 5 }),
        streaksArb,
        async (startDate, domains, streaks) => {
          const dates = generateConsecutiveDates(startDate, 7);
          const endDate = dates[6];
          
          // Ensure unique domain IDs
          const uniqueDomains = new Map<number, Domain>();
          for (const domain of domains) {
            uniqueDomains.set(domain.id, domain);
          }
          const finalDomains = Array.from(uniqueDomains.values());
          
          const balance: DomainBalance[] = finalDomains.map(domain => ({
            domainId: domain.id,
            name: domain.name,
            completions7d: 0,
            neglected: true,
          }));
          
          const input: SummaryInput = {
            dailyLogs: [], // Empty logs
            taskCompletions: [], // Empty completions
            domains: finalDomains,
            streaks,
            balance,
            startDate,
            endDate,
          };
          
          const summary = generateWeeklySummary(input);
          
          // Should still generate a valid summary
          expect(typeof summary).toBe('string');
          expect(summary.length).toBeGreaterThan(0);
          
          // Should indicate no logs/completions
          expect(summary.toLowerCase()).toContain('no');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should be deterministic for the same input', async () => {
    await fc.assert(
      fc.asyncProperty(
        summaryInputArb,
        async (input) => {
          const summary1 = generateWeeklySummary(input);
          const summary2 = generateWeeklySummary(input);
          
          // Same input should produce identical output
          expect(summary1).toBe(summary2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
