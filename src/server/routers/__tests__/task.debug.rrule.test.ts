import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { taskRouter } from '../task.js';
import * as schema from '../../db/schema.js';
import { TaskPriority } from '../../../shared/types.js';
import { RRule } from 'rrule';

/**
 * Debug test for RRule functionality
 */

let sqliteDb: Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let caller: ReturnType<typeof taskRouter.createCaller>;

beforeEach(() => {
  sqliteDb = new BetterSqlite3(':memory:');
  db = drizzle(sqliteDb, { schema });
  migrate(db, { migrationsFolder: './drizzle' });
  caller = taskRouter.createCaller({ db });
});

afterEach(() => {
  sqliteDb.close();
});

describe('RRule Debug Tests', () => {
  it('should parse FREQ=DAILY correctly', () => {
    const rruleString = 'RRULE:FREQ=DAILY';
    const rule = RRule.fromString(rruleString);
    const nextOccurrence = rule.after(new Date(), false);
    console.log('Next occurrence:', nextOccurrence);
    expect(nextOccurrence).toBeDefined();
  });

  it('should create next instance for FREQ=DAILY', async () => {
    // Create a test domain
    const now = new Date().toISOString();
    const [domain] = await db
      .insert(schema.domains)
      .values({
        name: 'Test Domain',
        description: 'Test description',
        whyItMatters: 'Test reason',
        boringButImportant: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Create recurring task
    const created = await caller.create({
      title: 'Daily Task',
      domainId: domain.id,
      priority: TaskPriority.MUST_DO,
      estimatedMinutes: 15,
      rrule: 'FREQ=DAILY',
    });

    console.log('Created task:', created);

    // Get initial task count
    const tasksBefore = await db.select().from(schema.tasks);
    console.log('Tasks before completion:', tasksBefore);

    // Complete the task
    const completed = await caller.complete({ id: created.id });
    console.log('Completed task:', completed);

    // Get tasks after completion
    const tasksAfter = await db.select().from(schema.tasks);
    console.log('Tasks after completion:', tasksAfter);

    // Should have 2 tasks now (original marked done + new instance)
    expect(tasksAfter).toHaveLength(2);

    // Find the new task
    const newTask = tasksAfter.find((t) => t.id !== created.id);
    expect(newTask).toBeDefined();
    expect(newTask?.status).toBe('todo');
    expect(newTask?.rrule).toBe('FREQ=DAILY');
  });
});
