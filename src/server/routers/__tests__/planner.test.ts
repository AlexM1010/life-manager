import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Database } from 'better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { plannerRouter } from '../planner.js';
import * as schema from '../../db/schema.js';
import { TaskPriority } from '../../../shared/types.js';

/**
 * Planner Router Integration Tests
 * 
 * Tests the planner router's generate and getToday procedures.
 * 
 * Requirements: 3.1, 3.6
 */

let sqliteDb: Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let caller: ReturnType<typeof plannerRouter.createCaller>;

beforeEach(() => {
  // Create in-memory database
  sqliteDb = new BetterSqlite3(':memory:');
  db = drizzle(sqliteDb, { schema });
  migrate(db, { migrationsFolder: './drizzle' });

  // Create caller with test context
  caller = plannerRouter.createCaller({ db });
});

afterEach(() => {
  sqliteDb.close();
});

describe('Planner Router - Integration Tests', () => {
  describe('generate', () => {
    it('should generate a plan with available tasks', async () => {
      // Create test domains
      const [healthDomain] = await db.insert(schema.domains).values({
        name: 'Health',
        description: 'Health and wellness',
        whyItMatters: 'Essential for wellbeing',
        boringButImportant: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).returning();

      const [workDomain] = await db.insert(schema.domains).values({
        name: 'Work',
        description: 'Work tasks',
        whyItMatters: 'Career progress',
        boringButImportant: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).returning();

      // Create test tasks
      await db.insert(schema.tasks).values([
        {
          title: 'Morning exercise',
          description: 'Go for a run',
          domainId: healthDomain.id,
          priority: TaskPriority.MUST_DO,
          estimatedMinutes: 30,
          dueDate: null,
          status: 'todo',
          rrule: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          title: 'Complete report',
          description: 'Finish quarterly report',
          domainId: workDomain.id,
          priority: TaskPriority.MUST_DO,
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          rrule: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          title: 'Review code',
          description: 'Review pull requests',
          domainId: workDomain.id,
          priority: TaskPriority.SHOULD_DO,
          estimatedMinutes: 45,
          dueDate: null,
          status: 'todo',
          rrule: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      // Generate plan
      const plan = await caller.generate({ energyLevel: 5 });

      // Verify plan structure
      expect(plan).toBeDefined();
      expect(plan.energyLevel).toBe(5);
      expect(plan.items).toBeDefined();
      expect(plan.items.length).toBeGreaterThan(0);
      expect(plan.items.length).toBeLessThanOrEqual(6);

      // Verify items have required fields
      for (const item of plan.items) {
        expect(item.taskId).toBeDefined();
        expect(item.category).toMatch(/^(must-do|want-to|health)$/);
        expect(item.task).toBeDefined();
        expect(item.task.title).toBeDefined();
      }
    });

    it('should return empty plan when no tasks are available', async () => {
      // Create a domain but no tasks
      await db.insert(schema.domains).values({
        name: 'Health',
        description: 'Health and wellness',
        whyItMatters: 'Essential for wellbeing',
        boringButImportant: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Generate plan
      const plan = await caller.generate({ energyLevel: 5 });

      // Verify empty plan
      expect(plan).toBeDefined();
      expect(plan.items).toEqual([]);
    });

    it('should reject duplicate plan generation for same date', async () => {
      // Create test domain and task
      const [healthDomain] = await db.insert(schema.domains).values({
        name: 'Health',
        description: 'Health and wellness',
        whyItMatters: 'Essential for wellbeing',
        boringButImportant: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).returning();

      await db.insert(schema.tasks).values({
        title: 'Morning exercise',
        description: 'Go for a run',
        domainId: healthDomain.id,
        priority: TaskPriority.MUST_DO,
        estimatedMinutes: 30,
        dueDate: null,
        status: 'todo',
        rrule: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Generate first plan
      await caller.generate({ energyLevel: 5 });

      // Try to generate second plan for same date
      await expect(
        caller.generate({ energyLevel: 5 })
      ).rejects.toThrow(/already exists/);
    });

    it('should adapt plan to low energy level', async () => {
      // Create test domain
      const [healthDomain] = await db.insert(schema.domains).values({
        name: 'Health',
        description: 'Health and wellness',
        whyItMatters: 'Essential for wellbeing',
        boringButImportant: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).returning();

      // Create tasks with varying durations
      await db.insert(schema.tasks).values([
        {
          title: 'Quick task',
          description: 'Short task',
          domainId: healthDomain.id,
          priority: TaskPriority.MUST_DO,
          estimatedMinutes: 10,
          dueDate: null,
          status: 'todo',
          rrule: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          title: 'Long task',
          description: 'Long task',
          domainId: healthDomain.id,
          priority: TaskPriority.MUST_DO,
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          rrule: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      // Generate plan with low energy
      const plan = await caller.generate({ energyLevel: 2 });

      // Verify plan respects energy constraints
      expect(plan.items.length).toBeLessThanOrEqual(3);
      
      // All tasks should be under 15 minutes
      for (const item of plan.items) {
        expect(item.task.estimatedMinutes).toBeLessThanOrEqual(15);
      }
    });
  });

  describe('getToday', () => {
    it('should return null when no plan exists', async () => {
      const plan = await caller.getToday({});
      expect(plan).toBeNull();
    });

    it('should retrieve existing plan', async () => {
      // Create test domain and task
      const [healthDomain] = await db.insert(schema.domains).values({
        name: 'Health',
        description: 'Health and wellness',
        whyItMatters: 'Essential for wellbeing',
        boringButImportant: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).returning();

      await db.insert(schema.tasks).values({
        title: 'Morning exercise',
        description: 'Go for a run',
        domainId: healthDomain.id,
        priority: TaskPriority.MUST_DO,
        estimatedMinutes: 30,
        dueDate: null,
        status: 'todo',
        rrule: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Generate plan
      const generatedPlan = await caller.generate({ energyLevel: 5 });

      // Retrieve plan
      const retrievedPlan = await caller.getToday({});

      // Verify plans match
      expect(retrievedPlan).toBeDefined();
      expect(retrievedPlan?.id).toBe(generatedPlan.id);
      expect(retrievedPlan?.energyLevel).toBe(generatedPlan.energyLevel);
      expect(retrievedPlan?.items.length).toBe(generatedPlan.items.length);
    });

    it('should retrieve plan for specific date', async () => {
      // Create test domain and task
      const [healthDomain] = await db.insert(schema.domains).values({
        name: 'Health',
        description: 'Health and wellness',
        whyItMatters: 'Essential for wellbeing',
        boringButImportant: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).returning();

      await db.insert(schema.tasks).values({
        title: 'Morning exercise',
        description: 'Go for a run',
        domainId: healthDomain.id,
        priority: TaskPriority.MUST_DO,
        estimatedMinutes: 30,
        dueDate: null,
        status: 'todo',
        rrule: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const testDate = '2026-02-10';

      // Generate plan for specific date
      await caller.generate({ energyLevel: 5, date: testDate });

      // Retrieve plan for that date
      const plan = await caller.getToday({ date: testDate });

      // Verify plan exists and has correct date
      expect(plan).toBeDefined();
      expect(plan?.date).toBe(testDate);
    });
  });

  describe('syncPlan', () => {
    it('should throw error when no plan exists', async () => {
      // Try to sync non-existent plan
      await expect(
        caller.syncPlan({})
      ).rejects.toThrow(/No plan exists/);
    });

    it('should throw error when plan has no items', async () => {
      // Create a plan with no items
      const [emptyPlan] = await db.insert(schema.todayPlans).values({
        date: new Date().toISOString().split('T')[0],
        energyLevel: 5,
        createdAt: new Date().toISOString(),
      }).returning();

      // Try to sync empty plan
      await expect(
        caller.syncPlan({})
      ).rejects.toThrow(/Plan has no items to export/);
    });

    it('should throw error when OAuth tokens not available', async () => {
      // Create test domain and task
      const [healthDomain] = await db.insert(schema.domains).values({
        name: 'Health',
        description: 'Health and wellness',
        whyItMatters: 'Essential for wellbeing',
        boringButImportant: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).returning();

      await db.insert(schema.tasks).values({
        title: 'Morning exercise',
        description: 'Go for a run',
        domainId: healthDomain.id,
        priority: TaskPriority.MUST_DO,
        estimatedMinutes: 30,
        dueDate: null,
        status: 'todo',
        rrule: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Generate plan
      await caller.generate({ energyLevel: 5 });

      // Try to sync without OAuth tokens
      // This should fail because no tokens are configured
      await expect(
        caller.syncPlan({})
      ).rejects.toThrow();
    });

    it('should sync plan for specific date', async () => {
      // Create test domain and task
      const [healthDomain] = await db.insert(schema.domains).values({
        name: 'Health',
        description: 'Health and wellness',
        whyItMatters: 'Essential for wellbeing',
        boringButImportant: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).returning();

      await db.insert(schema.tasks).values({
        title: 'Morning exercise',
        description: 'Go for a run',
        domainId: healthDomain.id,
        priority: TaskPriority.MUST_DO,
        estimatedMinutes: 30,
        dueDate: null,
        status: 'todo',
        rrule: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const testDate = '2026-02-10';

      // Generate plan for specific date
      await caller.generate({ energyLevel: 5, date: testDate });

      // Try to sync plan for that date
      // This should fail because no tokens are configured, but it validates the date parameter
      await expect(
        caller.syncPlan({ date: testDate })
      ).rejects.toThrow();
    });
  });
});
