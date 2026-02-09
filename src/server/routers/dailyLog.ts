import { router, publicProcedure } from '../trpc.js';
import { dailyLogs } from '../db/schema.js';
import {
  submitDailyLogSchema,
  getDailyLogSchema,
  getDailyLogRangeSchema,
} from '../../shared/types.js';
import { eq, and, gte, lte } from 'drizzle-orm';

/**
 * Daily Log Router
 * 
 * Provides procedures for tracking daily health and wellbeing:
 * - submit: Submit or update a daily log (upsert)
 * - getToday: Get today's log
 * - getRange: Get logs for a date range
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4
 */
export const dailyLogRouter = router({
  /**
   * Submit a daily log (upsert)
   * 
   * Requirement 5.1: Store hours slept, energy (0-10), mood (0-10), and medication taken (yes/no)
   * Requirement 5.2: Reject if energy or mood outside 0-10 range (handled by Zod schema)
   * Requirement 5.3: Reject if hours slept < 0 or > 24 (handled by Zod schema)
   * Requirement 5.4: Allow only one log per day, update if exists (upsert)
   */
  submit: publicProcedure
    .input(submitDailyLogSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();

      // Check if a log already exists for this date
      const [existingLog] = await ctx.db
        .select()
        .from(dailyLogs)
        .where(eq(dailyLogs.date, input.date))
        .limit(1);

      if (existingLog) {
        // Update existing log
        const [updatedLog] = await ctx.db
          .update(dailyLogs)
          .set({
            hoursSlept: input.hoursSlept,
            energy: input.energy,
            mood: input.mood,
            medicationTaken: input.medicationTaken,
            updatedAt: now,
          })
          .where(eq(dailyLogs.date, input.date))
          .returning();

        return updatedLog;
      } else {
        // Insert new log
        const [newLog] = await ctx.db
          .insert(dailyLogs)
          .values({
            date: input.date,
            hoursSlept: input.hoursSlept,
            energy: input.energy,
            mood: input.mood,
            medicationTaken: input.medicationTaken,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        return newLog;
      }
    }),

  /**
   * Get today's daily log
   * 
   * Returns the log for the specified date, or null if no log exists
   */
  getToday: publicProcedure
    .input(getDailyLogSchema)
    .query(async ({ ctx, input }) => {
      const [log] = await ctx.db
        .select()
        .from(dailyLogs)
        .where(eq(dailyLogs.date, input.date))
        .limit(1);

      return log || null;
    }),

  /**
   * Get daily logs for a date range
   * 
   * Returns all logs between startDate and endDate (inclusive), ordered by date descending
   */
  getRange: publicProcedure
    .input(getDailyLogRangeSchema)
    .query(async ({ ctx, input }) => {
      const logs = await ctx.db
        .select()
        .from(dailyLogs)
        .where(
          and(
            gte(dailyLogs.date, input.startDate),
            lte(dailyLogs.date, input.endDate)
          )
        )
        .orderBy(dailyLogs.date);

      return logs;
    }),
});
