import { router, publicProcedure } from '../trpc.js';
import { domains, dailyLogs, taskCompletions, todayPlans, todayPlanItems } from '../db/schema.js';
import { getBalanceSchema } from '../../shared/types.js';
import { calculateStreaks } from '../services/streaks.js';
import { calculateDomainBalance } from '../services/balance.js';
import { checkGuardrails } from '../services/guardrails.js';
import { desc } from 'drizzle-orm';

/**
 * Stats Router
 * 
 * Provides procedures for tracking streaks, domain balance, and safety guardrails:
 * - streaks: Calculate medication, health task, and BBI streaks
 * - balance: Calculate domain balance and identify neglected domains
 * - guardrails: Check for concerning patterns and provide safety suggestions
 * 
 * Requirements: 6.1, 6.4, 8.3, 8.4
 */
export const statsRouter = router({
  /**
   * Get current streaks
   * 
   * Requirement 6.1: Calculate medication streaks (consecutive days with medication=yes)
   * Requirement 6.2: Calculate health-task streaks (consecutive days with ≥1 health domain completion)
   * Requirement 6.3: Calculate boring-but-important streaks (consecutive days with ≥1 BBI domain completion)
   * 
   * Returns: { medication, healthTask, boringButImportant }
   */
  streaks: publicProcedure.query(async ({ ctx }) => {
    // Get current date (ISO format YYYY-MM-DD)
    const currentDate = new Date().toISOString().split('T')[0];

    // Fetch all daily logs (ordered by date desc for streak calculation)
    const logs = await ctx.db
      .select()
      .from(dailyLogs)
      .orderBy(desc(dailyLogs.date));

    // Fetch all task completions (ordered by date desc)
    const completions = await ctx.db
      .select()
      .from(taskCompletions)
      .orderBy(desc(taskCompletions.completedDate));

    // Fetch all domains
    const allDomains = await ctx.db.select().from(domains);

    // Calculate streaks using the service
    const streaks = calculateStreaks({
      dailyLogs: logs,
      taskCompletions: completions,
      domains: allDomains,
      currentDate,
    });

    return streaks;
  }),

  /**
   * Get domain balance
   * 
   * Requirement 6.4: Show number of tasks completed per domain over past 7 days
   * Requirement 6.5: Flag domains with zero completions as "neglected"
   * 
   * Input: { days: number } (defaults to 7)
   * Returns: Array of { domainId, name, completions7d, neglected }
   */
  balance: publicProcedure
    .input(getBalanceSchema)
    .query(async ({ ctx, input }) => {
      // Calculate date range
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - (input.days - 1) * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      // Fetch all domains
      const allDomains = await ctx.db.select().from(domains);

      // Fetch all task completions
      const completions = await ctx.db.select().from(taskCompletions);

      // Calculate balance using the service
      const balance = calculateDomainBalance({
        domains: allDomains,
        taskCompletions: completions,
        startDate,
        endDate,
      });

      return balance;
    }),

  /**
   * Check safety guardrails
   * 
   * Requirement 8.3: Display message when 3+ consecutive days with mood≤3 or energy≤3
   * Requirement 8.4: Display message when 5+ days with <50% plan completion + avg mood/energy ≤4
   * 
   * Returns: { shouldSuggestDoctor, shouldSuggestSupport, messages }
   */
  guardrails: publicProcedure.query(async ({ ctx }) => {
    // Get current date (ISO format YYYY-MM-DD)
    const currentDate = new Date().toISOString().split('T')[0];

    // Fetch all daily logs (ordered by date desc)
    const logs = await ctx.db
      .select()
      .from(dailyLogs)
      .orderBy(desc(dailyLogs.date));

    // Fetch all today plans (ordered by date desc)
    const plans = await ctx.db
      .select()
      .from(todayPlans)
      .orderBy(desc(todayPlans.date));

    // Fetch all today plan items
    const items = await ctx.db
      .select()
      .from(todayPlanItems);

    // Check guardrails using the service
    const guardrailCheck = checkGuardrails({
      dailyLogs: logs,
      todayPlans: plans,
      todayPlanItems: items,
      currentDate,
    });

    return guardrailCheck;
  }),
});
