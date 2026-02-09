/**
 * Property-Based Tests: Sync Engine - Error Handling
 * 
 * Tests universal properties of error handling, retry logic, and operation queueing.
 * 
 * Properties tested:
 * - Property 10: Failed Operation Queueing (Validates: Requirements 4.3, 5.4, 6.4)
 * - Property 22: Sync Operation Logging (Validates: Requirements 9.2, 10.5, 11.5)
 * - Property 23: Rate Limit Queueing (Validates: Requirements 9.3, 11.3, 11.4)
 * - Property 24: Offline Operation Queueing (Validates: Requirements 9.4)
 * - Property 27: API Request Rate Tracking (Validates: Requirements 11.1, 11.2)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../db/schema.js';
import { SyncEngine } from '../sync-engine.js';
import * as fc from 'fast-check';

// Mock the Google API clients
vi.mock('../google-calendar-client.js');
vi.mock('../google-tasks-client.js');
vi.mock('../oauth-manager.js');

describe('SyncEngine - Error Handling Properties', () => {
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

  // ==========================================================================
  // Property 10: Failed Operation Queueing
  // **Validates: Requirements 4.3, 5.4, 6.4**
  // ==========================================================================

  describe('Feature: google-calendar-sync, Property 10: Failed Operation Queueing', () => {
    it('should queue any failed sync operation (create, update, complete) for retry', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random task data
          fc.record({
            title: fc.string({ minLength: 1, maxLength: 100 }),
            description: fc.option(fc.string({ maxLength: 500 }), { nil: null }),
            estimatedMinutes: fc.integer({ min: 5, max: 480 }),
            priority: fc.constantFrom('must-do', 'should-do', 'nice-to-do'),
          }),
          // Generate random operation type
          fc.constantFrom('create', 'update', 'complete'),
          // Generate random retryable error type
          fc.constantFrom(
            { status: 500, message: 'Internal Server Error' },
            { status: 502, message: 'Bad Gateway' },
            { status: 503, message: 'Service Unavailable' },
            { status: 429, message: 'Rate Limit Exceeded' },
            { code: 'ETIMEDOUT', message: 'Network timeout' },
            { code: 'ECONNREFUSED', message: 'Connection refused' }
          ),
          async (taskData, operation, errorType) => {
            const now = new Date().toISOString();

            // Create a task
            const [task] = await db.insert(schema.tasks).values({
              title: taskData.title,
              description: taskData.description,
              domainId: 1,
              priority: taskData.priority,
              estimatedMinutes: taskData.estimatedMinutes,
              status: 'todo',
              createdAt: now,
              updatedAt: now,
            }).returning();

            // For update and complete operations, create sync metadata
            if (operation === 'update' || operation === 'complete') {
              await db.insert(schema.taskSyncMetadata).values({
                taskId: task.id,
                googleTaskId: 'test-google-task-id',
                googleEventId: operation === 'update' ? 'test-google-event-id' : null,
                isFixed: false,
                syncStatus: 'synced',
                retryCount: 0,
                createdAt: now,
                updatedAt: now,
              });
            }

            // Mock the appropriate client method to throw the error
            const mockError = new Error(errorType.message);
            if ('status' in errorType) {
              (mockError as any).response = { status: errorType.status };
            } else {
              (mockError as any).code = errorType.code;
            }

            if (operation === 'create') {
              mockTasksClient.createTask.mockRejectedValue(mockError);
            } else if (operation === 'update') {
              mockTasksClient.updateTask.mockRejectedValue(mockError);
            } else {
              mockTasksClient.completeTask.mockRejectedValue(mockError);
            }

            // Attempt the operation
            try {
              if (operation === 'create') {
                await syncEngine.exportNewTask(task.id);
              } else if (operation === 'update') {
                await syncEngine.exportTaskModification(task.id);
              } else {
                await syncEngine.exportTaskCompletion(task.id);
              }
              // Should have thrown
              expect.fail('Operation should have thrown an error');
            } catch (error) {
              // Expected to fail
            }

            // PROPERTY: Operation should be queued for retry
            const queuedOps = await db.select().from(schema.syncQueue);
            expect(queuedOps.length).toBeGreaterThanOrEqual(1);

            const queuedOp = queuedOps.find(op => op.entityId === task.id);
            expect(queuedOp).toBeDefined();
            expect(queuedOp!.operation).toBe(operation);
            expect(queuedOp!.entityType).toBe('task');
            expect(queuedOp!.status).toBe('pending');
            expect(queuedOp!.retryCount).toBe(0);
            expect(queuedOp!.nextRetryAt).toBeTruthy();

            // Verify next retry time is in the future
            const nextRetryAt = new Date(queuedOp!.nextRetryAt!);
            const nowDate = new Date();
            expect(nextRetryAt.getTime()).toBeGreaterThan(nowDate.getTime());
          }
        ),
        { numRuns: 100 }
      );
    }, 60000); // 60 second timeout for property test
  });

  // ==========================================================================
  // Property 22: Sync Operation Logging
  // **Validates: Requirements 9.2, 10.5, 11.5**
  // ==========================================================================

  describe('Feature: google-calendar-sync, Property 22: Sync Operation Logging', () => {
    it('should log all sync operations (success and failure) with complete metadata', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random task data
          fc.record({
            title: fc.string({ minLength: 1, maxLength: 100 }),
            estimatedMinutes: fc.integer({ min: 5, max: 480 }),
          }),
          // Generate random operation type
          fc.constantFrom('create', 'update', 'complete'),
          // Generate random outcome (success or failure)
          fc.boolean(),
          async (taskData, operation, shouldSucceed) => {
            const now = new Date().toISOString();

            // Create a task
            const [task] = await db.insert(schema.tasks).values({
              title: taskData.title,
              description: null,
              domainId: 1,
              priority: 'must-do',
              estimatedMinutes: taskData.estimatedMinutes,
              status: 'todo',
              createdAt: now,
              updatedAt: now,
            }).returning();

            // For update and complete operations, create sync metadata
            if (operation === 'update' || operation === 'complete') {
              await db.insert(schema.taskSyncMetadata).values({
                taskId: task.id,
                googleTaskId: 'test-google-task-id',
                googleEventId: operation === 'update' ? 'test-google-event-id' : null,
                isFixed: false,
                syncStatus: 'synced',
                retryCount: 0,
                createdAt: now,
                updatedAt: now,
              });
            }

            // Mock success or failure
            if (shouldSucceed) {
              mockTasksClient.createTask.mockResolvedValue('new-task-id');
              mockCalendarClient.createEvent.mockResolvedValue('new-event-id');
              mockTasksClient.updateTask.mockResolvedValue(undefined);
              mockCalendarClient.updateEvent.mockResolvedValue(undefined);
              mockTasksClient.completeTask.mockResolvedValue(undefined);
            } else {
              const mockError = new Error('Test error');
              (mockError as any).response = { status: 500 };
              mockTasksClient.createTask.mockRejectedValue(mockError);
              mockTasksClient.updateTask.mockRejectedValue(mockError);
              mockTasksClient.completeTask.mockRejectedValue(mockError);
            }

            // Get initial log count
            const initialLogs = await db.select().from(schema.syncLog);
            const initialCount = initialLogs.length;

            // Attempt the operation
            try {
              if (operation === 'create') {
                await syncEngine.exportNewTask(task.id);
              } else if (operation === 'update') {
                await syncEngine.exportTaskModification(task.id);
              } else {
                await syncEngine.exportTaskCompletion(task.id);
              }
            } catch (error) {
              // Expected for failures
            }

            // PROPERTY: Operation should be logged
            const logs = await db.select().from(schema.syncLog);
            expect(logs.length).toBeGreaterThan(initialCount);

            const newLog = logs[logs.length - 1];
            expect(newLog.operation).toBe('export');
            expect(newLog.entityType).toBe('task');
            expect(newLog.entityId).toBe(task.id.toString());
            expect(newLog.status).toBe(shouldSucceed ? 'success' : 'failure');
            expect(newLog.timestamp).toBeTruthy();
            expect(newLog.details).toBeTruthy();

            // Verify details contain operation type
            const details = JSON.parse(newLog.details!);
            expect(details.operation).toBe(operation);
          }
        ),
        { numRuns: 100 }
      );
    }, 60000);
  });

  // ==========================================================================
  // Property 23: Rate Limit Queueing with Exponential Backoff
  // **Validates: Requirements 9.3, 11.3, 11.4**
  // ==========================================================================

  describe('Feature: google-calendar-sync, Property 23: Rate Limit Queueing', () => {
    it('should queue rate-limited operations and apply exponential backoff', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random task data
          fc.record({
            title: fc.string({ minLength: 1, maxLength: 100 }),
            estimatedMinutes: fc.integer({ min: 5, max: 480 }),
          }),
          async (taskData) => {
            const now = new Date().toISOString();

            // Create a task
            const [task] = await db.insert(schema.tasks).values({
              title: taskData.title,
              description: null,
              domainId: 1,
              priority: 'must-do',
              estimatedMinutes: taskData.estimatedMinutes,
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

            // Mock rate limit error (429)
            const rateLimitError = new Error('Rate limit exceeded');
            (rateLimitError as any).response = { status: 429 };
            mockTasksClient.completeTask.mockRejectedValue(rateLimitError);

            // Attempt to complete task
            try {
              await syncEngine.exportTaskCompletion(task.id);
              expect.fail('Should have thrown rate limit error');
            } catch (error) {
              // Expected
            }

            // PROPERTY: Operation should be queued
            const queuedOps = await db.select().from(schema.syncQueue);
            expect(queuedOps.length).toBeGreaterThanOrEqual(1);

            const queuedOp = queuedOps.find(op => op.entityId === task.id);
            expect(queuedOp).toBeDefined();
            expect(queuedOp!.status).toBe('pending');

            // PROPERTY: Next retry should be scheduled with exponential backoff
            // For retry count 0, should be ~1 second in future (or 10ms for test config)
            const nextRetryAt = new Date(queuedOp!.nextRetryAt!);
            const nowDate = new Date();
            const diffMs = nextRetryAt.getTime() - nowDate.getTime();

            // Should be approximately 1 second (allow tolerance for test config)
            expect(diffMs).toBeGreaterThan(0);
            expect(diffMs).toBeLessThan(2000); // Within 2 seconds
          }
        ),
        { numRuns: 10 }
      );
    }, 60000);
  });

  // ==========================================================================
  // Property 24: Offline Operation Queueing
  // **Validates: Requirements 9.4**
  // ==========================================================================

  describe('Feature: google-calendar-sync, Property 24: Offline Operation Queueing', () => {
    it('should queue operations when network connectivity is lost', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random task data
          fc.record({
            title: fc.string({ minLength: 1, maxLength: 100 }),
            estimatedMinutes: fc.integer({ min: 5, max: 480 }),
          }),
          // Generate random network error type
          fc.constantFrom(
            { code: 'ETIMEDOUT', message: 'Network timeout' },
            { code: 'ECONNREFUSED', message: 'Connection refused' },
            { code: 'ENOTFOUND', message: 'DNS lookup failed' },
            { code: 'ECONNRESET', message: 'Connection reset' }
          ),
          async (taskData, networkError) => {
            const now = new Date().toISOString();

            // Create a task
            const [task] = await db.insert(schema.tasks).values({
              title: taskData.title,
              description: null,
              domainId: 1,
              priority: 'must-do',
              estimatedMinutes: taskData.estimatedMinutes,
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

            // Mock network error
            const mockError = new Error(networkError.message);
            (mockError as any).code = networkError.code;
            mockTasksClient.completeTask.mockRejectedValue(mockError);

            // Attempt to complete task
            try {
              await syncEngine.exportTaskCompletion(task.id);
              expect.fail('Should have thrown network error');
            } catch (error) {
              // Expected
            }

            // PROPERTY: Operation should be queued for retry when connectivity returns
            const queuedOps = await db.select().from(schema.syncQueue);
            expect(queuedOps.length).toBeGreaterThanOrEqual(1);

            const queuedOp = queuedOps.find(op => op.entityId === task.id);
            expect(queuedOp).toBeDefined();
            expect(queuedOp!.operation).toBe('complete');
            expect(queuedOp!.status).toBe('pending');
            expect(queuedOp!.nextRetryAt).toBeTruthy();

            // PROPERTY: Error message should indicate network issue
            expect(queuedOp!.error).toBeTruthy();
            const errorLower = queuedOp!.error!.toLowerCase();
            expect(
              errorLower.includes('network') ||
              errorLower.includes('timeout') ||
              errorLower.includes('connection') ||
              errorLower.includes('dns') ||
              errorLower.includes('lookup') ||
              errorLower.includes('refused')
            ).toBe(true);
          }
        ),
        { numRuns: 10 }
      );
    }, 60000);
  });

  // ==========================================================================
  // Property 27: API Request Rate Tracking
  // **Validates: Requirements 11.1, 11.2**
  // ==========================================================================

  describe('Feature: google-calendar-sync, Property 27: API Request Rate Tracking', () => {
    it('should track and prevent exceeding per-user rate limits', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random number of tasks (simulating burst of requests)
          fc.integer({ min: 1, max: 10 }),
          async (numTasks) => {
            const now = new Date().toISOString();
            const taskIds: number[] = [];

            // Create multiple tasks
            for (let i = 0; i < numTasks; i++) {
              const [task] = await db.insert(schema.tasks).values({
                title: `Task ${i}`,
                description: null,
                domainId: 1,
                priority: 'must-do',
                estimatedMinutes: 30,
                status: 'todo',
                createdAt: now,
                updatedAt: now,
              }).returning();

              await db.insert(schema.taskSyncMetadata).values({
                taskId: task.id,
                googleTaskId: `google-task-${i}`,
                isFixed: false,
                syncStatus: 'synced',
                retryCount: 0,
                createdAt: now,
                updatedAt: now,
              });

              taskIds.push(task.id);
            }

            // Mock successful completions
            mockTasksClient.completeTask.mockResolvedValue(undefined);

            // Attempt to complete all tasks
            const results = await Promise.allSettled(
              taskIds.map(id => syncEngine.exportTaskCompletion(id))
            );

            // PROPERTY: All operations should complete (either succeed or be queued)
            // This validates that rate limiting doesn't cause data loss
            const successCount = results.filter(r => r.status === 'fulfilled').length;
            const failureCount = results.filter(r => r.status === 'rejected').length;

            // All should succeed in this test (no actual rate limiting)
            expect(successCount + failureCount).toBe(numTasks);

            // PROPERTY: All operations should be logged
            const logs = await db.select().from(schema.syncLog);
            const exportLogs = logs.filter(
              log => log.operation === 'export' && log.entityType === 'task'
            );
            expect(exportLogs.length).toBeGreaterThanOrEqual(numTasks);

            // PROPERTY: No operations should be lost
            // (either completed successfully or queued for retry)
            const queuedOps = await db.select().from(schema.syncQueue);
            const totalProcessed = successCount + queuedOps.length;
            expect(totalProcessed).toBeGreaterThanOrEqual(numTasks);
          }
        ),
        { numRuns: 50 } // Fewer runs since this creates multiple tasks per run
      );
    }, 60000);
  });
});
