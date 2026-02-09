/**
 * Property-Based Tests for Balance Service
 * 
 * Feature: life-manager, Property 17: Domain Balance and Neglect Flagging
 * 
 * Property: For any set of domains and task completions over a 7-day window,
 * the domain balance should report the exact count of completions per domain,
 * and any domain with zero completions should have neglected = true.
 * 
 * Validates: Requirements 6.4, 6.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { calculateDomainBalance, type BalanceInput, type Domain, type TaskCompletion } from '../balance';

// ============================================================================
// Arbitraries (Generators)
// ============================================================================

/**
 * Generate a valid ISO date string within a reasonable range
 */
const isoDateArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .map(date => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

/**
 * Generate a domain
 */
const domainArb = fc.record({
  id: fc.integer({ min: 1, max: 1000 }),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  description: fc.string({ maxLength: 200 }),
  whyItMatters: fc.string({ maxLength: 200 }),
  boringButImportant: fc.boolean(),
  createdAt: fc.constant('2024-01-01T00:00:00Z'),
  updatedAt: fc.constant('2024-01-01T00:00:00Z'),
}) as fc.Arbitrary<Domain>;

/**
 * Generate a task completion
 */
const taskCompletionArb = (domainIds: number[]) => fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  taskId: fc.integer({ min: 1, max: 10000 }),
  domainId: fc.constantFrom(...domainIds),
  completedAt: isoDateArb.map(date => `${date}T12:00:00Z`),
  completedDate: isoDateArb,
}) as fc.Arbitrary<TaskCompletion>;

/**
 * Generate a date range (startDate, endDate) where startDate <= endDate
 */
const dateRangeArb = fc.tuple(isoDateArb, isoDateArb)
  .map(([date1, date2]) => {
    // Ensure startDate <= endDate
    return date1 <= date2 ? [date1, date2] : [date2, date1];
  });

/**
 * Generate a complete BalanceInput
 */
const balanceInputArb = fc.record({
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
    taskCompletions: fc.array(taskCompletionArb(domainIds), { maxLength: 100 }),
    dateRange: dateRangeArb,
  }).map(({ domains, taskCompletions, dateRange }) => ({
    domains,
    taskCompletions,
    startDate: dateRange[0],
    endDate: dateRange[1],
  }));
}) as fc.Arbitrary<BalanceInput>;

// ============================================================================
// Property Tests
// ============================================================================

describe('Balance Service - Property Tests', () => {
  // Feature: life-manager, Property 17: Domain Balance and Neglect Flagging
  it('Property 17: should report exact completion counts and flag neglected domains', () => {
    fc.assert(
      fc.property(balanceInputArb, (input) => {
        const result = calculateDomainBalance(input);
        
        // Property 1: Result should have one entry per domain
        expect(result).toHaveLength(input.domains.length);
        
        // Property 2: Each domain should appear exactly once in the result
        const resultDomainIds = result.map(b => b.domainId);
        const inputDomainIds = input.domains.map(d => d.id);
        expect(resultDomainIds.sort()).toEqual(inputDomainIds.sort());
        
        // Property 3: For each domain, verify exact completion count
        for (const domain of input.domains) {
          const balance = result.find(b => b.domainId === domain.id);
          expect(balance).toBeDefined();
          
          // Manually count completions for this domain within the date range
          const expectedCount = input.taskCompletions.filter(c => 
            c.domainId === domain.id &&
            c.completedDate >= input.startDate &&
            c.completedDate <= input.endDate
          ).length;
          
          expect(balance!.completions7d).toBe(expectedCount);
          
          // Property 4: Domain name should match
          expect(balance!.name).toBe(domain.name);
          
          // Property 5: Neglected flag should be true iff completions7d === 0
          expect(balance!.neglected).toBe(expectedCount === 0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('Property 17a: neglected flag is true if and only if completions7d is zero', () => {
    fc.assert(
      fc.property(balanceInputArb, (input) => {
        const result = calculateDomainBalance(input);
        
        for (const balance of result) {
          // Neglected should be true iff completions7d === 0
          if (balance.completions7d === 0) {
            expect(balance.neglected).toBe(true);
          } else {
            expect(balance.neglected).toBe(false);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('Property 17b: completions outside date range are not counted', () => {
    fc.assert(
      fc.property(balanceInputArb, (input) => {
        const result = calculateDomainBalance(input);
        
        // For each domain, verify that only completions within range are counted
        for (const domain of input.domains) {
          const balance = result.find(b => b.domainId === domain.id);
          
          const completionsInRange = input.taskCompletions.filter(c =>
            c.domainId === domain.id &&
            c.completedDate >= input.startDate &&
            c.completedDate <= input.endDate
          ).length;
          
          const completionsOutOfRange = input.taskCompletions.filter(c =>
            c.domainId === domain.id &&
            (c.completedDate < input.startDate || c.completedDate > input.endDate)
          ).length;
          
          // Balance should equal in-range count, not total count
          expect(balance!.completions7d).toBe(completionsInRange);
          
          // If there are out-of-range completions, verify they're not counted
          if (completionsOutOfRange > 0) {
            const totalCompletions = completionsInRange + completionsOutOfRange;
            expect(balance!.completions7d).toBeLessThan(totalCompletions);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('Property 17c: result order matches input domain order', () => {
    fc.assert(
      fc.property(balanceInputArb, (input) => {
        const result = calculateDomainBalance(input);
        
        // Result should have domains in the same order as input
        for (let i = 0; i < input.domains.length; i++) {
          expect(result[i].domainId).toBe(input.domains[i].id);
          expect(result[i].name).toBe(input.domains[i].name);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('Property 17d: all completions7d values are non-negative', () => {
    fc.assert(
      fc.property(balanceInputArb, (input) => {
        const result = calculateDomainBalance(input);
        
        for (const balance of result) {
          expect(balance.completions7d).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('Property 17e: sum of all completions7d equals total completions in range', () => {
    fc.assert(
      fc.property(balanceInputArb, (input) => {
        const result = calculateDomainBalance(input);
        
        // Sum of all completions7d across domains
        const totalReported = result.reduce((sum, b) => sum + b.completions7d, 0);
        
        // Actual total completions within date range
        const totalActual = input.taskCompletions.filter(c =>
          c.completedDate >= input.startDate &&
          c.completedDate <= input.endDate
        ).length;
        
        expect(totalReported).toBe(totalActual);
      }),
      { numRuns: 100 }
    );
  });
});
