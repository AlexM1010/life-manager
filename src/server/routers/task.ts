import { router, publicProcedure } from '../trpc.js';
import { tasks, taskCompletions, snoozeLogs, domains, taskSyncMetadata } from '../db/schema.js';
import {
  createTaskSchema,
  updateTaskSchema,
  completeTaskSchema,
  deleteTaskSchema,
  listTasksSchema,
  snoozeTaskSchema,
  TaskStatus,
} from '../../shared/types.js';
import { eq, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import rruleLib from 'rrule';
import { SyncEngine } from '../services/sync-engine.js';
import { OAuthManager } from '../services/oauth-manager.js';
const RRule = rruleLib.RRule;

/**
 * Helper function to trigger Google sync for a task
 * 
 * This function attempts to sync a task to Google Calendar/Tasks.
 * If sync fails, it logs the error but doesn't fail the task operation.
 * This ensures that local task operations always succeed even if Google is unavailable.
 * 
 * @param db - Database instance
 * @param taskId - ID of the task to sync
 * @param operation - Type of sync operation ('create' | 'update' | 'complete')
 */
async function triggerSync(
  db: any,
  taskId: number,
  operation: 'create' | 'update' | 'complete'
): Promise<void> {
  try {
    const userId = 1;
    const defaultDomainId = 1;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5173/auth/google/callback';

    if (!clientId || !clientSecret) {
      // Google OAuth not configured — skip sync silently
      return;
    }

    const oauthManager = new OAuthManager(db, { clientId, clientSecret, redirectUri });
    const syncEngine = new SyncEngine(db, oauthManager, userId, defaultDomainId);
    
    // Trigger the appropriate sync operation
    // These operations run asynchronously and handle their own errors
    switch (operation) {
      case 'create':
        await syncEngine.exportNewTask(taskId);
        break;
      case 'update':
        await syncEngine.exportTaskModification(taskId);
        break;
      case 'complete':
        await syncEngine.exportTaskCompletion(taskId);
        break;
    }
  } catch (error) {
    // Log sync errors but don't fail the task operation
    // The sync engine will queue failed operations for retry
    console.error(`Sync failed for task ${taskId} (${operation}):`, error);
  }
}

/**
 * Task Router
 * 
 * Provides CRUD operations for tasks:
 * - create: Create a new task with validation
 * - update: Update an existing task (partial updates)
 * - complete: Mark task as done and log completion
 * - delete: Remove a task
 * - list: Get filtered list of tasks
 * - snooze: Defer a task and log the snooze event
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.6, 2.7
 */
export const taskRouter = router({
  /**
   * Create a new task
   * 
   * Requirement 2.1: Store task with title, description, domain, priority, 
   * estimated duration, due date, and status set to "todo"
   * Requirement 2.6: Reject creation if domainId is invalid
   * Requirement 2.7: Reject creation if duration is outside [1, 480] minutes
   */
  create: publicProcedure
    .input(createTaskSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify domain exists
      const [domain] = await ctx.db
        .select()
        .from(domains)
        .where(eq(domains.id, input.domainId))
        .limit(1);

      if (!domain) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Domain not found',
        });
      }

      const now = new Date().toISOString();

      const [task] = await ctx.db
        .insert(tasks)
        .values({
          title: input.title,
          description: input.description || null,
          domainId: input.domainId,
          priority: input.priority,
          estimatedMinutes: input.estimatedMinutes,
          dueDate: input.dueDate || null,
          status: TaskStatus.TODO,
          rrule: input.rrule || null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // Trigger Google sync asynchronously (non-blocking)
      // Requirement 5.1, 5.6: Sync new tasks within 5 seconds
      triggerSync(ctx.db, task.id, 'create').catch(err => {
        console.error('Background sync failed:', err);
      });

      return task;
    }),

  /**
   * Update an existing task
   * 
   * Requirement 2.2: Persist new status and record timestamp of transition
   * Supports partial updates of any task field
   */
  update: publicProcedure
    .input(updateTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Check if task exists
      const [existingTask] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, id))
        .limit(1);

      if (!existingTask) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Task not found',
        });
      }

      // If domainId is being updated, verify the new domain exists
      if (updates.domainId !== undefined) {
        const [domain] = await ctx.db
          .select()
          .from(domains)
          .where(eq(domains.id, updates.domainId))
          .limit(1);

        if (!domain) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Domain not found',
          });
        }
      }

      const now = new Date().toISOString();

      const [updatedTask] = await ctx.db
        .update(tasks)
        .set({
          ...updates,
          updatedAt: now,
        })
        .where(eq(tasks.id, id))
        .returning();

      // Trigger Google sync asynchronously (non-blocking)
      // Requirement 6.1, 6.6: Sync task modifications within 5 seconds
      triggerSync(ctx.db, id, 'update').catch(err => {
        console.error('Background sync failed:', err);
      });

      return updatedTask;
    }),

  /**
   * Complete a task
   * 
   * Requirement 2.3: Mark task as "done" and log completion with timestamp
   * Requirement 2.4: Store recurrence pattern as rrule string
   * Requirement 2.5: Generate next instance by evaluating rrule
   * Creates a task_completion record for tracking and streak calculation
   * If task has an rrule, generates next instance with next occurrence date
   */
  complete: publicProcedure
    .input(completeTaskSchema)
    .mutation(async ({ ctx, input }) => {
      // Get the task to access its domainId and rrule
      const [task] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.id))
        .limit(1);

      if (!task) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Task not found',
        });
      }

      const now = new Date().toISOString();
      const today = now.split('T')[0]; // Extract date portion (YYYY-MM-DD)

      // Update task status to "done"
      const [updatedTask] = await ctx.db
        .update(tasks)
        .set({
          status: TaskStatus.DONE,
          updatedAt: now,
        })
        .where(eq(tasks.id, input.id))
        .returning();

      // Log the completion
      await ctx.db.insert(taskCompletions).values({
        taskId: task.id,
        domainId: task.domainId,
        completedAt: now,
        completedDate: today,
      });

      // Trigger Google sync asynchronously (non-blocking)
      // Requirement 4.1, 4.5: Sync task completions within 5 seconds
      triggerSync(ctx.db, input.id, 'complete').catch(err => {
        console.error('Background sync failed:', err);
      });

      // If task has an rrule, generate next instance
      if (task.rrule) {
        try {
          // Parse the rrule string - RRule.fromString expects "RRULE:" prefix
          const rruleString = task.rrule.startsWith('RRULE:') ? task.rrule : `RRULE:${task.rrule}`;
          const rule = RRule.fromString(rruleString);
          
          // Get the next occurrence after now
          const nextOccurrence = rule.after(new Date(), false);
          
          if (nextOccurrence) {
            // Create new task instance with next due date
            const nextDueDate = nextOccurrence.toISOString();
            
            await ctx.db.insert(tasks).values({
              title: task.title,
              description: task.description,
              domainId: task.domainId,
              priority: task.priority,
              estimatedMinutes: task.estimatedMinutes,
              dueDate: nextDueDate,
              status: TaskStatus.TODO,
              rrule: task.rrule, // Keep the same rrule for future recurrences
              createdAt: now,
              updatedAt: now,
            });
          }
        } catch (error) {
          // Log error but don't fail the completion
          console.error('Failed to generate next recurring task instance:', error);
        }
      }

      return updatedTask;
    }),

  /**
   * Delete a task
   * 
   * Removes a task from the database
   */
  delete: publicProcedure
    .input(deleteTaskSchema)
    .mutation(async ({ ctx, input }) => {
      // Check if task exists
      const [existingTask] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.id))
        .limit(1);

      if (!existingTask) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Task not found',
        });
      }

      // Delete the task
      await ctx.db.delete(tasks).where(eq(tasks.id, input.id));

      return { success: true, id: input.id };
    }),

  /**
   * List tasks with optional filters
   * 
   * Returns tasks with sync metadata (if available).
   * Requirement 2.6: Support filtering by domainId, status, and priority
   */
  list: publicProcedure
    .input(listTasksSchema)
    .query(async ({ ctx, input }) => {
      // Build filter conditions
      const conditions = [];

      if (input.domainId !== undefined) {
        conditions.push(eq(tasks.domainId, input.domainId));
      }

      if (input.status !== undefined) {
        conditions.push(eq(tasks.status, input.status));
      }

      if (input.priority !== undefined) {
        conditions.push(eq(tasks.priority, input.priority));
      }

      // Query with left join to include sync metadata
      let query = ctx.db
        .select({
          // Task fields
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          domainId: tasks.domainId,
          priority: tasks.priority,
          estimatedMinutes: tasks.estimatedMinutes,
          dueDate: tasks.dueDate,
          status: tasks.status,
          rrule: tasks.rrule,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
          // Sync metadata fields (nullable)
          syncMetadata: {
            googleTaskId: taskSyncMetadata.googleTaskId,
            googleEventId: taskSyncMetadata.googleEventId,
            isFixed: taskSyncMetadata.isFixed,
            lastSyncTime: taskSyncMetadata.lastSyncTime,
            syncStatus: taskSyncMetadata.syncStatus,
            syncError: taskSyncMetadata.syncError,
          },
        })
        .from(tasks)
        .leftJoin(taskSyncMetadata, eq(tasks.id, taskSyncMetadata.taskId));

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      const taskList = await query;

      // Transform to include syncMetadata as nested object (null if no sync data)
      return taskList.map(task => ({
        ...task,
        syncMetadata: task.syncMetadata?.googleTaskId || task.syncMetadata?.googleEventId
          ? task.syncMetadata
          : null,
      }));
    }),

  /**
   * Snooze a task
   * 
   * Requirement 3.5: Log snooze event with timestamp and remove from current plan
   * Records the original date and new date for tracking
   */
  snooze: publicProcedure
    .input(snoozeTaskSchema)
    .mutation(async ({ ctx, input }) => {
      // Check if task exists
      const [task] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.id))
        .limit(1);

      if (!task) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Task not found',
        });
      }

      const now = new Date().toISOString();
      const today = now.split('T')[0]; // Extract date portion (YYYY-MM-DD)
      const newDate = input.newDate.split('T')[0]; // Extract date portion

      // Log the snooze event
      await ctx.db.insert(snoozeLogs).values({
        taskId: task.id,
        snoozedAt: now,
        snoozedFrom: today,
        snoozedTo: newDate,
      });

      // Update task's due date to the new date
      const [updatedTask] = await ctx.db
        .update(tasks)
        .set({
          dueDate: input.newDate,
          updatedAt: now,
        })
        .where(eq(tasks.id, input.id))
        .returning();

      return updatedTask;
    }),
});
