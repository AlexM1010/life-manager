import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { taskRouter } from '../task.js';
import * as schema from '../../db/schema.js';

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

describe('Debug recurring task', () => {
  it('should create next instance for FREQ=DAILY', async () => {
    // Create domain
    const now = new Date().toISOString();
    const [domain] = await db
      .insert(schema.domains)
      .values({
        name: 'Test',
        description: '',
        whyItMatters: '',
        boringButImportant: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Create recurring task
    const created = await caller.create({
      title: 'Daily Task',
      domainId: domain.id,
      priority: 'must-do',
      estimatedMinutes: 30,
      rrule: 'FREQ=DAILY',
    });

    console.log('Created task:', created);

    // Complete the task
    const completed = await caller.complete({ id: created.id });

    console.log('Completed task:', completed);

    // Check all tasks
    const allTasks = await db.select().from(schema.tasks);
    console.log('All tasks after completion:', allTasks);

    expect(allTasks.length).toBe(2);
  });
});
