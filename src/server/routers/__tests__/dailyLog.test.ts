import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dailyLogRouter } from '../dailyLog.js';
import * as schema from '../../db/schema.js';
import * as fc from 'fast-check';

/**
 * Daily Log Router Tests
 * 
 * Tests for Daily Log operations including:
 * - Property 13: Daily Log Round-Trip
 * - Property 14: Daily Log Validation
 * - Property 15: Daily Log Idempotence
 * 
 * Validates Requirements: 5.1, 5.2, 5.3, 5.4
 */

// Test database setup
let sqliteDb: Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let caller: ReturnType<typeof dailyLogRouter.createCaller>;

beforeEach(() => {
  // Create in-memory database for each test
  sqliteDb = new BetterSqlite3(':memory:');
  db = drizzle(sqliteDb, { schema });

  // Run migrations
  migrate(db, { migrationsFolder: './drizzle' });

  // Create caller with test context
  caller = dailyLogRouter.createCaller({ db });
});

afterEach(() => {
  sqliteDb.close();
});

// ============================================================================
// Unit Tests - Specific Examples and Edge Cases
// ============================================================================

describe('Daily Log - Unit Tests', () => {
  describe('submit', () => {
    it('should create a new daily log with valid data', async () => {
      const input = {
        date: '2026-01-15',
        hoursSlept: 7.5,
        energy: 6,
        mood: 7,
        medicationTaken: 'yes' as const,
      };

      const result = await caller.submit(input);

      expect(result).toMatchObject({
        id: expect.any(Number),
        date: '2026-01-15',
        hoursSlept: 7.5,
        energy: 6,
        mood: 7,
        medicationTaken: 'yes',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('should accept boundary values (0 and 10 for energy/mood)', async () => {
      const input = {
        date: '2026-01-15',
        hoursSlept: 0,
        energy: 0,
        mood: 10,
        medicationTaken: 'no' as const,
      };

      const result = await caller.submit(input);

      expect(result.energy).toBe(0);
      expect(result.mood).toBe(10);
      expect(result.hoursSlept).toBe(0);
    });

    it('should accept maximum hours slept (24)', async () => {
      const input = {
        date: '2026-01-15',
        hoursSlept: 24,
        energy: 5,
        mood: 5,
        medicationTaken: 'yes' as const,
      };

      const result = await caller.submit(input);

      expect(result.hoursSlept).toBe(24);
    });

    it('should update existing log for same date (upsert)', async () => {
      const date = '2026-01-15';

      // First submission
      const first = await caller.submit({
        date,
        hoursSlept: 6,
        energy: 5,
        mood: 6,
        medicationTaken: 'yes',
      });

      // Second submission for same date
      const second = await caller.submit({
        date,
        hoursSlept: 8,
        energy: 7,
        mood: 8,
        medicationTaken: 'no',
      });

      // Should have same ID (updated, not created)
      expect(second.id).toBe(first.id);
      expect(second.hoursSlept).toBe(8);
      expect(second.energy).toBe(7);
      expect(second.mood).toBe(8);
      expect(second.medicationTaken).toBe('no');

      // Verify only one record exists
      const logs = await caller.getRange({
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });
      expect(logs).toHaveLength(1);
    });

    it('should update updatedAt timestamp on update', async () => {
      const date = '2026-01-15';

      const first = await caller.submit({
        date,
        hoursSlept: 6,
        energy: 5,
        mood: 6,
        medicationTaken: 'yes',
      });

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const second = await caller.submit({
        date,
        hoursSlept: 7,
        energy: 6,
        mood: 7,
        medicationTaken: 'yes',
      });

      expect(second.updatedAt).not.toBe(first.updatedAt);
      expect(second.createdAt).toBe(first.createdAt); // createdAt unchanged
    });
  });

  describe('getToday', () => {
    it('should return log for specified date', async () => {
      await caller.submit({
        date: '2026-01-15',
        hoursSlept: 7,
        energy: 6,
        mood: 7,
        medicationTaken: 'yes',
      });

      const result = await caller.getToday({ date: '2026-01-15' });

      expect(result).toMatchObject({
        date: '2026-01-15',
        hoursSlept: 7,
        energy: 6,
        mood: 7,
        medicationTaken: 'yes',
      });
    });

    it('should return null when no log exists for date', async () => {
      const result = await caller.getToday({ date: '2026-01-15' });

      expect(result).toBeNull();
    });

    it('should return correct log when multiple dates exist', async () => {
      await caller.submit({
        date: '2026-01-14',
        hoursSlept: 6,
        energy: 5,
        mood: 6,
        medicationTaken: 'yes',
      });

      await caller.submit({
        date: '2026-01-15',
        hoursSlept: 8,
        energy: 7,
        mood: 8,
        medicationTaken: 'no',
      });

      const result = await caller.getToday({ date: '2026-01-15' });

      expect(result?.date).toBe('2026-01-15');
      expect(result?.hoursSlept).toBe(8);
    });
  });

  describe('getRange', () => {
    it('should return empty array when no logs exist', async () => {
      const result = await caller.getRange({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });

      expect(result).toEqual([]);
    });

    it('should return logs within date range', async () => {
      // Create logs for multiple dates
      await caller.submit({
        date: '2026-01-10',
        hoursSlept: 6,
        energy: 5,
        mood: 6,
        medicationTaken: 'yes',
      });

      await caller.submit({
        date: '2026-01-15',
        hoursSlept: 7,
        energy: 6,
        mood: 7,
        medicationTaken: 'yes',
      });

      await caller.submit({
        date: '2026-01-20',
        hoursSlept: 8,
        energy: 7,
        mood: 8,
        medicationTaken: 'no',
      });

      const result = await caller.getRange({
        startDate: '2026-01-12',
        endDate: '2026-01-18',
      });

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2026-01-15');
    });

    it('should include boundary dates (inclusive range)', async () => {
      await caller.submit({
        date: '2026-01-10',
        hoursSlept: 6,
        energy: 5,
        mood: 6,
        medicationTaken: 'yes',
      });

      await caller.submit({
        date: '2026-01-15',
        hoursSlept: 7,
        energy: 6,
        mood: 7,
        medicationTaken: 'yes',
      });

      await caller.submit({
        date: '2026-01-20',
        hoursSlept: 8,
        energy: 7,
        mood: 8,
        medicationTaken: 'no',
      });

      const result = await caller.getRange({
        startDate: '2026-01-10',
        endDate: '2026-01-20',
      });

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.date)).toEqual(['2026-01-10', '2026-01-15', '2026-01-20']);
    });

    it('should return logs ordered by date ascending', async () => {
      // Insert in random order
      await caller.submit({
        date: '2026-01-20',
        hoursSlept: 8,
        energy: 7,
        mood: 8,
        medicationTaken: 'no',
      });

      await caller.submit({
        date: '2026-01-10',
        hoursSlept: 6,
        energy: 5,
        mood: 6,
        medicationTaken: 'yes',
      });

      await caller.submit({
        date: '2026-01-15',
        hoursSlept: 7,
        energy: 6,
        mood: 7,
        medicationTaken: 'yes',
      });

      const result = await caller.getRange({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });

      expect(result.map((r) => r.date)).toEqual(['2026-01-10', '2026-01-15', '2026-01-20']);
    });
  });
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Daily Log - Property Tests', () => {
  // Helper to create a fresh database for each property test iteration
  const createFreshDb = () => {
    const sqliteDb = new BetterSqlite3(':memory:');
    const db = drizzle(sqliteDb, { schema });
    migrate(db, { migrationsFolder: './drizzle' });
    const caller = dailyLogRouter.createCaller({ db });
    return { sqliteDb, db, caller };
  };

  // Arbitraries (generators) for property-based testing
  const dateArb = fc
    .integer({ min: 2020, max: 2030 })
    .chain((year) =>
      fc
        .integer({ min: 1, max: 12 })
        .chain((month) =>
          fc
            .integer({ min: 1, max: 28 }) // Use 28 to avoid invalid dates
            .map((day) => {
              const m = month.toString().padStart(2, '0');
              const d = day.toString().padStart(2, '0');
              return `${year}-${m}-${d}`;
            })
        )
    );

  const hoursSleptArb = fc.float({ min: 0, max: 24, noNaN: true });
  const energyArb = fc.integer({ min: 0, max: 10 });
  const moodArb = fc.integer({ min: 0, max: 10 });
  const medicationArb = fc.constantFrom('yes' as const, 'no' as const);

  const validDailyLogInputArb = fc.record({
    date: dateArb,
    hoursSlept: hoursSleptArb,
    energy: energyArb,
    mood: moodArb,
    medicationTaken: medicationArb,
  });

  /**
   * Property 13: Daily Log Round-Trip
   * 
   * For any valid daily log input, submitting the log and reading it back
   * for that date should return identical values.
   * 
   * Validates: Requirements 5.1
   */
  it('Property 13: Daily Log Round-Trip', async () => {
    await fc.assert(
      fc.asyncProperty(validDailyLogInputArb, async (input) => {
        // Create fresh database for this iteration
        const { sqliteDb: testDb, caller: testCaller } = createFreshDb();

        try {
          // Submit log
          const submitted = await testCaller.submit(input);

          // Verify submitted values match input
          expect(submitted.date).toBe(input.date);
          expect(submitted.hoursSlept).toBeCloseTo(input.hoursSlept, 5);
          expect(submitted.energy).toBe(input.energy);
          expect(submitted.mood).toBe(input.mood);
          expect(submitted.medicationTaken).toBe(input.medicationTaken);

          // Read back via getToday
          const retrieved = await testCaller.getToday({ date: input.date });

          expect(retrieved).not.toBeNull();
          expect(retrieved?.date).toBe(input.date);
          expect(retrieved?.hoursSlept).toBeCloseTo(input.hoursSlept, 5);
          expect(retrieved?.energy).toBe(input.energy);
          expect(retrieved?.mood).toBe(input.mood);
          expect(retrieved?.medicationTaken).toBe(input.medicationTaken);

          // Read back via getRange
          const rangeResult = await testCaller.getRange({
            startDate: input.date,
            endDate: input.date,
          });

          expect(rangeResult).toHaveLength(1);
          expect(rangeResult[0].date).toBe(input.date);
          expect(rangeResult[0].hoursSlept).toBeCloseTo(input.hoursSlept, 5);
        } finally {
          testDb.close();
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 14: Daily Log Validation
   * 
   * For any daily log input where energy or mood is outside [0,10], or
   * hoursSlept is outside [0,24], submission should be rejected with a
   * validation error and no record should be created or modified.
   * 
   * Note: This property is enforced by Zod schema validation at the tRPC layer.
   * We test the boundary cases in unit tests. Property tests focus on valid inputs.
   * 
   * Validates: Requirements 5.2, 5.3
   */
  it('Property 14: Daily Log Validation - boundary enforcement', async () => {
    // Test invalid energy values
    const invalidEnergyInputs = [
      { date: '2026-01-15', hoursSlept: 7, energy: -1, mood: 5, medicationTaken: 'yes' as const },
      { date: '2026-01-15', hoursSlept: 7, energy: 11, mood: 5, medicationTaken: 'yes' as const },
    ];

    for (const input of invalidEnergyInputs) {
      await expect(caller.submit(input)).rejects.toThrow();
    }

    // Test invalid mood values
    const invalidMoodInputs = [
      { date: '2026-01-15', hoursSlept: 7, energy: 5, mood: -1, medicationTaken: 'yes' as const },
      { date: '2026-01-15', hoursSlept: 7, energy: 5, mood: 11, medicationTaken: 'yes' as const },
    ];

    for (const input of invalidMoodInputs) {
      await expect(caller.submit(input)).rejects.toThrow();
    }

    // Test invalid hoursSlept values
    const invalidHoursInputs = [
      { date: '2026-01-15', hoursSlept: -0.1, energy: 5, mood: 5, medicationTaken: 'yes' as const },
      { date: '2026-01-15', hoursSlept: 24.1, energy: 5, mood: 5, medicationTaken: 'yes' as const },
    ];

    for (const input of invalidHoursInputs) {
      await expect(caller.submit(input)).rejects.toThrow();
    }

    // Verify no records were created
    const logs = await caller.getRange({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect(logs).toHaveLength(0);
  });

  /**
   * Property 15: Daily Log Idempotence
   * 
   * For any date, submitting a daily log twice for the same date should
   * result in exactly one record, with the field values matching the
   * second submission.
   * 
   * Validates: Requirements 5.4
   */
  it('Property 15: Daily Log Idempotence', async () => {
    await fc.assert(
      fc.asyncProperty(
        validDailyLogInputArb,
        validDailyLogInputArb,
        async (firstInput, secondInput) => {
          // Create fresh database for this iteration
          const { sqliteDb: testDb, caller: testCaller } = createFreshDb();

          try {
            // Use same date for both submissions
            const date = firstInput.date;
            const secondInputWithSameDate = { ...secondInput, date };

            // First submission
            const first = await testCaller.submit(firstInput);

            // Second submission for same date
            const second = await testCaller.submit(secondInputWithSameDate);

            // Should have same ID (updated, not created)
            expect(second.id).toBe(first.id);

            // Values should match second submission
            expect(second.date).toBe(date);
            expect(second.hoursSlept).toBeCloseTo(secondInputWithSameDate.hoursSlept, 5);
            expect(second.energy).toBe(secondInputWithSameDate.energy);
            expect(second.mood).toBe(secondInputWithSameDate.mood);
            expect(second.medicationTaken).toBe(secondInputWithSameDate.medicationTaken);

            // Verify only one record exists for this date
            const logs = await testCaller.getRange({
              startDate: date,
              endDate: date,
            });
            expect(logs).toHaveLength(1);
            expect(logs[0].id).toBe(first.id);
          } finally {
            testDb.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
