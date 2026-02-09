import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { taskRouter } from '../task.js';
import * as schema from '../../db/schema.js';
import * as fc from 'fast-check';
import { RRule } from 'rrule';

/**
 * Task Router Tests
 * 
 * Tests for Task CRUD operations including:
 * - Property 4: Task CRUD Round-Trip
 * - Property 5: Task Completion Logging
 * - Property 6: Recurring Task Next Instance
 * - Property 7: Task Duration Validation
 * 
 * Validates Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7
 */

// Test database setup
let sqliteDb: Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let caller: ReturnType<typeof taskRouter.createCaller>;
let testDomainId: number;

beforeEach(async () => {
  // Create in-memory database for each test
  sqliteDb = new BetterSqlite3(':memory:');
  db = drizzle(sqliteDb, { schema });

  // Run migrations
  migrate(db, { migrationsFolder: './drizzle' });

  // Create caller with test context
  caller = taskRouter.createCaller({ db });

  // Create a test domain for tasks
  const [domain] = await db.insert(schema.domains).values({
    name: 'Test Domain',
    description: 'Test domain for tasks',
    whyItMatters: 'Testing',
    boringButImportant: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).returning();

  testDomainId = domain.id;
});

afterEach(() => {
  sqliteDb.close();
});

// ============================================================================
// Unit Tests - Specific Examples and Edge Cases
// ============================================================================

describe('Task CRUD - Unit Tests', () => {
  describe('create', () => {
    it('should create a task with all fields', async () => {
      const input = {
        title: 'Exercise',
        description: 'Go for a run',
        domainId: testDomainId,
        priority: 'must-do' as const,
        estimatedMinutes: 30,
        dueDate: '2026-02-15T10:00:00Z',
        rrule: 'FREQ=DAILY;INTERVAL=1',
      };

      const result = await caller.create(input);

      expect(result).toMatchObject({
        id: expect.any(Number),
        title: 'Exercise',
        description: 'Go for a run',
        domainId: testDomainId,
        priority: 'must-do',
        estimatedMinutes: 30,
        dueDate: '2026-02-15T10:00:00Z',
        status: 'todo',
        rrule: 'FREQ=DAILY;INTERVAL=1',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('should create a task with minimal fields', async () => {
      const input = {
        title: 'Simple task',
        domainId: testDomainId,
        priority: 'nice-to-have' as const,
        estimatedMinutes: 15,
      };

      const result = await caller.create(input);

      expect(result).toMatchObject({
        title: 'Simple task',
        domainId: testDomainId,
        priority: 'nice-to-have',
        estimatedMinutes: 15,
        status: 'todo',
        description: null,
        dueDate: null,
        rrule: null,
      });
    });

    it('should reject task with invalid domainId', async () => {
      await expect(
        caller.create({
          title: 'Task',
          domainId: 999,
          priority: 'must-do',
          estimatedMinutes: 30,
        })
      ).rejects.toThrow('Domain not found');
    });

    it('should reject task with duration < 1 minute', async () => {
      await expect(
        caller.create({
          title: 'Task',
          domainId: testDomainId,
          priority: 'must-do',
          estimatedMinutes: 0,
        })
      ).rejects.toThrow();
    });

    it('should reject task with duration > 480 minutes', async () => {
      await expect(
        caller.create({
          title: 'Task',
          domainId: testDomainId,
          priority: 'must-do',
          estimatedMinutes: 481,
        })
      ).rejects.toThrow();
    });

    it('should accept task with duration = 1 minute (boundary)', async () => {
      const result = await caller.create({
        title: 'Quick task',
        domainId: testDomainId,
        priority: 'must-do',
        estimatedMinutes: 1,
      });

      expect(result.estimatedMinutes).toBe(1);
    });

    it('should accept task with duration = 480 minutes (boundary)', async () => {
      const result = await caller.create({
        title: 'Long task',
        domainId: testDomainId,
        priority: 'must-do',
        estimatedMinutes: 480,
      });

      expect(result.estimatedMinutes).toBe(480);
    });
  });

  describe('complete', () => {
    it('should mark task as done and log completion', async () => {
      // Create task
      const task = await caller.create({
        title: 'Exercise',
        domainId: testDomainId,
        priority: 'must-do',
        estimatedMinutes: 30,
      });

      // Complete task
      const result = await caller.complete({ id: task.id });

      expect(result.status).toBe('done');

      // Verify completion was logged
      const completions = await db.select().from(schema.taskCompletions);
      expect(completions).toHaveLength(1);
      expect(completions[0]).toMatchObject({
        taskId: task.id,
        domainId: testDomainId,
        completedAt: expect.any(String),
        completedDate: expect.any(String),
      });
    });

    it('should reject completion of non-existent task', async () => {
      await expect(caller.complete({ id: 999 })).rejects.toThrow('Task not found');
    });

    it('should generate next instance for recurring task (daily)', async () => {
      // Create recurring task (daily)
      const task = await caller.create({
        title: 'Daily Exercise',
        domainId: testDomainId,
        priority: 'must-do',
        estimatedMinutes: 30,
        rrule: 'FREQ=DAILY;INTERVAL=1',
      });

      // Complete task
      await caller.complete({ id: task.id });

      // Verify next instance was created
      const allTasks = await db.select().from(schema.tasks);
      expect(allTasks).toHaveLength(2); // original + next instance

      const nextInstance = allTasks.find((t) => t.id !== task.id);
      expect(nextInstance).toBeDefined();
      expect(nextInstance?.title).toBe('Daily Exercise');
      expect(nextInstance?.status).toBe('todo');
      expect(nextInstance?.rrule).toBe('FREQ=DAILY;INTERVAL=1');
      expect(nextInstance?.dueDate).toBeTruthy();

      // Verify next due date is in the future
      const nextDueDate = new Date(nextInstance!.dueDate!);
      expect(nextDueDate.getTime()).toBeGreaterThan(Date.now());
    });

    it('should generate next instance for recurring task (weekly)', async () => {
      // Create recurring task (weekly on Monday)
      const task = await caller.create({
        title: 'Weekly Review',
        domainId: testDomainId,
        priority: 'should-do',
        estimatedMinutes: 60,
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
      });

      // Complete task
      await caller.complete({ id: task.id });

      // Verify next instance was created
      const allTasks = await db.select().from(schema.tasks);
      expect(allTasks).toHaveLength(2);

      const nextInstance = allTasks.find((t) => t.id !== task.id);
      expect(nextInstance).toBeDefined();
      expect(nextInstance?.title).toBe('Weekly Review');
      expect(nextInstance?.status).toBe('todo');
      expect(nextInstance?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
    });

    it('should not create next instance for non-recurring task', async () => {
      // Create non-recurring task
      const task = await caller.create({
        title: 'One-time task',
        domainId: testDomainId,
        priority: 'must-do',
        estimatedMinutes: 30,
      });

      // Complete task
      await caller.complete({ id: task.id });

      // Verify no new instance was created
      const allTasks = await db.select().from(schema.tasks);
      expect(allTasks).toHaveLength(1);
      expect(allTasks[0].status).toBe('done');
    });

    it('should preserve all fields in next recurring instance', async () => {
      // Create recurring task with all fields
      const task = await caller.create({
        title: 'Daily Meditation',
        description: 'Morning mindfulness practice',
        domainId: testDomainId,
        priority: 'should-do',
        estimatedMinutes: 15,
        rrule: 'FREQ=DAILY;INTERVAL=1',
      });

      // Complete task
      await caller.complete({ id: task.id });

      // Verify next instance preserves all fields
      const allTasks = await db.select().from(schema.tasks);
      const nextInstance = allTasks.find((t) => t.id !== task.id);

      expect(nextInstance).toMatchObject({
        title: 'Daily Meditation',
        description: 'Morning mindfulness practice',
        domainId: testDomainId,
        priority: 'should-do',
        estimatedMinutes: 15,
        status: 'todo',
        rrule: 'FREQ=DAILY;INTERVAL=1',
      });
    });

    it('should handle completion even if rrule parsing fails', async () => {
      // Create task with invalid rrule
      const task = await caller.create({
        title: 'Task with bad rrule',
        domainId: testDomainId,
        priority: 'must-do',
        estimatedMinutes: 30,
        rrule: 'INVALID_RRULE',
      });

      // Complete task - should succeed despite bad rrule
      const result = await caller.complete({ id: task.id });

      expect(result.status).toBe('done');

      // Verify completion was logged
      const completions = await db.select().from(schema.taskCompletions);
      expect(completions).toHaveLength(1);

      // Verify no next instance was created
      const allTasks = await db.select().from(schema.tasks);
      expect(allTasks).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('should update task fields', async () => {
      const task = await caller.create({
        title: 'Original',
        domainId: testDomainId,
        priority: 'must-do',
        estimatedMinutes: 30,
      });

      const updated = await caller.update({
        id: task.id,
        title: 'Updated',
        priority: 'should-do',
      });

      expect(updated).toMatchObject({
        title: 'Updated',
        priority: 'should-do',
        estimatedMinutes: 30, // unchanged
      });
    });

    it('should reject update of non-existent task', async () => {
      await expect(
        caller.update({
          id: 999,
          title: 'Does not exist',
        })
      ).rejects.toThrow('Task not found');
    });
  });

  describe('delete', () => {
    it('should delete task', async () => {
      const task = await caller.create({
        title: 'To delete',
        domainId: testDomainId,
        priority: 'must-do',
        estimatedMinutes: 30,
      });

      const result = await caller.delete({ id: task.id });

      expect(result).toEqual({ success: true, id: task.id });

      // Verify task is gone
      const allTasks = await db.select().from(schema.tasks);
      expect(allTasks).toHaveLength(0);
    });

    it('should reject deletion of non-existent task', async () => {
      await expect(caller.delete({ id: 999 })).rejects.toThrow('Task not found');
    });
  });

  describe('list', () => {
    it('should return empty list when no tasks exist', async () => {
      const result = await caller.list({});
      expect(result).toEqual([]);
    });

    it('should list all tasks', async () => {
      await caller.create({
        title: 'Task 1',
        domainId: testDomainId,
        priority: 'must-do',
        estimatedMinutes: 30,
      });

      await caller.create({
        title: 'Task 2',
        domainId: testDomainId,
        priority: 'should-do',
        estimatedMinutes: 15,
      });

      const result = await caller.list({});
      expect(result).toHaveLength(2);
    });

    it('should filter by status', async () => {
      const task1 = await caller.create({
        title: 'Task 1',
        domainId: testDomainId,
        priority: 'must-do',
        estimatedMinutes: 30,
      });

      await caller.create({
        title: 'Task 2',
        domainId: testDomainId,
        priority: 'must-do',
        estimatedMinutes: 30,
      });

      // Complete first task
      await caller.complete({ id: task1.id });

      // Filter by status
      const todoTasks = await caller.list({ status: 'todo' });
      const doneTasks = await caller.list({ status: 'done' });

      expect(todoTasks).toHaveLength(1);
      expect(doneTasks).toHaveLength(1);
    });

    it('should filter by priority', async () => {
      await caller.create({
        title: 'Must do',
        domainId: testDomainId,
        priority: 'must-do',
        estimatedMinutes: 30,
      });

      await caller.create({
        title: 'Nice to have',
        domainId: testDomainId,
        priority: 'nice-to-have',
        estimatedMinutes: 15,
      });

      const mustDoTasks = await caller.list({ priority: 'must-do' });
      expect(mustDoTasks).toHaveLength(1);
      expect(mustDoTasks[0].priority).toBe('must-do');
    });
  });

  describe('snooze', () => {
    it('should snooze task and update due date', async () => {
      const task = await caller.create({
        title: 'Task to snooze',
        domainId: testDomainId,
        priority: 'must-do',
        estimatedMinutes: 30,
        dueDate: '2026-02-15T10:00:00Z',
      });

      const newDate = '2026-02-20T10:00:00Z';
      const result = await caller.snooze({ id: task.id, newDate });

      expect(result.dueDate).toBe(newDate);
    });
  });
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Task CRUD - Property Tests', () => {
  // Helper to create a fresh database for each property test iteration
  const createFreshDb = async () => {
    const sqliteDb = new BetterSqlite3(':memory:');
    const db = drizzle(sqliteDb, { schema });
    migrate(db, { migrationsFolder: './drizzle' });
    const caller = taskRouter.createCaller({ db });

    // Create test domain
    const [domain] = await db.insert(schema.domains).values({
      name: 'Test Domain',
      description: 'Test',
      whyItMatters: 'Testing',
      boringButImportant: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning();

    return { sqliteDb, db, caller, domainId: domain.id };
  };

  // Arbitraries (generators) for property-based testing
  const taskTitleArb = fc.string({ minLength: 1, maxLength: 200 });
  const taskDescriptionArb = fc.option(fc.string({ maxLength: 1000 }), { nil: undefined });
  const priorityArb = fc.constantFrom('must-do', 'should-do', 'nice-to-have');
  const estimatedMinutesArb = fc.integer({ min: 1, max: 480 });
  const dueDateArb = fc.option(fc.date({ min: new Date(), max: new Date('2030-12-31') }).map(d => d.toISOString()), { nil: undefined });

  // Valid rrule strings for testing
  const rruleArb = fc.option(
    fc.constantFrom(
      'FREQ=DAILY;INTERVAL=1',
      'FREQ=WEEKLY;BYDAY=MO',
      'FREQ=WEEKLY;BYDAY=FR',
      'FREQ=MONTHLY;BYMONTHDAY=1',
      'FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1'
    ),
    { nil: undefined }
  );

  const validTaskInputArb = (domainId: number) =>
    fc.record({
      title: taskTitleArb,
      description: taskDescriptionArb,
      domainId: fc.constant(domainId),
      priority: priorityArb,
      estimatedMinutes: estimatedMinutesArb,
      dueDate: dueDateArb,
      rrule: rruleArb,
    });

  /**
   * Property 4: Task CRUD Round-Trip
   * 
   * For any valid task input, creating the task and reading it back
   * should return matching field values with status defaulting to "todo".
   * 
   * Validates: Requirements 2.1
   */
  it('Property 4: Task CRUD Round-Trip', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 100 }), async (seed) => {
        const { sqliteDb: testDb, caller: testCaller, domainId } = await createFreshDb();

        try {
          const input = fc.sample(validTaskInputArb(domainId), { seed, numRuns: 1 })[0];

          // Create task
          const created = await testCaller.create(input);

          // Verify all fields match
          expect(created.title).toBe(input.title);
          expect(created.description).toBe(input.description || null);
          expect(created.domainId).toBe(input.domainId);
          expect(created.priority).toBe(input.priority);
          expect(created.estimatedMinutes).toBe(input.estimatedMinutes);
          expect(created.dueDate).toBe(input.dueDate || null);
          expect(created.status).toBe('todo');
          expect(created.rrule).toBe(input.rrule || null);

          // Read back via list
          const list = await testCaller.list({});
          const found = list.find((t) => t.id === created.id);

          expect(found).toBeDefined();
          expect(found?.title).toBe(input.title);
          expect(found?.status).toBe('todo');
        } finally {
          testDb.close();
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5: Task Completion Logging
   * 
   * For any task, marking it as "done" should: (a) update the task's status
   * to "done" with a recorded timestamp, and (b) create a task_completion
   * record with the correct taskId, domainId, and completion timestamp.
   * 
   * Validates: Requirements 2.2, 2.3
   */
  it('Property 5: Task Completion Logging', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 100 }), async (seed) => {
        const { sqliteDb: testDb, db: testDbInstance, caller: testCaller, domainId } = await createFreshDb();

        try {
          const input = fc.sample(validTaskInputArb(domainId), { seed, numRuns: 1 })[0];

          // Create task
          const task = await testCaller.create(input);

          // Complete task
          const completed = await testCaller.complete({ id: task.id });

          // Verify status is "done"
          expect(completed.status).toBe('done');

          // Verify completion was logged
          const completions = await testDbInstance.select().from(schema.taskCompletions);
          expect(completions).toHaveLength(1);
          expect(completions[0].taskId).toBe(task.id);
          expect(completions[0].domainId).toBe(domainId);
          expect(completions[0].completedAt).toBeTruthy();
          expect(completions[0].completedDate).toBeTruthy();
        } finally {
          testDb.close();
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6: Recurring Task Next Instance
   * 
   * For any task with a valid rrule string, completing the task should
   * generate a new task instance with status "todo" and a due date equal
   * to the next occurrence produced by evaluating the rrule from the
   * current date.
   * 
   * Validates: Requirements 2.4, 2.5
   */
  it('Property 6: Recurring Task Next Instance', async () => {
    await fc.assert(
      fc.asyncProperty(
        taskTitleArb,
        priorityArb,
        estimatedMinutesArb,
        fc.constantFrom(
          'FREQ=DAILY;INTERVAL=1',
          'FREQ=WEEKLY;BYDAY=MO',
          'FREQ=MONTHLY;BYMONTHDAY=15'
        ),
        async (title, priority, estimatedMinutes, rruleString) => {
          const { sqliteDb: testDb, db: testDbInstance, caller: testCaller, domainId } = await createFreshDb();

          try {
            // Create recurring task
            const task = await testCaller.create({
              title,
              domainId,
              priority,
              estimatedMinutes,
              rrule: rruleString,
            });

            // Complete task
            await testCaller.complete({ id: task.id });

            // Verify next instance was created
            const allTasks = await testDbInstance.select().from(schema.tasks);
            expect(allTasks.length).toBeGreaterThanOrEqual(2);

            const nextInstance = allTasks.find((t) => t.id !== task.id && t.status === 'todo');
            expect(nextInstance).toBeDefined();

            // Verify next instance has correct fields
            expect(nextInstance?.title).toBe(title);
            expect(nextInstance?.domainId).toBe(domainId);
            expect(nextInstance?.priority).toBe(priority);
            expect(nextInstance?.estimatedMinutes).toBe(estimatedMinutes);
            expect(nextInstance?.status).toBe('todo');
            expect(nextInstance?.rrule).toBe(rruleString);
            expect(nextInstance?.dueDate).toBeTruthy();

            // Verify next due date is calculated correctly
            const rule = RRule.fromString(rruleString);
            const expectedNextDate = rule.after(new Date(), false);
            expect(expectedNextDate).toBeTruthy();

            const actualNextDate = new Date(nextInstance!.dueDate!);
            // Allow small time difference due to execution time
            const timeDiff = Math.abs(actualNextDate.getTime() - expectedNextDate!.getTime());
            expect(timeDiff).toBeLessThan(5000); // 5 seconds tolerance
          } finally {
            testDb.close();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 7: Task Duration Validation
   * 
   * For any integer outside the range [1, 480], attempting to create a
   * task with that estimated duration should be rejected with a validation
   * error, and no task should be persisted.
   * 
   * Validates: Requirements 2.7
   */
  it('Property 7: Task Duration Validation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.integer({ max: 0 }),
          fc.integer({ min: 481, max: 10000 })
        ),
        async (invalidDuration) => {
          const { sqliteDb: testDb, caller: testCaller, domainId } = await createFreshDb();

          try {
            // Attempt to create task with invalid duration
            await expect(
              testCaller.create({
                title: 'Invalid task',
                domainId,
                priority: 'must-do',
                estimatedMinutes: invalidDuration,
              })
            ).rejects.toThrow();

            // Verify no task was created
            const allTasks = await testCaller.list({});
            expect(allTasks).toHaveLength(0);
          } finally {
            testDb.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
