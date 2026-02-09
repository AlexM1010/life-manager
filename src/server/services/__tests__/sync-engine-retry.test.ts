/**
 * Unit Tests: Sync Engine - Retry Queue and Error Handling
 * 
 * Tests retry logic, error handling, and operation queueing for the sync engine.
 * 
 * Requirements: 4.3, 5.4, 6.4, 9.2, 9.3, 9.4, 10.5, 11.1, 11.2, 11.3, 11.4, 11.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../db/schema.js';
import { SyncEngine } from '../sync-engine.js';
import { AbortError } from 'p-retry';

// Mock the Google API clients
vi.mock('../google-calendar-client.js');
vi.mock('../google-tasks-client.js');
vi.mock('../oauth-manager.js');

describe('SyncEngine - Retry Queue and Error Handling', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let sqlite: Database.Database;
  let syncEngine: SyncEngine;
  let mockOAuthManager: any;
  let mockCalendarClient: any;
  let mockTasksClient: any;

  beforeEach(async () => {
    // Create in-memory database
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema });

    // Run migrations
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS domains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        why_it_matters TEXT NOT NULL DEFAULT '',
        boring_but_important INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        domain_id INTEGER NOT NULL,
        priority TEXT NOT NULL,
        estimated_minutes INTEGER NOT NULL,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        rrule TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (domain_id) REFERENCES domains(id)
      );

      CREATE TABLE IF NOT EXISTS oauth_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        provider TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        scope TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, provider)
      );

      CREATE TABLE IF NOT EXISTS task_sync_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL UNIQUE,
        google_task_id TEXT,
        google_event_id TEXT,
        is_fixed INTEGER NOT NULL DEFAULT 0,
        last_sync_time TEXT,
        sync_status TEXT NOT NULL,
        sync_error TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        operation TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        operation TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        status TEXT NOT NULL,
        details TEXT,
        timestamp TEXT NOT NULL
      );
    `);

    // Insert test domain
    const now = new Date().toISOString();
    sqlite.exec(`
      INSERT INTO domains (name, description, why_it_matters, created_at, updated_at)
      VALUES ('Test Domain', 'Test', 'Test', '${now}', '${now}');
    `);

    // Create mock OAuth manager
    mockOAuthManager = {
      getOAuth2Client: vi.fn().mockResolvedValue({}),
    };

    // Create mock clients
    mockCalendarClient = {
      getTodayEvents: vi.fn().mockResolvedValue([]),
      createEvent: vi.fn().mockResolvedValue('mock-event-id'),
      updateEvent: vi.fn().mockResolvedValue(undefined),
    };

    mockTasksClient = {
      getTodayTasks: vi.fn().mockResolvedValue([]),
      createTask: vi.fn().mockResolvedValue('mock-task-id'),
      updateTask: vi.fn().mockResolvedValue(undefined),
      completeTask: vi.fn().mockResolvedValue(undefined),
    };

    // Create sync engine with mocked dependencies and fast retry options for testing
    syncEngine = new SyncEngine(db, mockOAuthManager as any, 1, 1, {
      retries: 2, // Fewer retries for faster tests
      minTimeout: 10, // 10ms instead of 1s
      maxTimeout: 100, // 100ms instead of 60s
    });
    (syncEngine as any).calendarClient = mockCalendarClient;
    (syncEngine as any).tasksClient = mockTasksClient;
  });

  afterEach(() => {
    sqlite.close();
    vi.clearAllMocks();
  });

  describe('Error Classification', () => {
    it('should identify non-retryable errors (404, 401, 403, 400)', async () => {
      const now = new Date().toISOString();
      
      // Create a task
      const [task] = await db.insert(schema.tasks).values({
        title: 'Test Task',
        description: 'Test',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Create sync metadata
      await db.insert(schema.taskSyncMetadata).values({
        taskId: task.id,
        googleTaskId: 'test-google-task-id',
        isFixed: false,
        syncStatus: 'synced',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      // Mock the tasks client to throw a 404 error
      const mockError = new Error('Not found');
      (mockError as any).response = { status: 404 };
      
      mockTasksClient.completeTask.mockRejectedValue(mockError);

      // Attempt to complete task - should throw without retrying
      try {
        await syncEngine.exportTaskCompletion(task.id);
        expect.fail('Should have thrown an error');
      } catch (error) {
        // Error should be thrown (either AbortError or wrapped)
        expect(error).toBeTruthy();
      }

      // Check that operation was NOT queued (non-retryable)
      const queuedOps = await db.select().from(schema.syncQueue);
      expect(queuedOps.length).toBe(0);
    }, 10000); // 10 second timeout

    it('should identify rate limit errors (429)', async () => {
      const now = new Date().toISOString();
      
      // Create a task
      const [task] = await db.insert(schema.tasks).values({
        title: 'Test Task',
        description: 'Test',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Create sync metadata
      await db.insert(schema.taskSyncMetadata).values({
        taskId: task.id,
        googleTaskId: 'test-google-task-id',
        isFixed: false,
        syncStatus: 'synced',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      // Mock the tasks client to throw a 429 error
      const mockError = new Error('Rate limit exceeded');
      (mockError as any).response = { status: 429 };
      
      mockTasksClient.completeTask.mockRejectedValue(mockError);

      // Attempt to complete task - should retry and eventually fail
      await expect(syncEngine.exportTaskCompletion(task.id)).rejects.toThrow();

      // Check that operation was queued for retry
      const queuedOps = await db.select().from(schema.syncQueue);
      expect(queuedOps.length).toBe(1);
      expect(queuedOps[0].operation).toBe('complete');
      expect(queuedOps[0].status).toBe('pending');
    });

    it('should identify network errors', async () => {
      const now = new Date().toISOString();
      
      // Create a task
      const [task] = await db.insert(schema.tasks).values({
        title: 'Test Task',
        description: 'Test',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Create sync metadata
      await db.insert(schema.taskSyncMetadata).values({
        taskId: task.id,
        googleTaskId: 'test-google-task-id',
        isFixed: false,
        syncStatus: 'synced',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      // Mock the tasks client to throw a network error
      const mockError = new Error('Network timeout');
      (mockError as any).code = 'ETIMEDOUT';
      
      mockTasksClient.completeTask.mockRejectedValue(mockError);

      // Attempt to complete task - should retry and eventually fail
      await expect(syncEngine.exportTaskCompletion(task.id)).rejects.toThrow();

      // Check that operation was queued for retry
      const queuedOps = await db.select().from(schema.syncQueue);
      expect(queuedOps.length).toBe(1);
      expect(queuedOps[0].operation).toBe('complete');
      expect(queuedOps[0].status).toBe('pending');
    });
  });

  describe('Operation Queueing', () => {
    it('should queue failed task completion for retry', async () => {
      const now = new Date().toISOString();
      
      // Create a task
      const [task] = await db.insert(schema.tasks).values({
        title: 'Test Task',
        description: 'Test',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Create sync metadata
      await db.insert(schema.taskSyncMetadata).values({
        taskId: task.id,
        googleTaskId: 'test-google-task-id',
        isFixed: false,
        syncStatus: 'synced',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      // Mock the tasks client to throw a retryable error
      const mockError = new Error('Server error');
      (mockError as any).response = { status: 500 };
      
      mockTasksClient.completeTask.mockRejectedValue(mockError);

      // Attempt to complete task
      await expect(syncEngine.exportTaskCompletion(task.id)).rejects.toThrow();

      // Check that operation was queued
      const queuedOps = await db.select().from(schema.syncQueue);
      expect(queuedOps.length).toBe(1);
      expect(queuedOps[0].operation).toBe('complete');
      expect(queuedOps[0].entityType).toBe('task');
      expect(queuedOps[0].entityId).toBe(task.id);
      expect(queuedOps[0].status).toBe('pending');
      expect(queuedOps[0].retryCount).toBe(0);
      expect(queuedOps[0].nextRetryAt).toBeTruthy();
    });

    it('should queue failed new task creation for retry', async () => {
      const now = new Date().toISOString();
      
      // Create a task
      const [task] = await db.insert(schema.tasks).values({
        title: 'Test Task',
        description: 'Test',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Mock the tasks client to throw a retryable error
      const mockError = new Error('Server error');
      (mockError as any).response = { status: 503 };
      
      mockTasksClient.createTask.mockRejectedValue(mockError);

      // Attempt to create task
      await expect(syncEngine.exportNewTask(task.id)).rejects.toThrow();

      // Check that operation was queued
      const queuedOps = await db.select().from(schema.syncQueue);
      expect(queuedOps.length).toBe(1);
      expect(queuedOps[0].operation).toBe('create');
      expect(queuedOps[0].entityType).toBe('task');
      expect(queuedOps[0].entityId).toBe(task.id);
      expect(queuedOps[0].status).toBe('pending');
    });

    it('should queue failed task modification for retry', async () => {
      const now = new Date().toISOString();
      
      // Create a task
      const [task] = await db.insert(schema.tasks).values({
        title: 'Test Task',
        description: 'Test',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Create sync metadata
      await db.insert(schema.taskSyncMetadata).values({
        taskId: task.id,
        googleTaskId: 'test-google-task-id',
        googleEventId: 'test-google-event-id',
        isFixed: false,
        syncStatus: 'synced',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      // Mock the tasks client to throw a retryable error
      const mockError = new Error('Server error');
      (mockError as any).response = { status: 502 };
      
      mockTasksClient.updateTask.mockRejectedValue(mockError);

      // Attempt to update task
      await expect(syncEngine.exportTaskModification(task.id)).rejects.toThrow();

      // Check that operation was queued
      const queuedOps = await db.select().from(schema.syncQueue);
      expect(queuedOps.length).toBe(1);
      expect(queuedOps[0].operation).toBe('update');
      expect(queuedOps[0].entityType).toBe('task');
      expect(queuedOps[0].entityId).toBe(task.id);
      expect(queuedOps[0].status).toBe('pending');
    });
  });

  describe('Exponential Backoff', () => {
    it('should calculate exponential backoff correctly', async () => {
      const now = new Date().toISOString();
      
      // Create a task
      const [task] = await db.insert(schema.tasks).values({
        title: 'Test Task',
        description: 'Test',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Create sync metadata
      await db.insert(schema.taskSyncMetadata).values({
        taskId: task.id,
        googleTaskId: 'test-google-task-id',
        isFixed: false,
        syncStatus: 'synced',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      // Mock the tasks client to throw a retryable error
      const mockError = new Error('Server error');
      (mockError as any).response = { status: 500 };
      
      mockTasksClient.completeTask.mockRejectedValue(mockError);

      // Attempt to complete task
      await expect(syncEngine.exportTaskCompletion(task.id)).rejects.toThrow();

      // Check that next retry time is approximately 1 second in the future
      const queuedOps = await db.select().from(schema.syncQueue);
      expect(queuedOps.length).toBe(1);
      
      const nextRetryAt = new Date(queuedOps[0].nextRetryAt!);
      const nowDate = new Date();
      const diffMs = nextRetryAt.getTime() - nowDate.getTime();
      
      // Should be approximately 1 second (allow 100ms tolerance)
      expect(diffMs).toBeGreaterThan(900);
      expect(diffMs).toBeLessThan(1100);
    });
  });

  describe('Retry Processing', () => {
    it('should process queued operations when ready', async () => {
      const now = new Date().toISOString();
      
      // Create a task
      const [task] = await db.insert(schema.tasks).values({
        title: 'Test Task',
        description: 'Test',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Create sync metadata
      await db.insert(schema.taskSyncMetadata).values({
        taskId: task.id,
        googleTaskId: 'test-google-task-id',
        isFixed: false,
        syncStatus: 'synced',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      // Manually insert a queued operation that's ready for retry
      const pastTime = new Date(Date.now() - 1000).toISOString(); // 1 second ago
      await db.insert(schema.syncQueue).values({
        userId: 1,
        operation: 'complete',
        entityType: 'task',
        entityId: task.id,
        payload: JSON.stringify({}),
        status: 'pending',
        retryCount: 0,
        nextRetryAt: pastTime,
        createdAt: now,
        updatedAt: now,
      });

      // Mock successful completion
      mockTasksClient.completeTask.mockResolvedValue(undefined);

      // Process retry queue
      await syncEngine.retryFailedOperations();

      // Check that operation was marked as completed
      const queuedOps = await db.select().from(schema.syncQueue);
      expect(queuedOps.length).toBe(1);
      expect(queuedOps[0].status).toBe('completed');
    });

    it('should not process operations that are not ready for retry', async () => {
      const now = new Date().toISOString();
      
      // Create a task
      const [task] = await db.insert(schema.tasks).values({
        title: 'Test Task',
        description: 'Test',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Manually insert a queued operation that's NOT ready for retry
      const futureTime = new Date(Date.now() + 10000).toISOString(); // 10 seconds in future
      await db.insert(schema.syncQueue).values({
        userId: 1,
        operation: 'complete',
        entityType: 'task',
        entityId: task.id,
        payload: JSON.stringify({}),
        status: 'pending',
        retryCount: 0,
        nextRetryAt: futureTime,
        createdAt: now,
        updatedAt: now,
      });

      // Process retry queue
      await syncEngine.retryFailedOperations();

      // Check that operation is still pending
      const queuedOps = await db.select().from(schema.syncQueue);
      expect(queuedOps.length).toBe(1);
      expect(queuedOps[0].status).toBe('pending');
    });

    it('should mark operation as failed after max retries', async () => {
      const now = new Date().toISOString();
      
      // Create a task
      const [task] = await db.insert(schema.tasks).values({
        title: 'Test Task',
        description: 'Test',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Create sync metadata
      await db.insert(schema.taskSyncMetadata).values({
        taskId: task.id,
        googleTaskId: 'test-google-task-id',
        isFixed: false,
        syncStatus: 'synced',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      // Manually insert a queued operation with max retries (adjusted for test config)
      const pastTime = new Date(Date.now() - 1000).toISOString();
      await db.insert(schema.syncQueue).values({
        userId: 1,
        operation: 'complete',
        entityType: 'task',
        entityId: task.id,
        payload: JSON.stringify({}),
        status: 'pending',
        retryCount: 1, // One more retry will hit max (2 for tests)
        nextRetryAt: pastTime,
        createdAt: now,
        updatedAt: now,
      });

      // Mock failure
      const mockError = new Error('Server error');
      mockTasksClient.completeTask.mockRejectedValue(mockError);

      // Process retry queue
      await syncEngine.retryFailedOperations();

      // Check that operation was marked as failed
      const queuedOps = await db.select().from(schema.syncQueue);
      expect(queuedOps.length).toBe(1);
      expect(queuedOps[0].status).toBe('failed');
      expect(queuedOps[0].retryCount).toBe(2); // Max retries for test config
    });
  });

  describe('Sync Logging', () => {
    it('should log all sync operations', async () => {
      const now = new Date().toISOString();
      
      // Create a task
      const [task] = await db.insert(schema.tasks).values({
        title: 'Test Task',
        description: 'Test',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Create sync metadata
      await db.insert(schema.taskSyncMetadata).values({
        taskId: task.id,
        googleTaskId: 'test-google-task-id',
        isFixed: false,
        syncStatus: 'synced',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      // Mock successful completion
      mockTasksClient.completeTask.mockResolvedValue(undefined);

      // Complete task
      await syncEngine.exportTaskCompletion(task.id);

      // Check that operation was logged
      const logs = await db.select().from(schema.syncLog);
      expect(logs.length).toBe(1);
      expect(logs[0].operation).toBe('export');
      expect(logs[0].entityType).toBe('task');
      expect(logs[0].entityId).toBe(task.id.toString());
      expect(logs[0].status).toBe('success');
    });

    it('should log failed operations with error details', async () => {
      const now = new Date().toISOString();
      
      // Create a task
      const [task] = await db.insert(schema.tasks).values({
        title: 'Test Task',
        description: 'Test',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Create sync metadata
      await db.insert(schema.taskSyncMetadata).values({
        taskId: task.id,
        googleTaskId: 'test-google-task-id',
        isFixed: false,
        syncStatus: 'synced',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      // Mock failure
      const mockError = new Error('Test error message');
      (mockError as any).response = { status: 500 };
      mockTasksClient.completeTask.mockRejectedValue(mockError);

      // Attempt to complete task
      await expect(syncEngine.exportTaskCompletion(task.id)).rejects.toThrow();

      // Check that failure was logged
      const logs = await db.select().from(schema.syncLog);
      expect(logs.length).toBe(1);
      expect(logs[0].operation).toBe('export');
      expect(logs[0].status).toBe('failure');
      
      const details = JSON.parse(logs[0].details!);
      expect(details.error).toBe('Test error message');
      expect(details.queued).toBe(true);
    });
  });

  describe('Sync Status', () => {
    it('should return correct pending operations count', async () => {
      const now = new Date().toISOString();
      
      // Create tasks
      const [task1] = await db.insert(schema.tasks).values({
        title: 'Test Task 1',
        description: 'Test',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      }).returning();

      const [task2] = await db.insert(schema.tasks).values({
        title: 'Test Task 2',
        description: 'Test',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Add pending operations
      await db.insert(schema.syncQueue).values([
        {
          userId: 1,
          operation: 'complete',
          entityType: 'task',
          entityId: task1.id,
          payload: JSON.stringify({}),
          status: 'pending',
          retryCount: 0,
          nextRetryAt: now,
          createdAt: now,
          updatedAt: now,
        },
        {
          userId: 1,
          operation: 'update',
          entityType: 'task',
          entityId: task2.id,
          payload: JSON.stringify({}),
          status: 'pending',
          retryCount: 0,
          nextRetryAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      // Get sync status
      const status = await syncEngine.getSyncStatus();

      // Check pending operations count
      expect(status.pendingOperations).toBe(2);
    });
  });
});
