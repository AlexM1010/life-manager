import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import * as schema from '../../db/schema.js';
import { SyncEngine } from '../sync-engine.js';

/**
 * Sync Engine Export Operations - Property Tests
 * 
 * Property-based tests for export operations:
 * - Property 11: Successful Sync Status Update
 * - Property 12: New Task Dual Creation
 * - Property 13: Task Modification Sync
 * 
 * Validates Requirements: 4.4, 5.1, 5.2, 5.5, 6.1, 6.2, 6.3, 6.5
 */

// Mock the Google API clients
vi.mock('../google-calendar-client.js');
vi.mock('../google-tasks-client.js');
vi.mock('../oauth-manager.js');

describe('Sync Engine Export Operations - Property Tests', () => {
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

    // Create tables (using snake_case to match actual schema)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        domain_id INTEGER NOT NULL,
        priority TEXT NOT NULL,
        estimated_minutes INTEGER NOT NULL,
        due_date TEXT,
        status TEXT NOT NULL,
        rrule TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_sync_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL UNIQUE,
        google_task_id TEXT,
        google_event_id TEXT,
        is_fixed INTEGER NOT NULL,
        last_sync_time TEXT,
        sync_status TEXT NOT NULL,
        sync_error TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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

    // Setup mocks
    mockOAuthManager = {
      getOAuth2Client: vi.fn().mockResolvedValue('mock-oauth-client'),
    };

    mockCalendarClient = {
      createEvent: vi.fn().mockResolvedValue('mock-event-id'),
      updateEvent: vi.fn().mockResolvedValue(undefined),
    };

    mockTasksClient = {
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

  // ============================================================================
  // Arbitraries (generators) for property-based testing
  // ============================================================================

  const taskTitleArb = fc.string({ minLength: 1, maxLength: 100 });
  const taskDescriptionArb = fc.option(fc.string({ minLength: 0, maxLength: 500 }), { nil: undefined });
  const priorityArb = fc.constantFrom('must-do', 'should-do', 'nice-to-have');
  const estimatedMinutesArb = fc.integer({ min: 15, max: 480 });
  const dueDateArb = fc.option(
    fc.integer({ min: 0, max: 365 }).map(days => {
      const date = new Date();
      date.setDate(date.getDate() + days);
      return date.toISOString().split('T')[0];
    }),
    { nil: undefined }
  );

  const taskArb = fc.record({
    title: taskTitleArb,
    description: taskDescriptionArb,
    priority: priorityArb,
    estimatedMinutes: estimatedMinutesArb,
    dueDate: dueDateArb,
  });

  // ============================================================================
  // Property 11: Successful Sync Status Update
  // ============================================================================

  /**
   * Property 11: Successful Sync Status Update
   * 
   * **Validates: Requirements 4.4, 5.5, 6.5**
   * 
   * For any successful export operation (completion, creation, or modification),
   * the sync metadata should be updated to reflect:
   * 1. syncStatus = 'synced'
   * 2. syncError = null
   * 3. retryCount = 0
   * 4. lastSyncTime = current time
   * 
   * This property ensures that successful operations always clear error state
   * and reset retry counters.
   */
  it('Property 11: Successful Sync Status Update', async () => {
    await fc.assert(
      fc.asyncProperty(taskArb, async (taskData) => {
        // Clear mocks for each iteration
        vi.clearAllMocks();
        
        // Create a task
        const now = new Date().toISOString();
        const [task] = await db.insert(schema.tasks).values({
          ...taskData,
          domainId: 1,
          status: 'todo',
          createdAt: now,
          updatedAt: now,
        }).returning();

        // Create sync metadata with failed status and retry count
        await db.insert(schema.taskSyncMetadata).values({
          taskId: task.id,
          googleTaskId: 'existing-task-id',
          googleEventId: 'existing-event-id',
          isFixed: false,
          lastSyncTime: null,
          syncStatus: 'failed',
          syncError: 'Previous error',
          retryCount: 3,
          createdAt: now,
          updatedAt: now,
        });

        // Export task modification (should succeed and update status)
        await syncEngine.exportTaskModification(task.id);

        // Verify sync metadata was updated correctly
        const metadata = await db.select()
          .from(schema.taskSyncMetadata)
          .where(eq(schema.taskSyncMetadata.taskId, task.id))
          .limit(1);

        expect(metadata.length).toBe(1);
        expect(metadata[0].syncStatus).toBe('synced');
        expect(metadata[0].syncError).toBeNull();
        expect(metadata[0].retryCount).toBe(0);
        expect(metadata[0].lastSyncTime).toBeTruthy();
        
        // Verify lastSyncTime is recent (within last 5 seconds)
        const lastSync = new Date(metadata[0].lastSyncTime!);
        const timeDiff = Date.now() - lastSync.getTime();
        expect(timeDiff).toBeLessThan(5000);
      }),
      { numRuns: 50 }
    );
  }, 15000);

  // ============================================================================
  // Property 12: New Task Dual Creation
  // ============================================================================

  /**
   * Property 12: New Task Dual Creation
   * 
   * **Validates: Requirements 5.1, 5.2**
   * 
   * For any new task created in Life Manager, the export operation should:
   * 1. Create a Google Task with matching title, description, and due date
   * 2. Create a Calendar Event with time block
   * 3. Store both IDs in sync metadata
   * 4. Mark sync status as 'synced'
   * 
   * This property ensures that new tasks are always exported to both services.
   */
  it('Property 12: New Task Dual Creation', async () => {
    await fc.assert(
      fc.asyncProperty(taskArb, async (taskData) => {
        // Clear mocks for each iteration
        vi.clearAllMocks();
        
        // Create a task
        const now = new Date().toISOString();
        const [task] = await db.insert(schema.tasks).values({
          ...taskData,
          domainId: 1,
          status: 'todo',
          createdAt: now,
          updatedAt: now,
        }).returning();

        // Export new task
        await syncEngine.exportNewTask(task.id);

        // Verify Google Task was created
        expect(mockTasksClient.createTask).toHaveBeenCalledTimes(1);
        const taskCall = mockTasksClient.createTask.mock.calls[0];
        expect(taskCall[1].title).toBe(taskData.title);
        // Handle both undefined and empty string for description
        if (taskData.description) {
          expect(taskCall[1].notes).toBe(taskData.description);
        } else {
          expect(taskCall[1].notes).toBeUndefined();
        }
        
        // Verify Calendar Event was created
        expect(mockCalendarClient.createEvent).toHaveBeenCalledTimes(1);
        const eventCall = mockCalendarClient.createEvent.mock.calls[0];
        expect(eventCall[1].summary).toBe(taskData.title);
        // Handle both undefined and empty string for description
        if (taskData.description) {
          expect(eventCall[1].description).toBe(taskData.description);
        } else {
          expect(eventCall[1].description).toBeUndefined();
        }
        
        // Verify time block duration matches estimated minutes
        const start = eventCall[1].start;
        const end = eventCall[1].end;
        const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
        expect(durationMinutes).toBe(taskData.estimatedMinutes);

        // Verify sync metadata was created with both IDs
        const metadata = await db.select()
          .from(schema.taskSyncMetadata)
          .where(eq(schema.taskSyncMetadata.taskId, task.id))
          .limit(1);

        expect(metadata.length).toBe(1);
        expect(metadata[0].googleTaskId).toBe('mock-task-id');
        expect(metadata[0].googleEventId).toBe('mock-event-id');
        expect(metadata[0].syncStatus).toBe('synced');
        expect(metadata[0].isFixed).toBe(false);
      }),
      { numRuns: 50 }
    );
  }, 15000);

  /**
   * Property 12 (Due Date Handling): Time blocks respect due dates
   * 
   * When a task has a due date, the calendar event should be scheduled
   * on that date. When no due date is provided, it should default to today.
   */
  it('Property 12 (Due Date Handling): Time blocks respect due dates', async () => {
    await fc.assert(
      fc.asyncProperty(taskArb, async (taskData) => {
        // Clear mocks for each iteration
        vi.clearAllMocks();
        
        // Create a task
        const now = new Date().toISOString();
        const [task] = await db.insert(schema.tasks).values({
          ...taskData,
          domainId: 1,
          status: 'todo',
          createdAt: now,
          updatedAt: now,
        }).returning();

        // Export new task
        await syncEngine.exportNewTask(task.id);

        // Verify Calendar Event date matches due date (or today if no due date)
        const eventCall = mockCalendarClient.createEvent.mock.calls[0];
        const start = eventCall[1].start;
        
        if (taskData.dueDate) {
          // Compare just the date part (YYYY-MM-DD)
          expect(start.toISOString().split('T')[0]).toBe(taskData.dueDate);
        } else {
          // When no due date, should use today
          const today = new Date();
          const todayStr = today.toISOString().split('T')[0];
          const startStr = start.toISOString().split('T')[0];
          expect(startStr).toBe(todayStr);
        }
      }),
      { numRuns: 50 }
    );
  }, 15000);

  // ============================================================================
  // Property 13: Task Modification Sync
  // ============================================================================

  /**
   * Property 13: Task Modification Sync
   * 
   * **Validates: Requirements 6.1, 6.2, 6.3**
   * 
   * For any task modification in Life Manager, the export operation should:
   * 1. Update the Google Task with new title, description, and due date
   * 2. Update the Calendar Event with new title, description, and time block
   * 3. Update sync metadata with new sync time and status
   * 
   * This property ensures that modifications are always propagated to both services.
   */
  it('Property 13: Task Modification Sync', async () => {
    await fc.assert(
      fc.asyncProperty(taskArb, taskArb, async (originalData, modifiedData) => {
        // Clear mocks for each iteration
        vi.clearAllMocks();
        
        // Create a task with original data
        const now = new Date().toISOString();
        const [task] = await db.insert(schema.tasks).values({
          ...originalData,
          domainId: 1,
          status: 'todo',
          createdAt: now,
          updatedAt: now,
        }).returning();

        // Create sync metadata
        await db.insert(schema.taskSyncMetadata).values({
          taskId: task.id,
          googleTaskId: 'existing-task-id',
          googleEventId: 'existing-event-id',
          isFixed: false,
          lastSyncTime: now,
          syncStatus: 'synced',
          syncError: null,
          retryCount: 0,
          createdAt: now,
          updatedAt: now,
        });

        // Modify the task
        await db.update(schema.tasks)
          .set({
            title: modifiedData.title,
            description: modifiedData.description,
            priority: modifiedData.priority,
            estimatedMinutes: modifiedData.estimatedMinutes,
            dueDate: modifiedData.dueDate,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.tasks.id, task.id));

        // Get the actual task from database to see what will be synced
        const [updatedTask] = await db.select()
          .from(schema.tasks)
          .where(eq(schema.tasks.id, task.id))
          .limit(1);

        // Export task modification
        await syncEngine.exportTaskModification(task.id);

        // Verify Google Task was updated with actual database values
        expect(mockTasksClient.updateTask).toHaveBeenCalledTimes(1);
        const taskCall = mockTasksClient.updateTask.mock.calls[0];
        expect(taskCall[1]).toBe('existing-task-id');
        expect(taskCall[2].title).toBe(updatedTask.title);
        // Check what was actually sent (based on database value)
        if (updatedTask.description) {
          expect(taskCall[2].notes).toBe(updatedTask.description);
        } else {
          expect(taskCall[2].notes).toBeUndefined();
        }

        // Verify Calendar Event was updated with actual database values
        expect(mockCalendarClient.updateEvent).toHaveBeenCalledTimes(1);
        const eventCall = mockCalendarClient.updateEvent.mock.calls[0];
        expect(eventCall[1]).toBe('existing-event-id');
        expect(eventCall[2].summary).toBe(updatedTask.title);
        // Check what was actually sent (based on database value)
        if (updatedTask.description) {
          expect(eventCall[2].description).toBe(updatedTask.description);
        } else {
          expect(eventCall[2].description).toBeUndefined();
        }

        // Verify time block duration matches new estimated minutes
        const start = eventCall[2].start;
        const end = eventCall[2].end;
        const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
        expect(durationMinutes).toBe(modifiedData.estimatedMinutes);

        // Verify sync metadata was updated
        const metadata = await db.select()
          .from(schema.taskSyncMetadata)
          .where(eq(schema.taskSyncMetadata.taskId, task.id))
          .limit(1);

        expect(metadata.length).toBe(1);
        expect(metadata[0].syncStatus).toBe('synced');
        expect(metadata[0].syncError).toBeNull();
        expect(metadata[0].retryCount).toBe(0);
      }),
      { numRuns: 30 }
    );
  }, 15000);

  /**
   * Property 13 (Partial Sync): Missing Google IDs are handled gracefully
   * 
   * If a task has only a Google Task ID (no Event ID) or vice versa,
   * the modification should update only the available service without error.
   */
  it('Property 13 (Partial Sync): Missing Google IDs are handled gracefully', async () => {
    await fc.assert(
      fc.asyncProperty(
        taskArb,
        fc.constantFrom('task-only', 'event-only'),
        async (taskData, syncType) => {
          // Clear mocks for each iteration
          vi.clearAllMocks();
          
          // Create a task
          const now = new Date().toISOString();
          const [task] = await db.insert(schema.tasks).values({
            ...taskData,
            domainId: 1,
            status: 'todo',
            createdAt: now,
            updatedAt: now,
          }).returning();

          // Create sync metadata with only one Google ID
          await db.insert(schema.taskSyncMetadata).values({
            taskId: task.id,
            googleTaskId: syncType === 'task-only' ? 'existing-task-id' : null,
            googleEventId: syncType === 'event-only' ? 'existing-event-id' : null,
            isFixed: false,
            lastSyncTime: now,
            syncStatus: 'synced',
            syncError: null,
            retryCount: 0,
            createdAt: now,
            updatedAt: now,
          });

          // Export task modification (should not throw)
          await expect(syncEngine.exportTaskModification(task.id)).resolves.not.toThrow();

          // Verify only the available service was updated
          if (syncType === 'task-only') {
            expect(mockTasksClient.updateTask).toHaveBeenCalledTimes(1);
            expect(mockCalendarClient.updateEvent).not.toHaveBeenCalled();
          } else {
            expect(mockCalendarClient.updateEvent).toHaveBeenCalledTimes(1);
            expect(mockTasksClient.updateTask).not.toHaveBeenCalled();
          }

          // Verify sync status is still 'synced'
          const metadata = await db.select()
            .from(schema.taskSyncMetadata)
            .where(eq(schema.taskSyncMetadata.taskId, task.id))
            .limit(1);

          expect(metadata[0].syncStatus).toBe('synced');
        }
      ),
      { numRuns: 30 }
    );
  }, 15000);

  // ============================================================================
  // Property 14: Idempotency - Export New Task
  // ============================================================================

  /**
   * Property 14: Idempotency - Export New Task
   * 
   * **Validates: Reliability Principle**
   * 
   * Calling exportNewTask twice on the same task should:
   * 1. Create Google resources only once (first call)
   * 2. Skip silently on second call (no duplicate creation)
   * 3. Leave sync metadata unchanged after second call
   * 
   * This property ensures that network retries or duplicate triggers
   * don't create orphaned Google resources.
   */
  it('Property 14: Idempotency - Export New Task', async () => {
    await fc.assert(
      fc.asyncProperty(taskArb, async (taskData) => {
        // Clear mocks for each iteration
        vi.clearAllMocks();
        
        // Create a task
        const now = new Date().toISOString();
        const [task] = await db.insert(schema.tasks).values({
          ...taskData,
          domainId: 1,
          status: 'todo',
          createdAt: now,
          updatedAt: now,
        }).returning();

        // First export - should create Google resources
        await syncEngine.exportNewTask(task.id);

        // Capture state after first export
        const metadataAfterFirst = await db.select()
          .from(schema.taskSyncMetadata)
          .where(eq(schema.taskSyncMetadata.taskId, task.id))
          .limit(1);

        expect(metadataAfterFirst.length).toBe(1);
        expect(metadataAfterFirst[0].googleTaskId).toBe('mock-task-id');
        expect(metadataAfterFirst[0].googleEventId).toBe('mock-event-id');

        // Record call counts after first export
        const taskCallsAfterFirst = mockTasksClient.createTask.mock.calls.length;
        const eventCallsAfterFirst = mockCalendarClient.createEvent.mock.calls.length;

        // Second export - should be a no-op
        await syncEngine.exportNewTask(task.id);

        // Verify no additional Google API calls were made
        expect(mockTasksClient.createTask.mock.calls.length).toBe(taskCallsAfterFirst);
        expect(mockCalendarClient.createEvent.mock.calls.length).toBe(eventCallsAfterFirst);

        // Verify metadata is unchanged
        const metadataAfterSecond = await db.select()
          .from(schema.taskSyncMetadata)
          .where(eq(schema.taskSyncMetadata.taskId, task.id))
          .limit(1);

        expect(metadataAfterSecond.length).toBe(1);
        expect(metadataAfterSecond[0].googleTaskId).toBe(metadataAfterFirst[0].googleTaskId);
        expect(metadataAfterSecond[0].googleEventId).toBe(metadataAfterFirst[0].googleEventId);
        expect(metadataAfterSecond[0].syncStatus).toBe('synced');
      }),
      { numRuns: 30 }
    );
  }, 15000);

  // ============================================================================
  // Property 15: Idempotency - Export Task Completion
  // ============================================================================

  /**
   * Property 15: Idempotency - Export Task Completion
   * 
   * **Validates: Reliability Principle**
   * 
   * Calling exportTaskCompletion twice on the same task should:
   * 1. Complete the Google Task on first call
   * 2. Complete again on second call (Google API is idempotent for completion)
   * 3. Not throw errors or corrupt state
   * 
   * This property ensures that completion sync is safe to retry.
   */
  it('Property 15: Idempotency - Export Task Completion', async () => {
    await fc.assert(
      fc.asyncProperty(taskArb, async (taskData) => {
        // Clear mocks for each iteration
        vi.clearAllMocks();
        
        // Create a task
        const now = new Date().toISOString();
        const [task] = await db.insert(schema.tasks).values({
          ...taskData,
          domainId: 1,
          status: 'done', // Already completed locally
          createdAt: now,
          updatedAt: now,
        }).returning();

        // Create sync metadata with Google Task ID
        await db.insert(schema.taskSyncMetadata).values({
          taskId: task.id,
          googleTaskId: 'existing-task-id',
          googleEventId: null,
          isFixed: false,
          lastSyncTime: now,
          syncStatus: 'synced',
          syncError: null,
          retryCount: 0,
          createdAt: now,
          updatedAt: now,
        });

        // First completion export
        await syncEngine.exportTaskCompletion(task.id);

        // Second completion export - should not throw
        await expect(syncEngine.exportTaskCompletion(task.id)).resolves.not.toThrow();

        // Verify Google API was called twice (both calls are valid)
        expect(mockTasksClient.completeTask.mock.calls.length).toBe(2);

        // Verify sync metadata is still valid
        const metadata = await db.select()
          .from(schema.taskSyncMetadata)
          .where(eq(schema.taskSyncMetadata.taskId, task.id))
          .limit(1);

        expect(metadata[0].syncStatus).toBe('synced');
        expect(metadata[0].syncError).toBeNull();
      }),
      { numRuns: 30 }
    );
  }, 15000);

  // ============================================================================
  // Property 16: Graceful Degradation - Missing Sync Metadata
  // ============================================================================

  /**
   * Property 16: Graceful Degradation - Missing Sync Metadata
   * 
   * **Validates: Reliability Principle**
   * 
   * Export operations on tasks without sync metadata should:
   * 1. Return early without throwing errors
   * 2. Not make any Google API calls
   * 3. Not create orphaned sync metadata
   * 
   * This property ensures that tasks created before Google sync was enabled
   * don't cause errors when completion/modification is triggered.
   */
  it('Property 16: Graceful Degradation - Missing Sync Metadata', async () => {
    await fc.assert(
      fc.asyncProperty(taskArb, async (taskData) => {
        // Clear mocks for each iteration
        vi.clearAllMocks();
        
        // Create a task WITHOUT sync metadata
        const now = new Date().toISOString();
        const [task] = await db.insert(schema.tasks).values({
          ...taskData,
          domainId: 1,
          status: 'done',
          createdAt: now,
          updatedAt: now,
        }).returning();

        // Export completion - should return early, not throw
        await expect(syncEngine.exportTaskCompletion(task.id)).resolves.not.toThrow();

        // Export modification - should return early, not throw
        await expect(syncEngine.exportTaskModification(task.id)).resolves.not.toThrow();

        // Verify no Google API calls were made
        expect(mockTasksClient.completeTask).not.toHaveBeenCalled();
        expect(mockTasksClient.updateTask).not.toHaveBeenCalled();
        expect(mockCalendarClient.updateEvent).not.toHaveBeenCalled();

        // Verify no sync metadata was created
        const metadata = await db.select()
          .from(schema.taskSyncMetadata)
          .where(eq(schema.taskSyncMetadata.taskId, task.id))
          .limit(1);

        expect(metadata.length).toBe(0);
      }),
      { numRuns: 30 }
    );
  }, 15000);

  // ============================================================================
  // Property 17: Partial Failure Recovery - Google Task Created, Event Failed
  // ============================================================================

  /**
   * Property 17: Partial Failure Recovery
   * 
   * **Validates: Graceful Degradation Principle**
   * 
   * When exportNewTask partially succeeds (Google Task created, Calendar Event fails):
   * 1. The Google Task ID should be saved to sync metadata
   * 2. Sync status should be 'failed' with error message
   * 3. Retry count should be incremented
   * 4. The saved Task ID allows future retry without creating duplicates
   * 
   * This property ensures that partial failures don't lose created resources.
   */
  it('Property 17: Partial Failure Recovery', async () => {
    await fc.assert(
      fc.asyncProperty(taskArb, async (taskData) => {
        // Clear mocks for each iteration
        vi.clearAllMocks();
        
        // Make Calendar Event creation fail (all attempts)
        mockCalendarClient.createEvent.mockRejectedValue(new Error('Calendar API error'));
        
        // Create a task
        const now = new Date().toISOString();
        const [task] = await db.insert(schema.tasks).values({
          ...taskData,
          domainId: 1,
          status: 'todo',
          createdAt: now,
          updatedAt: now,
        }).returning();

        // Export should throw (because Calendar failed)
        await expect(syncEngine.exportNewTask(task.id)).rejects.toThrow('Calendar API error');

        // But Google Task should have been created
        expect(mockTasksClient.createTask).toHaveBeenCalledTimes(1);

        // Verify sync metadata was created with partial success
        const metadata = await db.select()
          .from(schema.taskSyncMetadata)
          .where(eq(schema.taskSyncMetadata.taskId, task.id))
          .limit(1);

        expect(metadata.length).toBe(1);
        expect(metadata[0].googleTaskId).toBe('mock-task-id'); // Task ID saved!
        expect(metadata[0].googleEventId).toBeNull(); // Event failed
        expect(metadata[0].syncStatus).toBe('failed');
        expect(metadata[0].syncError).toBe('Calendar API error');
        expect(metadata[0].retryCount).toBe(1);
      }),
      { numRuns: 30 }
    );
  }, 15000);
});
