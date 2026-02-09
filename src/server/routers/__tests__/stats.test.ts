import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { statsRouter } from '../stats.js';
import * as schema from '../../db/schema.js';

/**
 * Stats Router Tests
 * 
 * Integration tests for stats endpoints:
 * - streaks: Calculate medication, health task, and BBI streaks
 * - balance: Calculate domain balance and identify neglected domains
 * 
 * Validates Requirements: 6.1, 6.4
 */

// Test database setup
let sqliteDb: Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let caller: ReturnType<typeof statsRouter.createCaller>;

beforeEach(() => {
  // Create in-memory database for each test
  sqliteDb = new BetterSqlite3(':memory:');
  db = drizzle(sqliteDb, { schema });

  // Run migrations
  migrate(db, { migrationsFolder: './drizzle' });

  // Create caller with test context
  caller = statsRouter.createCaller({ db });
});

afterEach(() => {
  sqliteDb.close();
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a test domain
 */
async function createDomain(data: {
  name: string;
  boringButImportant?: boolean;
  description?: string;
}) {
  const now = new Date().toISOString();
  const [domain] = await db
    .insert(schema.domains)
    .values({
      name: data.name,
      description: data.description || '',
      whyItMatters: '',
      boringButImportant: data.boringButImportant || false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return domain;
}

/**
 * Create a test task
 */
async function createTask(data: { title: string; domainId: number }) {
  const now = new Date().toISOString();
  const [task] = await db
    .insert(schema.tasks)
    .values({
      title: data.title,
      domainId: data.domainId,
      priority: 'must-do',
      estimatedMinutes: 30,
      status: 'todo',
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return task;
}

/**
 * Create a daily log
 */
async function createDailyLog(data: {
  date: string;
  medicationTaken: 'yes' | 'no';
  energy?: number;
  mood?: number;
}) {
  const now = new Date().toISOString();
  const [log] = await db
    .insert(schema.dailyLogs)
    .values({
      date: data.date,
      hoursSlept: 7,
      energy: data.energy || 5,
      mood: data.mood || 5,
      medicationTaken: data.medicationTaken,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return log;
}

/**
 * Create a task completion
 */
async function createTaskCompletion(data: {
  taskId: number;
  domainId: number;
  completedDate: string;
}) {
  const completedAt = new Date(data.completedDate + 'T12:00:00Z').toISOString();
  const [completion] = await db
    .insert(schema.taskCompletions)
    .values({
      taskId: data.taskId,
      domainId: data.domainId,
      completedAt,
      completedDate: data.completedDate,
    })
    .returning();
  return completion;
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get date N days ago in YYYY-MM-DD format
 */
function getDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

// ============================================================================
// Streaks Tests
// ============================================================================

describe('Stats Router - Streaks', () => {
  it('should return zero streaks when no data exists', async () => {
    const result = await caller.streaks();

    expect(result).toEqual({
      medication: 0,
      healthTask: 0,
      boringButImportant: 0,
    });
  });

  it('should calculate medication streak correctly', async () => {
    // Create logs for consecutive days with medication taken
    await createDailyLog({ date: getDaysAgo(2), medicationTaken: 'yes' });
    await createDailyLog({ date: getDaysAgo(1), medicationTaken: 'yes' });
    await createDailyLog({ date: getTodayDate(), medicationTaken: 'yes' });

    const result = await caller.streaks();

    expect(result.medication).toBe(3);
  });

  it('should break medication streak when medication not taken', async () => {
    // Create logs with a gap in medication
    await createDailyLog({ date: getDaysAgo(3), medicationTaken: 'yes' });
    await createDailyLog({ date: getDaysAgo(2), medicationTaken: 'no' }); // Break
    await createDailyLog({ date: getDaysAgo(1), medicationTaken: 'yes' });
    await createDailyLog({ date: getTodayDate(), medicationTaken: 'yes' });

    const result = await caller.streaks();

    // Streak should be 2 (today and yesterday)
    expect(result.medication).toBe(2);
  });

  it('should calculate health task streak correctly', async () => {
    // Create health domain and tasks
    const healthDomain = await createDomain({ name: 'Health', boringButImportant: false });
    const task1 = await createTask({ title: 'Exercise', domainId: healthDomain.id });

    // Create completions for consecutive days
    await createTaskCompletion({
      taskId: task1.id,
      domainId: healthDomain.id,
      completedDate: getDaysAgo(2),
    });
    await createTaskCompletion({
      taskId: task1.id,
      domainId: healthDomain.id,
      completedDate: getDaysAgo(1),
    });
    await createTaskCompletion({
      taskId: task1.id,
      domainId: healthDomain.id,
      completedDate: getTodayDate(),
    });

    const result = await caller.streaks();

    expect(result.healthTask).toBe(3);
  });

  it('should calculate BBI streak correctly', async () => {
    // Create BBI domain and tasks
    const bbiDomain = await createDomain({ name: 'Admin', boringButImportant: true });
    const task1 = await createTask({ title: 'Pay bills', domainId: bbiDomain.id });

    // Create completions for consecutive days
    await createTaskCompletion({
      taskId: task1.id,
      domainId: bbiDomain.id,
      completedDate: getDaysAgo(1),
    });
    await createTaskCompletion({
      taskId: task1.id,
      domainId: bbiDomain.id,
      completedDate: getTodayDate(),
    });

    const result = await caller.streaks();

    expect(result.boringButImportant).toBe(2);
  });

  it('should handle multiple streak types simultaneously', async () => {
    // Create domains
    const healthDomain = await createDomain({ name: 'Health', boringButImportant: false });
    const bbiDomain = await createDomain({ name: 'Admin', boringButImportant: true });

    // Create tasks
    const healthTask = await createTask({ title: 'Exercise', domainId: healthDomain.id });
    const bbiTask = await createTask({ title: 'Pay bills', domainId: bbiDomain.id });

    // Create daily logs with medication
    await createDailyLog({ date: getDaysAgo(1), medicationTaken: 'yes' });
    await createDailyLog({ date: getTodayDate(), medicationTaken: 'yes' });

    // Create task completions
    await createTaskCompletion({
      taskId: healthTask.id,
      domainId: healthDomain.id,
      completedDate: getDaysAgo(1),
    });
    await createTaskCompletion({
      taskId: healthTask.id,
      domainId: healthDomain.id,
      completedDate: getTodayDate(),
    });
    await createTaskCompletion({
      taskId: bbiTask.id,
      domainId: bbiDomain.id,
      completedDate: getTodayDate(),
    });

    const result = await caller.streaks();

    expect(result.medication).toBe(2);
    expect(result.healthTask).toBe(2);
    expect(result.boringButImportant).toBe(1); // Only today
  });
});

// ============================================================================
// Balance Tests
// ============================================================================

describe('Stats Router - Balance', () => {
  it('should return empty array when no domains exist', async () => {
    const result = await caller.balance({ days: 7 });

    expect(result).toEqual([]);
  });

  it('should return all domains with zero completions when no tasks completed', async () => {
    // Create domains
    await createDomain({ name: 'Health' });
    await createDomain({ name: 'Admin' });

    const result = await caller.balance({ days: 7 });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      completions7d: 0,
      neglected: true,
    });
    expect(result[1]).toMatchObject({
      completions7d: 0,
      neglected: true,
    });
  });

  it('should count completions per domain correctly', async () => {
    // Create domains
    const healthDomain = await createDomain({ name: 'Health' });
    const adminDomain = await createDomain({ name: 'Admin' });

    // Create tasks
    const healthTask = await createTask({ title: 'Exercise', domainId: healthDomain.id });
    const adminTask = await createTask({ title: 'Pay bills', domainId: adminDomain.id });

    // Create completions (within last 7 days)
    await createTaskCompletion({
      taskId: healthTask.id,
      domainId: healthDomain.id,
      completedDate: getDaysAgo(1),
    });
    await createTaskCompletion({
      taskId: healthTask.id,
      domainId: healthDomain.id,
      completedDate: getDaysAgo(2),
    });
    await createTaskCompletion({
      taskId: adminTask.id,
      domainId: adminDomain.id,
      completedDate: getTodayDate(),
    });

    const result = await caller.balance({ days: 7 });

    const healthBalance = result.find((b) => b.name === 'Health');
    const adminBalance = result.find((b) => b.name === 'Admin');

    expect(healthBalance?.completions7d).toBe(2);
    expect(healthBalance?.neglected).toBe(false);
    expect(adminBalance?.completions7d).toBe(1);
    expect(adminBalance?.neglected).toBe(false);
  });

  it('should flag domains with zero completions as neglected', async () => {
    // Create domains
    const healthDomain = await createDomain({ name: 'Health' });
    await createDomain({ name: 'Admin' }); // Created but not used directly

    // Create task and completion only for health domain
    const healthTask = await createTask({ title: 'Exercise', domainId: healthDomain.id });
    await createTaskCompletion({
      taskId: healthTask.id,
      domainId: healthDomain.id,
      completedDate: getTodayDate(),
    });

    const result = await caller.balance({ days: 7 });

    const healthBalance = result.find((b) => b.name === 'Health');
    const adminBalance = result.find((b) => b.name === 'Admin');

    expect(healthBalance?.neglected).toBe(false);
    expect(adminBalance?.neglected).toBe(true);
  });

  it('should only count completions within the specified time window', async () => {
    // Create domain and task
    const healthDomain = await createDomain({ name: 'Health' });
    const healthTask = await createTask({ title: 'Exercise', domainId: healthDomain.id });

    // Create completions: some within window, some outside
    await createTaskCompletion({
      taskId: healthTask.id,
      domainId: healthDomain.id,
      completedDate: getDaysAgo(10), // Outside 7-day window
    });
    await createTaskCompletion({
      taskId: healthTask.id,
      domainId: healthDomain.id,
      completedDate: getDaysAgo(5), // Within window
    });
    await createTaskCompletion({
      taskId: healthTask.id,
      domainId: healthDomain.id,
      completedDate: getTodayDate(), // Within window
    });

    const result = await caller.balance({ days: 7 });

    const healthBalance = result.find((b) => b.name === 'Health');
    expect(healthBalance?.completions7d).toBe(2); // Only the 2 within window
  });

  it('should respect custom days parameter', async () => {
    // Create domain and task
    const healthDomain = await createDomain({ name: 'Health' });
    const healthTask = await createTask({ title: 'Exercise', domainId: healthDomain.id });

    // Create completions at different times
    await createTaskCompletion({
      taskId: healthTask.id,
      domainId: healthDomain.id,
      completedDate: getDaysAgo(5),
    });
    await createTaskCompletion({
      taskId: healthTask.id,
      domainId: healthDomain.id,
      completedDate: getDaysAgo(2),
    });
    await createTaskCompletion({
      taskId: healthTask.id,
      domainId: healthDomain.id,
      completedDate: getTodayDate(),
    });

    // Query with 3-day window
    const result = await caller.balance({ days: 3 });

    const healthBalance = result.find((b) => b.name === 'Health');
    expect(healthBalance?.completions7d).toBe(2); // Only last 3 days (today and 2 days ago)
  });

  it('should include domain metadata in response', async () => {
    // Create domain
    const healthDomain = await createDomain({
      name: 'Health',
      description: 'Physical and mental wellbeing',
      boringButImportant: false,
    });

    const result = await caller.balance({ days: 7 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      domainId: healthDomain.id,
      name: 'Health',
      completions7d: 0,
      neglected: true,
    });
  });
});

// ============================================================================
// Guardrails Tests
// ============================================================================

describe('Stats Router - Guardrails', () => {
  it('should return no triggers when no data exists', async () => {
    const result = await caller.guardrails();

    expect(result.shouldSuggestDoctor).toBe(false);
    expect(result.shouldSuggestSupport).toBe(false);
    expect(result.messages).toHaveLength(0);
  });

  it('should trigger doctor suggestion with 3 consecutive low mood days', async () => {
    // Create 3 consecutive days with low mood
    for (let i = 0; i < 3; i++) {
      await createDailyLog({
        date: getDaysAgo(2 - i), // 2 days ago, 1 day ago, today
        medicationTaken: 'yes',
        energy: 5,
        mood: 2, // Low mood
      });
    }

    const result = await caller.guardrails();

    expect(result.shouldSuggestDoctor).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0]).toContain('doctor or care team');
  });

  it('should trigger doctor suggestion with 3 consecutive low energy days', async () => {
    // Create 3 consecutive days with low energy
    for (let i = 0; i < 3; i++) {
      await createDailyLog({
        date: getDaysAgo(2 - i),
        medicationTaken: 'yes',
        energy: 2, // Low energy
        mood: 5,
      });
    }

    const result = await caller.guardrails();

    expect(result.shouldSuggestDoctor).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('should not trigger with only 2 consecutive low days', async () => {
    // Create only 2 consecutive days with low mood
    for (let i = 0; i < 2; i++) {
      await createDailyLog({
        date: getDaysAgo(1 - i),
        medicationTaken: 'yes',
        energy: 5,
        mood: 2,
      });
    }

    const result = await caller.guardrails();

    expect(result.shouldSuggestDoctor).toBe(false);
  });
});
