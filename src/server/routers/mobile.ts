import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import { db } from '../db/index.js';
import { tasks, dailyLogs, domains } from '../db/schema.js';
import { eq, and, gte, desc } from 'drizzle-orm';

/**
 * Mobile API Router
 * Simple REST-like endpoints for mobile launcher integration
 */

export const mobileRouter = router({
  /**
   * Get today's plan for mobile widget
   * Returns next task, energy status, and balance warnings
   */
  getToday: publicProcedure.query(async () => {
    const today = new Date().toISOString().split('T')[0];
    
    // Get today's energy log
    const energyLog = await db
      .select()
      .from(dailyLogs)
      .where(eq(dailyLogs.date, today))
      .limit(1);
    
    // Get next incomplete task
    const nextTask = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        duration: tasks.estimatedDuration,
        domain: domains.name,
      })
      .from(tasks)
      .leftJoin(domains, eq(tasks.domainId, domains.id))
      .where(eq(tasks.completed, false))
      .orderBy(tasks.priority)
      .limit(1);
    
    // Check domain balance (tasks completed this week per domain)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    
    const allDomains = await db.select().from(domains);
    const completedTasks = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.completed, true),
          gte(tasks.completedAt || '', weekAgoStr)
        )
      );
    
    // Find domains with 0 tasks this week
    const domainTaskCounts = new Map<number, number>();
    completedTasks.forEach(task => {
      if (task.domainId) {
        domainTaskCounts.set(task.domainId, (domainTaskCounts.get(task.domainId) || 0) + 1);
      }
    });
    
    const warnings: string[] = [];
    allDomains.forEach(domain => {
      if (!domainTaskCounts.has(domain.id)) {
        warnings.push(domain.name);
      }
    });
    
    return {
      nextTask: nextTask[0] ? {
        id: nextTask[0].id,
        title: nextTask[0].title,
        duration: nextTask[0].duration || 30,
        domain: nextTask[0].domain || 'General',
      } : null,
      energy: energyLog[0] ? {
        current: energyLog[0].energyLevel || 5,
        needsUpdate: false,
      } : {
        current: 5,
        needsUpdate: true,
      },
      balance: {
        warnings: warnings.slice(0, 1), // Only return first warning
      },
    };
  }),
  
  /**
   * Complete a task
   */
  completeTask: publicProcedure
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ input }) => {
      await db
        .update(tasks)
        .set({ 
          completed: true,
          completedAt: new Date().toISOString(),
        })
        .where(eq(tasks.id, input.taskId));
      
      return { success: true };
    }),
  
  /**
   * Skip a task (mark as low priority)
   */
  skipTask: publicProcedure
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ input }) => {
      await db
        .update(tasks)
        .set({ priority: 999 })
        .where(eq(tasks.id, input.taskId));
      
      return { success: true };
    }),
  
  /**
   * Log energy level
   */
  logEnergy: publicProcedure
    .input(z.object({ level: z.number().min(0).max(10) }))
    .mutation(async ({ input }) => {
      const today = new Date().toISOString().split('T')[0];
      
      // Check if log exists for today
      const existing = await db
        .select()
        .from(dailyLogs)
        .where(eq(dailyLogs.date, today))
        .limit(1);
      
      if (existing[0]) {
        // Update existing
        await db
          .update(dailyLogs)
          .set({ energyLevel: input.level })
          .where(eq(dailyLogs.id, existing[0].id));
      } else {
        // Create new
        await db.insert(dailyLogs).values({
          date: today,
          energyLevel: input.level,
          sleepHours: null,
          mood: null,
          medicationTaken: null,
          notes: null,
        });
      }
      
      return { success: true };
    }),
});
