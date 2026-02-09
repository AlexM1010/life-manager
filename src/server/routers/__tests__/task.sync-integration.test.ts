/**
 * Task Router - Sync Integration Tests
 * 
 * Tests that task mutations trigger Google sync operations correctly.
 * 
 * Requirements: 4.1, 4.5, 5.1, 5.6, 6.1, 6.6
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../../db/index.js';
import { tasks, domains, taskSyncMetadata, taskCompletions, snoozeLogs, todayPlanItems, oauthTokens } from '../../db/schema.js';
import { taskRouter } from '../task.js';
import { TaskStatus } from '../../../shared/types.js';
import { eq } from 'drizzle-orm';

// Mock the sync engine and oauth manager
const mockExportNewTask = vi.fn().mockResolvedValue(undefined);
const mockExportTaskModification = vi.fn().mockResolvedValue(undefined);
const mockExportTaskCompletion = vi.fn().mockResolvedValue(undefined);

vi.mock('../../services/sync-engine.js', () => {
  return {
    SyncEngine: vi.fn().mockImplementation(() => ({
      exportNewTask: mockExportNewTask,
      exportTaskModification: mockExportTaskModification,
      exportTaskCompletion: mockExportTaskCompletion,
    })),
  };
});

vi.mock('../../services/oauth-manager.js', () => ({
  OAuthManager: vi.fn().mockImplementation(() => ({
    getOAuth2Client: vi.fn().mockResolvedValue({}),
  })),
}));

describe('Task Router - Sync Integration', () => {
  let testDomainId: number;
  let caller: any;
  let uniqueDomainName: string;

  beforeEach(async () => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    mockExportNewTask.mockResolvedValue(undefined);
    mockExportTaskModification.mockResolvedValue(undefined);
    mockExportTaskCompletion.mockResolvedValue(undefined);

    // Set up environment variables for OAuth (required for triggerSync to proceed)
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:5173/auth/google/callback';

    // Use unique domain name per test to avoid UNIQUE constraint violations
    uniqueDomainName = 'Test Domain ' + Math.random().toString(36).slice(2, 10);

    // Create test domain
    const [domain] = await db
      .insert(domains)
      .values({
        name: uniqueDomainName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning();
    testDomainId = domain.id;

    // Create caller with context
    caller = taskRouter.createCaller({ db });
  });

  afterEach(async () => {
    // Clean up test data in correct order (respect foreign keys)
    await db.delete(todayPlanItems);
    await db.delete(taskCompletions);
    await db.delete(snoozeLogs);
    await db.delete(taskSyncMetadata);
    await db.delete(tasks);
    await db.delete(oauthTokens);
    await db.delete(domains);
  });

  describe('Task Creation Sync', () => {
    it('should trigger exportNewTask when creating a task', async () => {
      const task = await caller.create({
        title: 'Test Task',
        description: 'Test Description',
        domainId: testDomainId,
        priority: 'should-do',
        estimatedMinutes: 30,
      });

      // Wait for async sync to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockExportNewTask).toHaveBeenCalledWith(task.id);
      expect(mockExportNewTask).toHaveBeenCalledTimes(1);
    });

    it('should not fail task creation if sync fails', async () => {
      mockExportNewTask.mockRejectedValueOnce(new Error('Sync failed'));

      const task = await caller.create({
        title: 'Test Task',
        description: 'Test Description',
        domainId: testDomainId,
        priority: 'should-do',
        estimatedMinutes: 30,
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(task).toBeDefined();
      expect(task.title).toBe('Test Task');

      const [dbTask] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, task.id));
      expect(dbTask).toBeDefined();
    });

    it('should sync within 5 seconds of task creation', async () => {
      const startTime = Date.now();

      const task = await caller.create({
        title: 'Test Task',
        description: 'Test Description',
        domainId: testDomainId,
        priority: 'should-do',
        estimatedMinutes: 30,
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const syncTime = Date.now() - startTime;
      expect(mockExportNewTask).toHaveBeenCalledWith(task.id);
      expect(syncTime).toBeLessThan(5000);
    });
  });

  describe('Task Update Sync', () => {
    it('should trigger exportTaskModification when updating a task', async () => {
      const task = await caller.create({
        title: 'Test Task',
        description: 'Test Description',
        domainId: testDomainId,
        priority: 'should-do',
        estimatedMinutes: 30,
      });

      vi.clearAllMocks();

      await caller.update({
        id: task.id,
        title: 'Updated Task',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockExportTaskModification).toHaveBeenCalledWith(task.id);
      expect(mockExportTaskModification).toHaveBeenCalledTimes(1);
    });

    it('should not fail task update if sync fails', async () => {
      const task = await caller.create({
        title: 'Test Task',
        description: 'Test Description',
        domainId: testDomainId,
        priority: 'should-do',
        estimatedMinutes: 30,
      });

      mockExportTaskModification.mockRejectedValueOnce(new Error('Sync failed'));

      const updatedTask = await caller.update({
        id: task.id,
        title: 'Updated Task',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(updatedTask).toBeDefined();
      expect(updatedTask.title).toBe('Updated Task');

      const [dbTask] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, task.id));
      expect(dbTask.title).toBe('Updated Task');
    });

    it('should sync within 5 seconds of task update', async () => {
      const task = await caller.create({
        title: 'Test Task',
        description: 'Test Description',
        domainId: testDomainId,
        priority: 'should-do',
        estimatedMinutes: 30,
      });

      vi.clearAllMocks();

      const startTime = Date.now();

      await caller.update({
        id: task.id,
        title: 'Updated Task',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const syncTime = Date.now() - startTime;
      expect(mockExportTaskModification).toHaveBeenCalledWith(task.id);
      expect(syncTime).toBeLessThan(5000);
    });
  });

  describe('Task Completion Sync', () => {
    it('should trigger exportTaskCompletion when completing a task', async () => {
      const task = await caller.create({
        title: 'Test Task',
        description: 'Test Description',
        domainId: testDomainId,
        priority: 'should-do',
        estimatedMinutes: 30,
      });

      vi.clearAllMocks();

      await caller.complete({
        id: task.id,
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockExportTaskCompletion).toHaveBeenCalledWith(task.id);
      expect(mockExportTaskCompletion).toHaveBeenCalledTimes(1);
    });

    it('should not fail task completion if sync fails', async () => {
      const task = await caller.create({
        title: 'Test Task',
        description: 'Test Description',
        domainId: testDomainId,
        priority: 'should-do',
        estimatedMinutes: 30,
      });

      mockExportTaskCompletion.mockRejectedValueOnce(new Error('Sync failed'));

      const completedTask = await caller.complete({
        id: task.id,
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(completedTask).toBeDefined();
      expect(completedTask.status).toBe(TaskStatus.DONE);

      const [dbTask] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, task.id));
      expect(dbTask.status).toBe(TaskStatus.DONE);
    });

    it('should sync within 5 seconds of task completion', async () => {
      const task = await caller.create({
        title: 'Test Task',
        description: 'Test Description',
        domainId: testDomainId,
        priority: 'should-do',
        estimatedMinutes: 30,
      });

      vi.clearAllMocks();

      const startTime = Date.now();

      await caller.complete({
        id: task.id,
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const syncTime = Date.now() - startTime;
      expect(mockExportTaskCompletion).toHaveBeenCalledWith(task.id);
      expect(syncTime).toBeLessThan(5000);
    });
  });

  describe('Sync Resilience', () => {
    it('should handle sync when OAuth is not configured', async () => {
      const task = await caller.create({
        title: 'Test Task',
        description: 'Test Description',
        domainId: testDomainId,
        priority: 'should-do',
        estimatedMinutes: 30,
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Task should be created successfully regardless of sync
      expect(task).toBeDefined();
      expect(task.title).toBe('Test Task');
    });

    it('should handle multiple rapid task operations', async () => {
      const createdTasks = await Promise.all([
        caller.create({
          title: 'Task 1',
          domainId: testDomainId,
          priority: 'should-do',
          estimatedMinutes: 30,
        }),
        caller.create({
          title: 'Task 2',
          domainId: testDomainId,
          priority: 'should-do',
          estimatedMinutes: 30,
        }),
        caller.create({
          title: 'Task 3',
          domainId: testDomainId,
          priority: 'should-do',
          estimatedMinutes: 30,
        }),
      ]);

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(mockExportNewTask).toHaveBeenCalledTimes(3);
      expect(mockExportNewTask).toHaveBeenCalledWith(createdTasks[0].id);
      expect(mockExportNewTask).toHaveBeenCalledWith(createdTasks[1].id);
      expect(mockExportNewTask).toHaveBeenCalledWith(createdTasks[2].id);
    });
  });
});
