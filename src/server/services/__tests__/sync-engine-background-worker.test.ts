import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../db/schema.js';
import { SyncEngine } from '../sync-engine.js';
import { OAuthManager } from '../oauth-manager.js';
import { eq } from 'drizzle-orm';

/**
 * Background Worker Integration Tests
 * 
 * Tests the background worker functionality for retry queue processing.
 * 
 * Requirements: 4.3, 5.4, 6.4, 9.3, 11.3
 * 
 * Test Cases:
 * 1. Background worker processes pending operations from queue
 * 2. Background worker respects exponential backoff timing
 * 3. Background worker updates sync status after processing
 * 4. Background worker handles partial failures gracefully
 * 5. Background worker stops retrying after max attempts
 */

describe('SyncEngine - Background Worker', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let sqlite: Database.Database;
  let syncEngine: SyncEngine;
  let oauthManager: OAuthManager;
  const userId = 1;
  const defaultDomainId = 1;

  beforeEach(async () => {
    // Create in-memory database
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema });

    // Create tables
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS domains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, provider)
      );

      CREATE TABLE IF NOT EXISTS task_sync_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        google_task_id TEXT,
        google_event_id TEXT,
        is_fixed INTEGER DEFAULT 0,
        last_sync_time TEXT,
        sync_status TEXT NOT NULL,
        sync_error TEXT,
        retry_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        UNIQUE(task_id)
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
        retry_count INTEGER DEFAULT 0,
        next_retry_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        operation TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        status TEXT NOT NULL,
        details TEXT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);

    // Insert test user and domain
    sqlite.exec(`
      INSERT INTO users (id, email) VALUES (1, 'test@example.com');
      INSERT INTO domains (id, user_id, name, color) VALUES (1, 1, 'Work', '#3b82f6');
    `);

    // Create OAuth manager and sync engine with fast retry for testing
    const oauthConfig = {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret-must-be-long-enough',
      redirectUri: 'http://localhost:3000/auth/callback',
    };
    oauthManager = new OAuthManager(db, oauthConfig);
    syncEngine = new SyncEngine(db, oauthManager, userId, defaultDomainId, {
      retries: 3, // Reduced for testing
      minTimeout: 100, // Fast retry for testing
      maxTimeout: 1000,
    });
  });

  afterEach(() => {
    sqlite.close();
  });

  it('should process pending operations from queue', async () => {
    // Create a task
    const [task] = await db.insert(schema.tasks).values({
      title: 'Test Task',
      description: 'Test description',
      domainId: defaultDomainId,
      priority: 'must-do',
      estimatedMinutes: 30,
      status: 'todo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning();

    // Create sync metadata
    await db.insert(schema.taskSyncMetadata).values({
      taskId: task.id,
      googleTaskId: 'google-task-123',
      googleEventId: 'google-event-123',
      isFixed: false,
      syncStatus: 'synced',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Manually add operation to queue
    await db.insert(schema.syncQueue).values({
      userId,
      operation: 'complete',
      entityType: 'task',
      entityId: task.id,
      payload: JSON.stringify({}),
      status: 'pending',
      retryCount: 0,
      nextRetryAt: new Date().toISOString(), // Ready for retry now
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Mock Google API calls to succeed
    vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue({} as any);
    const mockCompleteTask = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(syncEngine as any, 'tasksClient', 'get').mockReturnValue({
      completeTask: mockCompleteTask,
    });

    // Process retry queue
    await syncEngine.retryFailedOperations();

    // Verify operation was processed
    const queuedOps = await db.select().from(schema.syncQueue);
    expect(queuedOps).toHaveLength(1);
    expect(queuedOps[0].status).toBe('completed');

    // Verify Google API was called
    expect(mockCompleteTask).toHaveBeenCalledWith({}, 'google-task-123');
  });

  it('should respect exponential backoff timing', async () => {
    // Create a task
    const [task] = await db.insert(schema.tasks).values({
      title: 'Test Task',
      description: 'Test description',
      domainId: defaultDomainId,
      priority: 'must-do',
      estimatedMinutes: 30,
      status: 'todo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning();

    // Add operation to queue with future retry time
    const futureRetryTime = new Date(Date.now() + 60000).toISOString(); // 1 minute in future
    await db.insert(schema.syncQueue).values({
      userId,
      operation: 'complete',
      entityType: 'task',
      entityId: task.id,
      payload: JSON.stringify({}),
      status: 'pending',
      retryCount: 2, // Already retried twice
      nextRetryAt: futureRetryTime,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Process retry queue
    await syncEngine.retryFailedOperations();

    // Verify operation was NOT processed (not ready yet)
    const queuedOps = await db.select().from(schema.syncQueue);
    expect(queuedOps).toHaveLength(1);
    expect(queuedOps[0].status).toBe('pending'); // Still pending
    expect(queuedOps[0].retryCount).toBe(2); // Unchanged
  });

  it('should update sync status after processing', async () => {
    // Create a task
    const [task] = await db.insert(schema.tasks).values({
      title: 'Test Task',
      description: 'Test description',
      domainId: defaultDomainId,
      priority: 'must-do',
      estimatedMinutes: 30,
      status: 'todo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning();

    // Create sync metadata with failed status
    await db.insert(schema.taskSyncMetadata).values({
      taskId: task.id,
      googleTaskId: 'google-task-123',
      googleEventId: 'google-event-123',
      isFixed: false,
      syncStatus: 'failed',
      syncError: 'Network error',
      retryCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Add operation to queue
    await db.insert(schema.syncQueue).values({
      userId,
      operation: 'complete',
      entityType: 'task',
      entityId: task.id,
      payload: JSON.stringify({}),
      status: 'pending',
      retryCount: 0,
      nextRetryAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Mock Google API calls to succeed
    vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue({} as any);
    const mockCompleteTask = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(syncEngine as any, 'tasksClient', 'get').mockReturnValue({
      completeTask: mockCompleteTask,
    });

    // Process retry queue
    await syncEngine.retryFailedOperations();

    // Verify sync metadata was updated
    const metadata = await db.select()
      .from(schema.taskSyncMetadata)
      .where(eq(schema.taskSyncMetadata.taskId, task.id));
    
    expect(metadata).toHaveLength(1);
    expect(metadata[0].syncStatus).toBe('synced');
    expect(metadata[0].syncError).toBeNull();
    expect(metadata[0].retryCount).toBe(0); // Reset on success
  });

  it('should handle partial failures gracefully', async () => {
    // Create two tasks
    const [task1] = await db.insert(schema.tasks).values({
      title: 'Task 1',
      description: 'Test description',
      domainId: defaultDomainId,
      priority: 'must-do',
      estimatedMinutes: 30,
      status: 'todo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning();

    const [task2] = await db.insert(schema.tasks).values({
      title: 'Task 2',
      description: 'Test description',
      domainId: defaultDomainId,
      priority: 'must-do',
      estimatedMinutes: 30,
      status: 'todo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning();

    // Create sync metadata for both
    await db.insert(schema.taskSyncMetadata).values([
      {
        taskId: task1.id,
        googleTaskId: 'google-task-1',
        isFixed: false,
        syncStatus: 'synced',
        retryCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        taskId: task2.id,
        googleTaskId: 'google-task-2',
        isFixed: false,
        syncStatus: 'synced',
        retryCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // Add operations to queue
    await db.insert(schema.syncQueue).values([
      {
        userId,
        operation: 'complete',
        entityType: 'task',
        entityId: task1.id,
        payload: JSON.stringify({}),
        status: 'pending',
        retryCount: 0,
        nextRetryAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        userId,
        operation: 'complete',
        entityType: 'task',
        entityId: task2.id,
        payload: JSON.stringify({}),
        status: 'pending',
        retryCount: 0,
        nextRetryAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // Mock Google API - first task succeeds, second task fails
    vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue({} as any);
    
    let callCount = 0;
    const mockCompleteTask = vi.fn().mockImplementation(() => {
      callCount++;
      // First task (first call) succeeds
      if (callCount === 1) {
        return Promise.resolve(undefined);
      }
      // Second task (all subsequent calls) fails
      return Promise.reject(new Error('Network error'));
    });
    
    vi.spyOn(syncEngine as any, 'tasksClient', 'get').mockReturnValue({
      completeTask: mockCompleteTask,
    });

    // Process retry queue
    await syncEngine.retryFailedOperations();

    // Verify first operation succeeded
    const queuedOps = await db.select().from(schema.syncQueue);
    const op1 = queuedOps.find(op => op.entityId === task1.id);
    const op2 = queuedOps.find(op => op.entityId === task2.id);

    expect(op1?.status).toBe('completed');
    expect(op2?.status).toBe('pending'); // Scheduled for retry
    expect(op2?.retryCount).toBe(1); // Incremented
  });

  it('should stop retrying after max attempts', async () => {
    // Create a task
    const [task] = await db.insert(schema.tasks).values({
      title: 'Test Task',
      description: 'Test description',
      domainId: defaultDomainId,
      priority: 'must-do',
      estimatedMinutes: 30,
      status: 'todo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning();

    // Create sync metadata
    await db.insert(schema.taskSyncMetadata).values({
      taskId: task.id,
      googleTaskId: 'google-task-123',
      isFixed: false,
      syncStatus: 'failed',
      retryCount: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Add operation to queue with max retries reached
    await db.insert(schema.syncQueue).values({
      userId,
      operation: 'complete',
      entityType: 'task',
      entityId: task.id,
      payload: JSON.stringify({}),
      status: 'pending',
      retryCount: 3, // Max retries (configured as 3 in beforeEach)
      nextRetryAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Mock Google API to fail
    vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue({} as any);
    const mockCompleteTask = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.spyOn(syncEngine as any, 'tasksClient', 'get').mockReturnValue({
      completeTask: mockCompleteTask,
    });

    // Process retry queue
    await syncEngine.retryFailedOperations();

    // Verify operation was marked as failed (not pending)
    const queuedOps = await db.select().from(schema.syncQueue);
    expect(queuedOps).toHaveLength(1);
    expect(queuedOps[0].status).toBe('failed'); // Permanently failed
    expect(queuedOps[0].retryCount).toBe(4); // Incremented one last time
  });

  it('should log retry operations', async () => {
    // Create a task
    const [task] = await db.insert(schema.tasks).values({
      title: 'Test Task',
      description: 'Test description',
      domainId: defaultDomainId,
      priority: 'must-do',
      estimatedMinutes: 30,
      status: 'todo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning();

    // Create sync metadata
    await db.insert(schema.taskSyncMetadata).values({
      taskId: task.id,
      googleTaskId: 'google-task-123',
      isFixed: false,
      syncStatus: 'synced',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Add operation to queue
    await db.insert(schema.syncQueue).values({
      userId,
      operation: 'complete',
      entityType: 'task',
      entityId: task.id,
      payload: JSON.stringify({}),
      status: 'pending',
      retryCount: 1,
      nextRetryAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Mock Google API to succeed
    vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue({} as any);
    const mockCompleteTask = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(syncEngine as any, 'tasksClient', 'get').mockReturnValue({
      completeTask: mockCompleteTask,
    });

    // Process retry queue
    await syncEngine.retryFailedOperations();

    // Verify log entry was created
    const logs = await db.select().from(schema.syncLog)
      .where(eq(schema.syncLog.operation, 'retry'));
    
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('success');
    expect(logs[0].entityType).toBe('task');
    expect(logs[0].entityId).toBe(task.id.toString());
    
    const details = JSON.parse(logs[0].details || '{}');
    expect(details.operation).toBe('complete');
    expect(details.retryCount).toBe(1);
  });
});
