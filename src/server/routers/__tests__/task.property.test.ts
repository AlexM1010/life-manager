import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { taskRouter } from '../task.js';
import * as schema from '../../db/schema.js';
import * as fc from 'fast-check';
import { eq } from 'drizzle-orm';
import { TaskPriority, TaskStatus } from '../../../shared/types.js';

/**
 * Task Router Property Tests
 * 
 * Property-based tests for Task CRUD operations:
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

beforeEach(() => {
  // Create in-memory database for each test
  sqliteDb = new BetterSqlite3(':memory:');
  db = drizzle(sqliteDb);

  // Run migrations
  migrate(db, { migrationsFolder: './drizzle' });
});

afterEach(() => {
  sqliteDb.close();
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Task CRUD - Property Tests', () => {
  // Helper to create a fresh database for each property test iteration
  const createFreshDb = () => {
    const sqliteDb = new BetterSqlite3(':memory:');
    const db = drizzle(sqliteDb, { schema });
    migrate(db, { migrationsFolder: './drizzle' });
    const caller = taskRouter.createCaller({ db });
    return { sqliteDb, db, caller };
  };

  // Helper to create a test domain
  const createTestDomain = async (db: ReturnType<typeof drizzle<typeof schema>>, name = 'Test Domain') => {
    const now = new Date().toISOString();
    const [domain] = await db
      .insert(schema.domains)
      .values({
        name,
        description: 'Test description',
        whyItMatters: 'Test reason',
        boringButImportant: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return domain;
  };

  // Arbitraries (generators) for property-based testing
  const taskTitleArb = fc.string({ minLength: 1, maxLength: 200 });
  const taskDescriptionArb = fc.option(fc.string({ maxLength: 500 }), { nil: undefined });
  const priorityArb = fc.constantFrom(
    TaskPriority.MUST_DO,
    TaskPriority.SHOULD_DO,
    TaskPriority.NICE_TO_HAVE
  );
  const validDurationArb = fc.integer({ min: 1, max: 480 });
  const dueDateArb = fc.option(
    fc.date({ min: new Date('2024-01-01T00:00:00.000Z'), max: new Date('2026-12-31T23:59:59.999Z') }).map((d) => {
      // Ensure the date is valid before converting to ISO string
      if (isNaN(d.getTime())) {
        return new Date('2025-01-01T00:00:00.000Z').toISOString();
      }
      return d.toISOString();
    }),
    { nil: undefined }
  );

  // RRule generator for recurring tasks
  const rruleArb = fc.option(
    fc.constantFrom(
      'FREQ=DAILY',
      'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      'FREQ=WEEKLY;BYDAY=TU,TH',
      'FREQ=MONTHLY;BYMONTHDAY=1',
      'FREQ=DAILY;INTERVAL=2'
    ),
    { nil: undefined }
  );

  const validTaskInputArb = fc.record({
    title: taskTitleArb,
    description: taskDescriptionArb,
    priority: priorityArb,
    estimatedMinutes: validDurationArb,
    dueDate: dueDateArb,
    rrule: rruleArb,
  });

  /**
   * Property 4: Task CRUD Round-Trip
   * 
   * For any valid task input (title, domainId, priority, estimatedMinutes,
   * optional description, optional dueDate, optional rrule), creating the
   * task and reading it back should return matching field values with
   * status defaulting to "todo".
   * 
   * Validates: Requirements 2.1
   */
  it('Property 4: Task CRUD Round-Trip', async () => {
    await fc.assert(
      fc.asyncProperty(validTaskInputArb, async (input) => {
        // Create fresh database for this iteration
        const { sqliteDb: testDb, db: testDbInstance, caller: testCaller } = createFreshDb();

        try {
          // Create a test domain
          const domain = await createTestDomain(testDbInstance);

          // Create task
          const created = await testCaller.create({
            ...input,
            domainId: domain.id,
          });

          // Normalize empty strings to null for comparison (database behavior)
          const normalizeEmpty = (val: string | undefined) => 
            val === '' ? null : (val ?? null);

          // Verify all fields match
          expect(created.title).toBe(input.title);
          expect(created.description).toBe(normalizeEmpty(input.description));
          expect(created.domainId).toBe(domain.id);
          expect(created.priority).toBe(input.priority);
          expect(created.estimatedMinutes).toBe(input.estimatedMinutes);
          expect(created.dueDate).toBe(input.dueDate ?? null);
          expect(created.status).toBe(TaskStatus.TODO); // Default status
          expect(created.rrule).toBe(input.rrule ?? null);
          expect(created.id).toBeTypeOf('number');
          expect(created.createdAt).toBeTypeOf('string');
          expect(created.updatedAt).toBeTypeOf('string');

          // Read back via list
          const list = await testCaller.list({});
          const found = list.find((t) => t.id === created.id);

          expect(found).toBeDefined();
          expect(found?.title).toBe(input.title);
          expect(found?.description).toBe(normalizeEmpty(input.description));
          expect(found?.priority).toBe(input.priority);
          expect(found?.estimatedMinutes).toBe(input.estimatedMinutes);
          expect(found?.status).toBe(TaskStatus.TODO);

          // Update a field and verify
          const updated = await testCaller.update({
            id: created.id,
            title: 'Updated Title',
          });

          expect(updated.title).toBe('Updated Title');
          expect(updated.priority).toBe(input.priority); // unchanged
          expect(updated.estimatedMinutes).toBe(input.estimatedMinutes); // unchanged
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
      fc.asyncProperty(validTaskInputArb, async (input) => {
        // Create fresh database for this iteration
        const { sqliteDb: testDb, db: testDbInstance, caller: testCaller } = createFreshDb();

        try {
          // Create a test domain
          const domain = await createTestDomain(testDbInstance);

          // Create task
          const created = await testCaller.create({
            ...input,
            domainId: domain.id,
          });

          // Record time before completion
          const beforeCompletion = new Date().toISOString();

          // Complete the task
          const completed = await testCaller.complete({ id: created.id });

          // Record time after completion
          const afterCompletion = new Date().toISOString();

          // (a) Verify task status is "done" with timestamp
          expect(completed.status).toBe(TaskStatus.DONE);
          expect(completed.updatedAt).toBeTypeOf('string');
          expect(completed.updatedAt >= beforeCompletion).toBe(true);
          expect(completed.updatedAt <= afterCompletion).toBe(true);

          // (b) Verify task_completion record was created
          const completions = await testDbInstance
            .select()
            .from(schema.taskCompletions)
            .where(eq(schema.taskCompletions.taskId, created.id));

          expect(completions).toHaveLength(1);
          expect(completions[0].taskId).toBe(created.id);
          expect(completions[0].domainId).toBe(domain.id);
          expect(completions[0].completedAt).toBeTypeOf('string');
          expect(completions[0].completedDate).toBeTypeOf('string');
          expect(completions[0].completedAt >= beforeCompletion).toBe(true);
          expect(completions[0].completedAt <= afterCompletion).toBe(true);

          // Verify completedDate is in YYYY-MM-DD format
          expect(completions[0].completedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
        validTaskInputArb.filter((input) => input.rrule !== undefined),
        async (input) => {
          // Create fresh database for this iteration
          const { sqliteDb: testDb, db: testDbInstance, caller: testCaller } = createFreshDb();

          try {
            // Create a test domain
            const domain = await createTestDomain(testDbInstance);

            // Create recurring task
            const created = await testCaller.create({
              ...input,
              domainId: domain.id,
            });

            // Verify the task was created with rrule
            expect(created.rrule).toBe(input.rrule);

            // Get initial task count
            const tasksBefore = await testDbInstance.select().from(schema.tasks);
            const countBefore = tasksBefore.length;

            // Complete the task
            const completed = await testCaller.complete({ id: created.id });

            // Verify the original task is marked as done
            expect(completed.status).toBe(TaskStatus.DONE);

            // Verify a new task instance was created
            const tasksAfter = await testDbInstance.select().from(schema.tasks);
            const countAfter = tasksAfter.length;

            // Debug: If count didn't increase, log the tasks
            if (countAfter !== countBefore + 1) {
              console.error('Expected new task to be created');
              console.error('Tasks before:', tasksBefore.map(t => ({ id: t.id, title: t.title, rrule: t.rrule })));
              console.error('Tasks after:', tasksAfter.map(t => ({ id: t.id, title: t.title, status: t.status, rrule: t.rrule })));
              console.error('Input rrule:', input.rrule);
            }

            expect(countAfter).toBe(countBefore + 1);

            // Find the new task instance (not the completed one)
            const newTask = tasksAfter.find(
              (t) => t.id !== created.id && t.title === created.title
            );

            expect(newTask).toBeDefined();
            expect(newTask?.status).toBe(TaskStatus.TODO);
            expect(newTask?.domainId).toBe(domain.id);
            expect(newTask?.priority).toBe(created.priority);
            expect(newTask?.estimatedMinutes).toBe(created.estimatedMinutes);
            expect(newTask?.rrule).toBe(created.rrule);
            expect(newTask?.dueDate).toBeTypeOf('string');
            expect(newTask?.dueDate).not.toBe(null);

            // Verify the new due date is in the future
            if (newTask?.dueDate) {
              const newDueDate = new Date(newTask.dueDate);
              const now = new Date();
              expect(newDueDate > now).toBe(true);
            }
          } finally {
            testDb.close();
          }
        }
      ),
      { numRuns: 100 }
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
        fc.integer().filter((n) => n < 1 || n > 480),
        async (invalidDuration) => {
          // Create fresh database for this iteration
          const { sqliteDb: testDb, db: testDbInstance, caller: testCaller } = createFreshDb();

          try {
            // Create a test domain
            const domain = await createTestDomain(testDbInstance);

            // Get initial task count
            const tasksBefore = await testDbInstance.select().from(schema.tasks);
            const countBefore = tasksBefore.length;

            // Attempt to create task with invalid duration
            await expect(
              testCaller.create({
                title: 'Test Task',
                domainId: domain.id,
                priority: TaskPriority.MUST_DO,
                estimatedMinutes: invalidDuration,
              })
            ).rejects.toThrow();

            // Verify no task was created
            const tasksAfter = await testDbInstance.select().from(schema.tasks);
            const countAfter = tasksAfter.length;

            expect(countAfter).toBe(countBefore);
          } finally {
            testDb.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
