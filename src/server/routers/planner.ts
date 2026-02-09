import { router, publicProcedure } from '../trpc.js';
import { 
  tasks, 
  domains, 
  taskCompletions, 
  snoozeLogs, 
  todayPlans, 
  todayPlanItems 
} from '../db/schema.js';
import { generatePlanSchema, getTodayPlanSchema } from '../../shared/types.js';
import { eq, and, gte, lte } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { generatePlan } from '../services/planner.js';
import type { Task, Domain } from '../services/planner.js';
import { z } from 'zod';

/**
 * Planner Router
 * 
 * Provides procedures for generating and retrieving daily plans:
 * - generate: Generate a new today plan based on energy level
 * - getToday: Retrieve the existing plan for a given date
 * 
 * Requirements: 3.1, 3.6
 */
export const plannerRouter = router({
  /**
   * Generate a new today plan
   * 
   * Requirement 3.1: Select 1-3 must-do tasks, 1-2 want-to tasks, and 1 health task
   * Requirement 3.2: Include at least one BBI task if any are due/overdue
   * Requirement 3.3: Prioritize tasks from neglected domains
   * Requirement 4.1, 4.2, 4.3: Adapt plan to energy level
   * 
   * This procedure:
   * 1. Determines the target date (defaults to today)
   * 2. Fetches available tasks (status=todo, not snoozed today)
   * 3. Fetches all domains
   * 4. Calculates domain completion counts for the past 7 days
   * 5. Calls the planner service to generate the plan
   * 6. Persists the plan to the database
   * 7. Returns the plan with full task details
   */
  generate: publicProcedure
    .input(generatePlanSchema)
    .mutation(async ({ ctx, input }) => {
      const targetDate = input.date || new Date().toISOString().split('T')[0];
      const now = new Date().toISOString();

      // Check if a plan already exists for this date
      const [existingPlan] = await ctx.db
        .select()
        .from(todayPlans)
        .where(eq(todayPlans.date, targetDate))
        .limit(1);

      if (existingPlan) {
        // If the existing plan has no items, delete it and allow regeneration
        const existingItems = await ctx.db
          .select()
          .from(todayPlanItems)
          .where(eq(todayPlanItems.planId, existingPlan.id));

        if (existingItems.length === 0) {
          await ctx.db.delete(todayPlans).where(eq(todayPlans.id, existingPlan.id));
        } else {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `A plan already exists for ${targetDate}. Use getToday to retrieve it.`,
          });
        }
      }

      // Fetch all domains
      const allDomains = await ctx.db.select().from(domains);

      // Fetch tasks that are snoozed to today (we need to exclude them)
      const snoozedToday = await ctx.db
        .select({ taskId: snoozeLogs.taskId })
        .from(snoozeLogs)
        .where(eq(snoozeLogs.snoozedFrom, targetDate));

      const snoozedTaskIds = new Set(snoozedToday.map(s => s.taskId));

      // Fetch available tasks (status=todo, not snoozed today)
      const allTasks = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.status, 'todo'));

      const availableTasks = allTasks.filter(task => !snoozedTaskIds.has(task.id));

      // Calculate domain completion counts for past 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

      const recentCompletions = await ctx.db
        .select()
        .from(taskCompletions)
        .where(
          and(
            gte(taskCompletions.completedDate, sevenDaysAgoStr),
            lte(taskCompletions.completedDate, targetDate)
          )
        );

      // Build completion count map
      const completions7d = new Map<number, number>();
      for (const completion of recentCompletions) {
        const count = completions7d.get(completion.domainId) || 0;
        completions7d.set(completion.domainId, count + 1);
      }

      // Generate the plan using the planner service
      const plan = generatePlan({
        availableTasks: availableTasks as Task[],
        domains: allDomains as Domain[],
        completions7d,
        energyLevel: input.energyLevel,
        currentDate: targetDate,
      });

      // If no tasks were selected, return empty plan without persisting
      if (plan.items.length === 0) {
        return {
          id: 0,
          date: targetDate,
          energyLevel: input.energyLevel,
          items: [],
          createdAt: now,
        };
      }

      // Persist the plan to the database
      const [savedPlan] = await ctx.db
        .insert(todayPlans)
        .values({
          date: targetDate,
          energyLevel: input.energyLevel,
          createdAt: now,
        })
        .returning();

      // Persist plan items
      const planItemsToInsert = plan.items.map(item => ({
        planId: savedPlan.id,
        taskId: item.taskId,
        category: item.category,
        completed: false,
        snoozed: false,
      }));

      await ctx.db.insert(todayPlanItems).values(planItemsToInsert);

      // Fetch the complete plan with task details
      const planItems = await ctx.db
        .select()
        .from(todayPlanItems)
        .where(eq(todayPlanItems.planId, savedPlan.id));

      // Fetch task details for each plan item
      const taskIds = planItems.map(item => item.taskId);

      // Build a map of task details
      const taskMap = new Map<number, typeof tasks.$inferSelect>();
      for (const taskId of taskIds) {
        const [task] = await ctx.db
          .select()
          .from(tasks)
          .where(eq(tasks.id, taskId))
          .limit(1);
        if (task) {
          taskMap.set(task.id, task);
        }
      }

      // Combine plan items with task details
      const itemsWithTasks = planItems.map(item => {
        const task = taskMap.get(item.taskId);
        if (!task) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Task ${item.taskId} not found`,
          });
        }
        return {
          id: item.id,
          planId: item.planId,
          taskId: item.taskId,
          category: item.category,
          completed: item.completed,
          snoozed: item.snoozed,
          task,
        };
      });

      return {
        id: savedPlan.id,
        date: savedPlan.date,
        energyLevel: savedPlan.energyLevel,
        items: itemsWithTasks,
        createdAt: savedPlan.createdAt,
      };
    }),

  /**
   * Re-plan: add more tasks to an existing plan with a new energy level
   * 
   * Used when all current plan tasks are completed and the user wants more.
   * Keeps completed items, removes incomplete ones, and generates fresh tasks
   * excluding already-completed task IDs.
   */
  replan: publicProcedure
    .input(generatePlanSchema)
    .mutation(async ({ ctx, input }) => {
      const targetDate = input.date || new Date().toISOString().split('T')[0];

      // Find existing plan
      const [existingPlan] = await ctx.db
        .select()
        .from(todayPlans)
        .where(eq(todayPlans.date, targetDate))
        .limit(1);

      if (!existingPlan) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No plan exists for ${targetDate}. Use generate instead.`,
        });
      }

      // Get current plan items to find completed task IDs
      const currentItems = await ctx.db
        .select()
        .from(todayPlanItems)
        .where(eq(todayPlanItems.planId, existingPlan.id));

      // Collect task IDs already in this plan (completed or not) to exclude from re-plan
      const excludeTaskIds = new Set(currentItems.map(item => item.taskId));

      // Update plan energy level
      await ctx.db
        .update(todayPlans)
        .set({ energyLevel: input.energyLevel })
        .where(eq(todayPlans.id, existingPlan.id));

      // Fetch all domains
      const allDomains = await ctx.db.select().from(domains);

      // Fetch snoozed tasks
      const snoozedToday = await ctx.db
        .select({ taskId: snoozeLogs.taskId })
        .from(snoozeLogs)
        .where(eq(snoozeLogs.snoozedFrom, targetDate));
      const snoozedTaskIds = new Set(snoozedToday.map(s => s.taskId));

      // Fetch available tasks (todo, not snoozed, not already in plan)
      const allTasks = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.status, 'todo'));

      const availableTasks = allTasks.filter(
        task => !snoozedTaskIds.has(task.id) && !excludeTaskIds.has(task.id)
      );

      // Calculate domain completions for past 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

      const recentCompletions = await ctx.db
        .select()
        .from(taskCompletions)
        .where(
          and(
            gte(taskCompletions.completedDate, sevenDaysAgoStr),
            lte(taskCompletions.completedDate, targetDate)
          )
        );

      const completions7d = new Map<number, number>();
      for (const completion of recentCompletions) {
        const count = completions7d.get(completion.domainId) || 0;
        completions7d.set(completion.domainId, count + 1);
      }

      // Generate new plan items
      const plan = generatePlan({
        availableTasks: availableTasks as Task[],
        domains: allDomains as Domain[],
        completions7d,
        energyLevel: input.energyLevel,
        currentDate: targetDate,
      });

      // Insert new plan items
      if (plan.items.length > 0) {
        const newItems = plan.items.map(item => ({
          planId: existingPlan.id,
          taskId: item.taskId,
          category: item.category,
          completed: false,
          snoozed: false,
        }));
        await ctx.db.insert(todayPlanItems).values(newItems);
      }

      // Return the full updated plan
      const allPlanItems = await ctx.db
        .select()
        .from(todayPlanItems)
        .where(eq(todayPlanItems.planId, existingPlan.id));

      const taskMap = new Map<number, typeof tasks.$inferSelect>();
      for (const item of allPlanItems) {
        const [task] = await ctx.db
          .select()
          .from(tasks)
          .where(eq(tasks.id, item.taskId))
          .limit(1);
        if (task) taskMap.set(task.id, task);
      }

      const itemsWithTasks = allPlanItems.map(item => {
        const task = taskMap.get(item.taskId);
        if (!task) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Task ${item.taskId} not found`,
          });
        }
        return {
          id: item.id,
          planId: item.planId,
          taskId: item.taskId,
          category: item.category,
          completed: item.completed,
          snoozed: item.snoozed,
          task,
        };
      });

      return {
        id: existingPlan.id,
        date: existingPlan.date,
        energyLevel: input.energyLevel,
        items: itemsWithTasks,
        createdAt: existingPlan.createdAt,
      };
    }),

  /**
   * Get today's plan
   * 
   * Retrieves the existing plan for a given date (defaults to today).
   * Returns null if no plan exists or plan has 0 active items.
   * Active items = not snoozed (skipped).
   */
  getToday: publicProcedure
    .input(getTodayPlanSchema)
    .query(async ({ ctx, input }) => {
      const targetDate = input.date || new Date().toISOString().split('T')[0];

      const [plan] = await ctx.db
        .select()
        .from(todayPlans)
        .where(eq(todayPlans.date, targetDate))
        .limit(1);

      if (!plan) {
        return null;
      }

      const planItems = await ctx.db
        .select()
        .from(todayPlanItems)
        .where(eq(todayPlanItems.planId, plan.id));

      // If plan has no items at all, treat as "no plan"
      if (planItems.length === 0) {
        return null;
      }

      // Build task map
      const taskMap = new Map<number, typeof tasks.$inferSelect>();
      for (const item of planItems) {
        const [task] = await ctx.db
          .select()
          .from(tasks)
          .where(eq(tasks.id, item.taskId))
          .limit(1);
        if (task) taskMap.set(task.id, task);
      }

      const itemsWithTasks = planItems.map(item => {
        const task = taskMap.get(item.taskId);
        if (!task) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Task ${item.taskId} not found`,
          });
        }
        return {
          id: item.id,
          planId: item.planId,
          taskId: item.taskId,
          category: item.category,
          completed: item.completed,
          snoozed: item.snoozed,
          task,
        };
      });

      return {
        id: plan.id,
        date: plan.date,
        energyLevel: plan.energyLevel,
        items: itemsWithTasks,
        createdAt: plan.createdAt,
      };
    }),

  /**
   * Skip a plan item
   * 
   * Marks the plan item as snoozed (skipped). The underlying task stays as 'todo'
   * so it rolls into the next day naturally. The skipped item remains visible
   * in the daily progress panel.
   */
  skipPlanItem: publicProcedure
    .input(z.object({ planItemId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [item] = await ctx.db
        .select()
        .from(todayPlanItems)
        .where(eq(todayPlanItems.id, input.planItemId))
        .limit(1);

      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan item not found' });
      }

      await ctx.db
        .update(todayPlanItems)
        .set({ snoozed: true })
        .where(eq(todayPlanItems.id, input.planItemId));

      return { success: true };
    }),

  /**
   * Get daily progress
   * 
   * Returns all completed and skipped tasks for a given date across all plan loops.
   * This powers the progress panel that persists across energy level resets.
   */
  getDailyProgress: publicProcedure
    .input(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const targetDate = input.date || new Date().toISOString().split('T')[0];

      // Get all completions for today
      const completions = await ctx.db
        .select({
          taskId: taskCompletions.taskId,
          completedAt: taskCompletions.completedAt,
        })
        .from(taskCompletions)
        .where(eq(taskCompletions.completedDate, targetDate));

      // Get task details for completed tasks
      const completedTasks: Array<{
        taskId: number;
        title: string;
        completedAt: string;
        status: 'completed';
      }> = [];

      for (const c of completions) {
        const [task] = await ctx.db
          .select()
          .from(tasks)
          .where(eq(tasks.id, c.taskId))
          .limit(1);
        if (task) {
          completedTasks.push({
            taskId: task.id,
            title: task.title,
            completedAt: c.completedAt,
            status: 'completed',
          });
        }
      }

      // Get all skipped plan items for today
      const plansToday = await ctx.db
        .select()
        .from(todayPlans)
        .where(eq(todayPlans.date, targetDate));

      const skippedTasks: Array<{
        taskId: number;
        planItemId: number;
        title: string;
        status: 'skipped';
      }> = [];

      for (const plan of plansToday) {
        const skippedItems = await ctx.db
          .select()
          .from(todayPlanItems)
          .where(
            and(
              eq(todayPlanItems.planId, plan.id),
              eq(todayPlanItems.snoozed, true)
            )
          );

        for (const item of skippedItems) {
          const [task] = await ctx.db
            .select()
            .from(tasks)
            .where(eq(tasks.id, item.taskId))
            .limit(1);
          if (task) {
            skippedTasks.push({
              taskId: task.id,
              planItemId: item.id,
              title: task.title,
              status: 'skipped',
            });
          }
        }
      }

      return {
        date: targetDate,
        completedCount: completedTasks.length,
        skippedCount: skippedTasks.length,
        completedTasks,
        skippedTasks,
      };
    }),
});
