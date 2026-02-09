import { router, publicProcedure } from '../trpc.js';
import { domains, dailyLogs, taskCompletions } from '../db/schema.js';
import { generateSummarySchema } from '../../shared/types.js';
import { generateWeeklySummary } from '../services/summary.js';
import { calculateStreaks } from '../services/streaks.js';
import { calculateDomainBalance } from '../services/balance.js';
import { desc, and, gte, lte } from 'drizzle-orm';

/**
 * Summary Router
 * 
 * Provides procedures for generating weekly summaries:
 * - generate: Generate weekly summary text
 * - export: Generate downloadable text file
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */
export const summaryRouter = router({
  /**
   * Generate weekly summary
   * 
   * Requirement 7.1: Aggregate daily logs for past 7 days showing average sleep, energy, and mood
   * Requirement 7.2: Include task completion counts per domain and overall completion rate
   * Requirement 7.3: Include current streak values for medication, health tasks, and BBI tasks
   * Requirement 7.4: List any domains flagged as neglected (zero completions in period)
   * Requirement 7.5: Format as plain text suitable for copying into a message or document
   * 
   * Input: { endDate?: string } (defaults to today)
   * Returns: Plain text summary string
   */
  generate: publicProcedure
    .input(generateSummarySchema)
    .query(async ({ ctx, input }) => {
      // Calculate date range (7 days ending on endDate or today)
      const endDate = input.endDate || new Date().toISOString().split('T')[0];
      const startDate = new Date(new Date(endDate + 'T00:00:00Z').getTime() - 6 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      // Fetch daily logs for the period (ordered by date desc for streak calculation)
      const logs = await ctx.db
        .select()
        .from(dailyLogs)
        .where(
          and(
            gte(dailyLogs.date, startDate),
            lte(dailyLogs.date, endDate)
          )
        )
        .orderBy(desc(dailyLogs.date));

      // Fetch task completions for the period
      const completions = await ctx.db
        .select()
        .from(taskCompletions)
        .where(
          and(
            gte(taskCompletions.completedDate, startDate),
            lte(taskCompletions.completedDate, endDate)
          )
        );

      // Fetch all domains
      const allDomains = await ctx.db.select().from(domains);

      // Fetch all daily logs (for streak calculation - needs full history)
      const allLogs = await ctx.db
        .select()
        .from(dailyLogs)
        .orderBy(desc(dailyLogs.date));

      // Fetch all task completions (for streak calculation - needs full history)
      const allCompletions = await ctx.db
        .select()
        .from(taskCompletions)
        .orderBy(desc(taskCompletions.completedDate));

      // Calculate current streaks
      const streaks = calculateStreaks({
        dailyLogs: allLogs,
        taskCompletions: allCompletions,
        domains: allDomains,
        currentDate: endDate,
      });

      // Calculate domain balance for the period
      const balance = calculateDomainBalance({
        domains: allDomains,
        taskCompletions: completions,
        startDate,
        endDate,
      });

      // Generate the summary
      const summary = generateWeeklySummary({
        dailyLogs: logs,
        taskCompletions: completions,
        domains: allDomains,
        streaks,
        balance,
        startDate,
        endDate,
      });

      return summary;
    }),

  /**
   * Export weekly summary as downloadable text file
   * 
   * Requirement 7.6: Make weekly summary exportable as a downloadable text file
   * 
   * Input: { endDate?: string } (defaults to today)
   * Returns: Object with filename and content for download
   */
  export: publicProcedure
    .input(generateSummarySchema)
    .query(async ({ ctx, input }) => {
      // Calculate date range (7 days ending on endDate or today)
      const endDate = input.endDate || new Date().toISOString().split('T')[0];
      const startDate = new Date(new Date(endDate + 'T00:00:00Z').getTime() - 6 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      // Fetch daily logs for the period (ordered by date desc for streak calculation)
      const logs = await ctx.db
        .select()
        .from(dailyLogs)
        .where(
          and(
            gte(dailyLogs.date, startDate),
            lte(dailyLogs.date, endDate)
          )
        )
        .orderBy(desc(dailyLogs.date));

      // Fetch task completions for the period
      const completions = await ctx.db
        .select()
        .from(taskCompletions)
        .where(
          and(
            gte(taskCompletions.completedDate, startDate),
            lte(taskCompletions.completedDate, endDate)
          )
        );

      // Fetch all domains
      const allDomains = await ctx.db.select().from(domains);

      // Fetch all daily logs (for streak calculation - needs full history)
      const allLogs = await ctx.db
        .select()
        .from(dailyLogs)
        .orderBy(desc(dailyLogs.date));

      // Fetch all task completions (for streak calculation - needs full history)
      const allCompletions = await ctx.db
        .select()
        .from(taskCompletions)
        .orderBy(desc(taskCompletions.completedDate));

      // Calculate current streaks
      const streaks = calculateStreaks({
        dailyLogs: allLogs,
        taskCompletions: allCompletions,
        domains: allDomains,
        currentDate: endDate,
      });

      // Calculate domain balance for the period
      const balance = calculateDomainBalance({
        domains: allDomains,
        taskCompletions: completions,
        startDate,
        endDate,
      });

      // Generate the summary
      const summary = generateWeeklySummary({
        dailyLogs: logs,
        taskCompletions: completions,
        domains: allDomains,
        streaks,
        balance,
        startDate,
        endDate,
      });

      // Generate filename with date range
      const filename = `weekly-summary-${startDate}-to-${endDate}.txt`;

      // Return object with filename and content
      return {
        filename,
        content: summary,
      };
    }),
});
