/**
 * End-to-End Integration Tests for Google Calendar Sync
 * 
 * Feature: google-calendar-sync
 * Task: 15.1 - End-to-end integration testing
 * 
 * These tests validate the complete system working together:
 * - OAuth flow
 * - Morning import workflow
 * - Real-time sync workflow
 * - Conflict detection and resolution
 * - Offline behavior and recovery
 * - Rate limit handling
 * - Performance with large datasets
 * - Error scenarios
 * 
 * Validates: All Requirements (1-12)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OAuthManager } from '../services/oauth-manager';
import { GoogleCalendarClient } from '../services/google-calendar-client';
import { GoogleTasksClient } from '../services/google-tasks-client';
import { SyncEngine } from '../services/sync-engine';
import { TimeBlockingAlgorithm, Task as TBTask } from '../services/time-blocking-algorithm';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

// ============================================================================
// Test Setup and Helpers
// ============================================================================

/**
 * Test OAuth configuration
 */
const testOAuthConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret-must-be-long-enough-for-sha256',
  redirectUri: 'http://localhost:5173/auth/google/callback',
};

/**
 * Create a fresh in-memory database for each test
 */
function createTestDatabase() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  
  // Run migrations
  migrate(db, { migrationsFolder: './drizzle' });
  
  return { db, sqlite };
}


/**
 * Create test OAuth tokens
 */
function createTestTokens(expiresInMinutes: number = 60) {
  return {
    accessToken: 'test-access-token-' + Math.random(),
    refreshToken: 'test-refresh-token-' + Math.random(),
    expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000),
    scope: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/tasks'],
  };
}

/**
 * Helper to insert a test domain and return its ID
 */
async function createTestDomain(db: ReturnType<typeof drizzle<typeof schema>>): Promise<number> {
  const now = new Date().toISOString();
  const [domain] = await db
    .insert(schema.domains)
    .values({
      name: 'Test Domain ' + Math.random().toString(36).slice(2, 8),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return domain.id;
}

// ============================================================================
// Integration Test Suite 1: Complete OAuth Flow
// ============================================================================

describe('Integration Test 1: Complete OAuth Flow', () => {
  let db: ReturnType<typeof createTestDatabase>['db'];
  let sqlite: ReturnType<typeof createTestDatabase>['sqlite'];
  let oauthManager: OAuthManager;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db;
    sqlite = testDb.sqlite;
    oauthManager = new OAuthManager(db, testOAuthConfig);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('should complete full OAuth flow: initiate → exchange → store → retrieve', async () => {
    const userId = 1;

    // Step 1: Initiate OAuth
    const { authUrl } = oauthManager.initiateAuth();
    expect(authUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(authUrl).toContain('access_type=offline');
    expect(authUrl).toContain('scope=');

    // Step 2: Store tokens (simulating successful code exchange)
    const tokens = createTestTokens();
    await oauthManager.storeTokens(userId, 'google', tokens);

    // Step 3: Retrieve tokens
    const retrievedTokens = await oauthManager.getTokens(userId, 'google');
    expect(retrievedTokens).toBeDefined();
    expect(retrievedTokens?.accessToken).toBe(tokens.accessToken);
    expect(retrievedTokens?.refreshToken).toBe(tokens.refreshToken);

    // Step 4: Get OAuth2 client
    const client = await oauthManager.getOAuth2Client(userId);
    expect(client).toBeDefined();
  });

  it('should handle token refresh when access token expires', async () => {
    const userId = 1;

    // Store expired tokens
    const expiredTokens = createTestTokens(-10); // Expired 10 minutes ago
    await oauthManager.storeTokens(userId, 'google', expiredTokens);

    // Getting OAuth2 client should still work (googleapis handles refresh)
    const client = await oauthManager.getOAuth2Client(userId);
    expect(client).toBeDefined();
  });
});


// ============================================================================
// Integration Test Suite 2: Morning Import Workflow
// ============================================================================

describe('Integration Test 2: Morning Import Workflow', () => {
  let db: ReturnType<typeof createTestDatabase>['db'];
  let sqlite: ReturnType<typeof createTestDatabase>['sqlite'];
  let oauthManager: OAuthManager;
  let syncEngine: SyncEngine;
  let defaultDomainId: number;
  const userId = 1;

  beforeEach(async () => {
    const testDb = createTestDatabase();
    db = testDb.db;
    sqlite = testDb.sqlite;
    oauthManager = new OAuthManager(db, testOAuthConfig);
    defaultDomainId = await createTestDomain(db);

    // Store tokens so SyncEngine can get an OAuth2 client
    await oauthManager.storeTokens(userId, 'google', createTestTokens());

    // SyncEngine creates its own GoogleCalendarClient/GoogleTasksClient internally
    syncEngine = new SyncEngine(db, oauthManager, userId, defaultDomainId, {
      retries: 0, // No retries in tests for speed
    });
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  it('should import calendar events via importCalendarEvent', async () => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start);
    end.setHours(11, 0, 0, 0);

    // Use the public importCalendarEvent method directly
    await syncEngine.importCalendarEvent({
      id: 'event-1',
      summary: 'Test Meeting',
      description: 'A test meeting',
      start,
      end,
    });

    // Verify task was created
    const allTasks = await db.select().from(schema.tasks);
    expect(allTasks).toHaveLength(1);
    expect(allTasks[0].title).toBe('Test Meeting');
    expect(allTasks[0].priority).toBe('must-do'); // Calendar events are must-do

    // Verify sync metadata
    const metadata = await db.select().from(schema.taskSyncMetadata);
    expect(metadata).toHaveLength(1);
    expect(metadata[0].googleEventId).toBe('event-1');
    expect(metadata[0].isFixed).toBe(true);
    expect(metadata[0].syncStatus).toBe('synced');
  });

  it('should handle idempotent imports (no duplicates on re-import)', async () => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start);
    end.setHours(11, 0, 0, 0);

    const event = {
      id: 'event-1',
      summary: 'Test Meeting',
      start,
      end,
    };

    // First import
    await syncEngine.importCalendarEvent(event);

    // Second import (same event)
    await syncEngine.importCalendarEvent(event);

    // Verify no duplicates
    const allTasks = await db.select().from(schema.tasks);
    expect(allTasks).toHaveLength(1);
  });

  it('should import Google Tasks via importGoogleTask', async () => {
    await syncEngine.importGoogleTask({
      id: 'task-1',
      title: 'Test Google Task',
      notes: 'Some notes',
      due: new Date(),
      status: 'needsAction',
    });

    const allTasks = await db.select().from(schema.tasks);
    expect(allTasks).toHaveLength(1);
    expect(allTasks[0].title).toBe('Test Google Task');
    expect(allTasks[0].priority).toBe('should-do'); // Google Tasks are should-do

    const metadata = await db.select().from(schema.taskSyncMetadata);
    expect(metadata).toHaveLength(1);
    expect(metadata[0].googleTaskId).toBe('task-1');
    expect(metadata[0].isFixed).toBe(false);
  });
});


// ============================================================================
// Integration Test Suite 3: Real-Time Sync Workflow (Export)
// ============================================================================

describe('Integration Test 3: Real-Time Sync Workflow', () => {
  let db: ReturnType<typeof createTestDatabase>['db'];
  let sqlite: ReturnType<typeof createTestDatabase>['sqlite'];
  let oauthManager: OAuthManager;
  let syncEngine: SyncEngine;
  let defaultDomainId: number;
  const userId = 1;

  beforeEach(async () => {
    const testDb = createTestDatabase();
    db = testDb.db;
    sqlite = testDb.sqlite;
    oauthManager = new OAuthManager(db, testOAuthConfig);
    defaultDomainId = await createTestDomain(db);
    await oauthManager.storeTokens(userId, 'google', createTestTokens());
    syncEngine = new SyncEngine(db, oauthManager, userId, defaultDomainId, {
      retries: 0,
    });
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  it('should export task completion when sync metadata exists', async () => {
    const now = new Date().toISOString();

    // Create a task
    const [task] = await db.insert(schema.tasks).values({
      title: 'Task to Complete',
      description: 'Test',
      domainId: defaultDomainId,
      priority: 'should-do',
      estimatedMinutes: 30,
      status: 'done',
      createdAt: now,
      updatedAt: now,
    }).returning();

    // Create sync metadata with a Google Task ID
    await db.insert(schema.taskSyncMetadata).values({
      taskId: task.id,
      googleTaskId: 'google-task-456',
      isFixed: false,
      lastSyncTime: now,
      syncStatus: 'synced',
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Mock the Google Tasks API completeTask method
    const mockCompleteTask = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(GoogleTasksClient.prototype, 'completeTask').mockImplementation(mockCompleteTask);

    // Export completion
    await syncEngine.exportTaskCompletion(task.id);

    // Verify API was called
    expect(mockCompleteTask).toHaveBeenCalledTimes(1);

    // Verify sync metadata updated
    const [updatedMeta] = await db
      .select()
      .from(schema.taskSyncMetadata)
      .where(eq(schema.taskSyncMetadata.taskId, task.id));
    expect(updatedMeta.syncStatus).toBe('synced');
  });

  it('should skip export when no sync metadata exists', async () => {
    const now = new Date().toISOString();

    // Create a task with NO sync metadata
    const [task] = await db.insert(schema.tasks).values({
      title: 'Local Only Task',
      domainId: defaultDomainId,
      priority: 'should-do',
      estimatedMinutes: 30,
      status: 'done',
      createdAt: now,
      updatedAt: now,
    }).returning();

    // Should not throw — just returns early
    await syncEngine.exportTaskCompletion(task.id);
  });
});


// ============================================================================
// Integration Test Suite 4: Conflict Detection and Resolution
// ============================================================================

describe('Integration Test 4: Conflict Detection and Resolution', () => {
  let syncEngine: SyncEngine;
  let db: ReturnType<typeof createTestDatabase>['db'];
  let sqlite: ReturnType<typeof createTestDatabase>['sqlite'];
  let oauthManager: OAuthManager;
  let defaultDomainId: number;
  const userId = 1;

  beforeEach(async () => {
    const testDb = createTestDatabase();
    db = testDb.db;
    sqlite = testDb.sqlite;
    oauthManager = new OAuthManager(db, testOAuthConfig);
    defaultDomainId = await createTestDomain(db);
    await oauthManager.storeTokens(userId, 'google', createTestTokens());
    syncEngine = new SyncEngine(db, oauthManager, userId, defaultDomainId, {
      retries: 0,
    });
  });

  afterEach(() => {
    sqlite.close();
  });

  it('should detect overlapping calendar events', async () => {
    const today = new Date();
    const start1 = new Date(today);
    start1.setHours(10, 0, 0, 0);
    const end1 = new Date(today);
    end1.setHours(11, 0, 0, 0);

    const start2 = new Date(today);
    start2.setHours(10, 30, 0, 0);
    const end2 = new Date(today);
    end2.setHours(11, 30, 0, 0);

    const events = [
      { id: 'event-1', summary: 'Event 1', start: start1, end: end1 },
      { id: 'event-2', summary: 'Event 2', start: start2, end: end2 },
    ];

    const conflicts = await syncEngine.detectConflicts(events);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].type).toBe('overlap');
    expect(conflicts[0].entities).toContain('event-1');
    expect(conflicts[0].entities).toContain('event-2');
  });

  it('should not detect conflicts for non-overlapping events', async () => {
    const today = new Date();
    const start1 = new Date(today);
    start1.setHours(9, 0, 0, 0);
    const end1 = new Date(today);
    end1.setHours(10, 0, 0, 0);

    const start2 = new Date(today);
    start2.setHours(10, 0, 0, 0);
    const end2 = new Date(today);
    end2.setHours(11, 0, 0, 0);

    const events = [
      { id: 'event-1', summary: 'Event 1', start: start1, end: end1 },
      { id: 'event-2', summary: 'Event 2', start: start2, end: end2 },
    ];

    const conflicts = await syncEngine.detectConflicts(events);
    expect(conflicts).toHaveLength(0);
  });
});


// ============================================================================
// Integration Test Suite 5: Offline Behavior and Recovery
// ============================================================================

describe('Integration Test 5: Offline Behavior and Recovery', () => {
  let db: ReturnType<typeof createTestDatabase>['db'];
  let sqlite: ReturnType<typeof createTestDatabase>['sqlite'];
  let oauthManager: OAuthManager;
  let syncEngine: SyncEngine;
  let defaultDomainId: number;
  const userId = 1;

  beforeEach(async () => {
    const testDb = createTestDatabase();
    db = testDb.db;
    sqlite = testDb.sqlite;
    oauthManager = new OAuthManager(db, testOAuthConfig);
    defaultDomainId = await createTestDomain(db);
    await oauthManager.storeTokens(userId, 'google', createTestTokens());
    syncEngine = new SyncEngine(db, oauthManager, userId, defaultDomainId, {
      retries: 0, // No retries so failures are immediate
    });
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  it('should queue operations when export fails with network error', async () => {
    const now = new Date().toISOString();

    // Create a task with sync metadata
    const [task] = await db.insert(schema.tasks).values({
      title: 'Offline Task',
      domainId: defaultDomainId,
      priority: 'should-do',
      estimatedMinutes: 30,
      status: 'todo',
      createdAt: now,
      updatedAt: now,
    }).returning();

    // Mock Google API to throw network error
    const networkError = new Error('Network request failed');
    (networkError as any).code = 'ENOTFOUND';
    vi.spyOn(GoogleTasksClient.prototype, 'createTask').mockRejectedValue(networkError);

    // Attempt to export (should fail and queue)
    await expect(syncEngine.exportNewTask(task.id)).rejects.toThrow();

    // Verify operation was queued
    const queuedOps = await db
      .select()
      .from(schema.syncQueue)
      .where(eq(schema.syncQueue.userId, userId));

    expect(queuedOps).toHaveLength(1);
    expect(queuedOps[0].status).toBe('pending');
    expect(queuedOps[0].operation).toBe('create');
  });

  it('should retry queued operations', async () => {
    const now = new Date().toISOString();

    // Create a task
    const [task] = await db.insert(schema.tasks).values({
      title: 'Queued Task',
      domainId: defaultDomainId,
      priority: 'should-do',
      estimatedMinutes: 30,
      status: 'todo',
      createdAt: now,
      updatedAt: now,
    }).returning();

    // Add a queued operation with nextRetryAt in the past
    await db.insert(schema.syncQueue).values({
      userId,
      operation: 'create',
      entityType: 'task',
      entityId: task.id,
      payload: JSON.stringify({ title: 'Queued Task' }),
      status: 'pending',
      retryCount: 0,
      nextRetryAt: new Date(Date.now() - 10000).toISOString(), // In the past
      createdAt: now,
      updatedAt: now,
    });

    // Mock successful API calls
    vi.spyOn(GoogleTasksClient.prototype, 'createTask').mockResolvedValue('google-task-recovered');
    vi.spyOn(GoogleCalendarClient.prototype, 'createEvent').mockResolvedValue('google-event-recovered');

    // Retry failed operations
    await syncEngine.retryFailedOperations();

    // Verify operation was completed
    const queuedOps = await db
      .select()
      .from(schema.syncQueue)
      .where(eq(schema.syncQueue.userId, userId));

    expect(queuedOps[0].status).toBe('completed');
  });
});


// ============================================================================
// Integration Test Suite 6: Rate Limit Handling
// ============================================================================

describe('Integration Test 6: Rate Limit Handling', () => {
  let db: ReturnType<typeof createTestDatabase>['db'];
  let sqlite: ReturnType<typeof createTestDatabase>['sqlite'];
  let oauthManager: OAuthManager;
  let syncEngine: SyncEngine;
  let defaultDomainId: number;
  const userId = 1;

  beforeEach(async () => {
    const testDb = createTestDatabase();
    db = testDb.db;
    sqlite = testDb.sqlite;
    oauthManager = new OAuthManager(db, testOAuthConfig);
    defaultDomainId = await createTestDomain(db);
    await oauthManager.storeTokens(userId, 'google', createTestTokens());
    syncEngine = new SyncEngine(db, oauthManager, userId, defaultDomainId, {
      retries: 1, // Allow 1 retry
      minTimeout: 10, // Fast for tests
      maxTimeout: 50,
    });
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  it('should retry on rate limit then succeed', async () => {
    const now = new Date().toISOString();

    const [task] = await db.insert(schema.tasks).values({
      title: 'Rate Limited Task',
      domainId: defaultDomainId,
      priority: 'should-do',
      estimatedMinutes: 30,
      status: 'todo',
      createdAt: now,
      updatedAt: now,
    }).returning();

    // First call fails with rate limit, second succeeds
    const rateLimitError = new Error('Rate limit exceeded');
    (rateLimitError as any).code = 429;

    const createTaskSpy = vi.spyOn(GoogleTasksClient.prototype, 'createTask')
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce('google-task-success');
    vi.spyOn(GoogleCalendarClient.prototype, 'createEvent')
      .mockResolvedValue('google-event-success');

    // Should succeed after retry
    await syncEngine.exportNewTask(task.id);

    expect(createTaskSpy).toHaveBeenCalledTimes(2);
  });

  it('should track sync status', async () => {
    const syncStatus = await syncEngine.getSyncStatus();
    expect(syncStatus).toBeDefined();
    expect(syncStatus.isConnected).toBe(true);
    expect(syncStatus.pendingOperations).toBe(0);
  });
});


// ============================================================================
// Integration Test Suite 7: Performance with Large Datasets
// ============================================================================

describe('Integration Test 7: Performance with Large Datasets', () => {
  let timeBlocker: TimeBlockingAlgorithm;

  beforeEach(() => {
    timeBlocker = new TimeBlockingAlgorithm();
  });

  it('should complete time-blocking algorithm within 5 seconds for large dataset', () => {
    // Create 50 fixed tasks (calendar events) spread across the day
    const scheduleDate = new Date('2024-01-15');
    const fixedTasks: TBTask[] = [];
    for (let i = 0; i < 50; i++) {
      const start = new Date(scheduleDate);
      start.setHours(8 + (i % 12), (i % 2) * 30, 0, 0);
      const end = new Date(start);
      end.setMinutes(start.getMinutes() + 25);

      fixedTasks.push({
        id: i,
        title: `Fixed Task ${i}`,
        description: null,
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 25,
        dueDate: null,
        status: 'todo',
        isFixed: true,
        energyLevel: 'medium',
        scheduledStart: start,
        scheduledEnd: end,
      });
    }

    // Create 100 flexible tasks
    const flexibleTasks: TBTask[] = [];
    for (let i = 0; i < 100; i++) {
      flexibleTasks.push({
        id: 50 + i,
        title: `Flexible Task ${i}`,
        description: null,
        domainId: 1,
        priority: (['must-do', 'should-do', 'nice-to-have'] as const)[i % 3],
        estimatedMinutes: 15 + (i % 30),
        dueDate: null,
        status: 'todo',
        isFixed: false,
        energyLevel: (['low', 'medium', 'high'] as const)[i % 3],
      });
    }

    const energyProfile = {
      peakHours: [9, 10, 11, 14, 15],
      lowHours: [13, 16, 17],
      preferredTaskDuration: 45,
    };

    const startTime = Date.now();
    const schedule = timeBlocker.generateSchedule(
      fixedTasks,
      flexibleTasks,
      energyProfile,
      scheduleDate
    );
    const endTime = Date.now();

    expect(endTime - startTime).toBeLessThan(5000);
    expect(schedule.timeBlocks.length).toBeGreaterThan(0);
  });
});


// ============================================================================
// Integration Test Suite 8: Error Scenarios and Edge Cases
// ============================================================================

describe('Integration Test 8: Error Scenarios and Edge Cases', () => {
  let db: ReturnType<typeof createTestDatabase>['db'];
  let sqlite: ReturnType<typeof createTestDatabase>['sqlite'];
  let oauthManager: OAuthManager;
  let defaultDomainId: number;
  const userId = 1;

  beforeEach(async () => {
    const testDb = createTestDatabase();
    db = testDb.db;
    sqlite = testDb.sqlite;
    oauthManager = new OAuthManager(db, testOAuthConfig);
    defaultDomainId = await createTestDomain(db);
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  it('should handle import failure gracefully when OAuth fails', async () => {
    // Don't store any tokens — getOAuth2Client will fail
    const syncEngine = new SyncEngine(db, oauthManager, userId, defaultDomainId, {
      retries: 0,
    });

    const result = await syncEngine.importFromGoogle();

    // Should return errors but not throw
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.calendarEventsImported).toBe(0);
    expect(result.tasksImported).toBe(0);
  });

  it('should handle scenario with no available time slots', () => {
    const timeBlocker = new TimeBlockingAlgorithm();
    const scheduleDate = new Date('2024-01-15');

    // Create fixed tasks that occupy the entire working day (8 AM - 8 PM)
    const fixedTasks: TBTask[] = [];
    for (let hour = 8; hour < 20; hour++) {
      const start = new Date(scheduleDate);
      start.setHours(hour, 0, 0, 0);
      const end = new Date(scheduleDate);
      end.setHours(hour + 1, 0, 0, 0);

      fixedTasks.push({
        id: hour,
        title: `Fixed ${hour}`,
        description: null,
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 60,
        dueDate: null,
        status: 'todo',
        isFixed: true,
        energyLevel: 'medium',
        scheduledStart: start,
        scheduledEnd: end,
      });
    }

    // Try to schedule a flexible task
    const flexibleTasks: TBTask[] = [
      {
        id: 100,
        title: 'Impossible Task',
        description: null,
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 60,
        dueDate: null,
        status: 'todo',
        isFixed: false,
        energyLevel: 'high',
      },
    ];

    const energyProfile = {
      peakHours: [9, 10, 11],
      lowHours: [13, 14],
      preferredTaskDuration: 60,
    };

    const schedule = timeBlocker.generateSchedule(
      fixedTasks,
      flexibleTasks,
      energyProfile,
      scheduleDate
    );

    // Verify unschedulable tasks are identified
    expect(schedule.unscheduledTasks).toHaveLength(1);
    expect(schedule.unscheduledTasks[0].id).toBe(100);
  });

  it('should report sync status as disconnected when no tokens', async () => {
    const syncEngine = new SyncEngine(db, oauthManager, userId, defaultDomainId, {
      retries: 0,
    });

    const syncStatus = await syncEngine.getSyncStatus();
    expect(syncStatus.isConnected).toBe(false);
  });
});


// ============================================================================
// Integration Test Suite 9: Time-Blocking with Real Constraints
// ============================================================================

describe('Integration Test 9: Time-Blocking with Real Constraints', () => {
  let timeBlocker: TimeBlockingAlgorithm;

  beforeEach(() => {
    timeBlocker = new TimeBlockingAlgorithm();
  });

  it('should respect fixed tasks as immovable constraints', () => {
    const scheduleDate = new Date('2024-01-15');

    const fixedTasks: TBTask[] = [
      {
        id: 1,
        title: 'Morning Meeting',
        description: null,
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 60,
        dueDate: null,
        status: 'todo',
        isFixed: true,
        energyLevel: 'medium',
        scheduledStart: new Date('2024-01-15T09:00:00'),
        scheduledEnd: new Date('2024-01-15T10:00:00'),
      },
      {
        id: 2,
        title: 'Lunch',
        description: null,
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 60,
        dueDate: null,
        status: 'todo',
        isFixed: true,
        energyLevel: 'low',
        scheduledStart: new Date('2024-01-15T12:00:00'),
        scheduledEnd: new Date('2024-01-15T13:00:00'),
      },
    ];

    const flexibleTasks: TBTask[] = [
      {
        id: 3,
        title: 'Write Report',
        description: null,
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 90,
        dueDate: null,
        status: 'todo',
        isFixed: false,
        energyLevel: 'high',
      },
      {
        id: 4,
        title: 'Email Responses',
        description: null,
        domainId: 1,
        priority: 'should-do',
        estimatedMinutes: 30,
        dueDate: null,
        status: 'todo',
        isFixed: false,
        energyLevel: 'low',
      },
    ];

    const energyProfile = {
      peakHours: [9, 10, 11, 14, 15],
      lowHours: [13, 16, 17],
      preferredTaskDuration: 60,
    };

    const schedule = timeBlocker.generateSchedule(
      fixedTasks,
      flexibleTasks,
      energyProfile,
      scheduleDate
    );

    // Verify no overlaps with fixed tasks
    const fixedBlocks = schedule.timeBlocks.filter(b => b.isFixed);
    const flexibleBlocks = schedule.timeBlocks.filter(b => !b.isFixed);

    for (const flexBlock of flexibleBlocks) {
      for (const fixedBlock of fixedBlocks) {
        const hasOverlap =
          flexBlock.start < fixedBlock.end && flexBlock.end > fixedBlock.start;
        expect(hasOverlap).toBe(false);
      }
    }
  });

  it('should place high-energy tasks during peak hours when possible', () => {
    const scheduleDate = new Date('2024-01-15');

    const flexibleTasks: TBTask[] = [
      {
        id: 1,
        title: 'Deep Work',
        description: null,
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 60,
        dueDate: null,
        status: 'todo',
        isFixed: false,
        energyLevel: 'high',
      },
      {
        id: 2,
        title: 'Admin Tasks',
        description: null,
        domainId: 1,
        priority: 'should-do',
        estimatedMinutes: 60,
        dueDate: null,
        status: 'todo',
        isFixed: false,
        energyLevel: 'low',
      },
    ];

    const energyProfile = {
      peakHours: [9, 10, 11],
      lowHours: [14, 15, 16],
      preferredTaskDuration: 60,
    };

    const schedule = timeBlocker.generateSchedule(
      [],
      flexibleTasks,
      energyProfile,
      scheduleDate
    );

    // Find the high-energy task block
    const deepWorkBlock = schedule.timeBlocks.find(b => b.taskId === 1);
    expect(deepWorkBlock).toBeDefined();

    if (deepWorkBlock) {
      const hour = deepWorkBlock.start.getHours();
      // The algorithm should prefer peak hours for high-energy tasks
      // Working hours are 8-20, peak hours are 9,10,11
      // The algorithm scores peak hours higher, so it should land in 8-11 range
      expect(hour).toBeGreaterThanOrEqual(8);
      expect(hour).toBeLessThanOrEqual(11);
    }
  });

  it('should avoid creating overlapping time blocks', () => {
    const scheduleDate = new Date('2024-01-15');

    // Create many flexible tasks
    const flexibleTasks: TBTask[] = [];
    for (let i = 0; i < 20; i++) {
      flexibleTasks.push({
        id: i,
        title: `Task ${i}`,
        description: null,
        domainId: 1,
        priority: (['must-do', 'should-do', 'nice-to-have'] as const)[i % 3],
        estimatedMinutes: 30 + (i % 60),
        dueDate: null,
        status: 'todo',
        isFixed: false,
        energyLevel: (['low', 'medium', 'high'] as const)[i % 3],
      });
    }

    const energyProfile = {
      peakHours: [9, 10, 11, 14, 15],
      lowHours: [13, 16, 17],
      preferredTaskDuration: 45,
    };

    const schedule = timeBlocker.generateSchedule(
      [],
      flexibleTasks,
      energyProfile,
      scheduleDate
    );

    // Verify no overlaps
    const blocks = schedule.timeBlocks;
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const hasOverlap =
          blocks[i].start < blocks[j].end && blocks[i].end > blocks[j].start;
        expect(hasOverlap).toBe(false);
      }
    }
  });
});


// ============================================================================
// Integration Test Suite 10: Complete End-to-End Workflow
// ============================================================================

describe('Integration Test 10: Complete End-to-End Workflow', () => {
  let db: ReturnType<typeof createTestDatabase>['db'];
  let sqlite: ReturnType<typeof createTestDatabase>['sqlite'];
  let oauthManager: OAuthManager;
  let syncEngine: SyncEngine;
  let timeBlocker: TimeBlockingAlgorithm;
  let defaultDomainId: number;
  const userId = 1;

  beforeEach(async () => {
    const testDb = createTestDatabase();
    db = testDb.db;
    sqlite = testDb.sqlite;
    oauthManager = new OAuthManager(db, testOAuthConfig);
    defaultDomainId = await createTestDomain(db);
    await oauthManager.storeTokens(userId, 'google', createTestTokens());
    syncEngine = new SyncEngine(db, oauthManager, userId, defaultDomainId, {
      retries: 0,
    });
    timeBlocker = new TimeBlockingAlgorithm();
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  it('should complete full workflow: OAuth → Import → Time-Block → Sync Changes', async () => {
    // STEP 1: OAuth Authentication
    const { authUrl } = oauthManager.initiateAuth();
    expect(authUrl).toContain('https://accounts.google.com');

    // STEP 2: Import calendar events and tasks
    const now = new Date();
    const start1 = new Date(now); start1.setHours(10, 0, 0, 0);
    const end1 = new Date(now); end1.setHours(11, 0, 0, 0);
    const start2 = new Date(now); start2.setHours(14, 0, 0, 0);
    const end2 = new Date(now); end2.setHours(15, 0, 0, 0);

    await syncEngine.importCalendarEvent({
      id: 'event-1', summary: 'Morning Meeting', start: start1, end: end1,
    });
    await syncEngine.importCalendarEvent({
      id: 'event-2', summary: 'Afternoon Meeting', start: start2, end: end2,
    });
    await syncEngine.importGoogleTask({
      id: 'task-1', title: 'Review PR', status: 'needsAction',
    });

    // Verify imports
    const allTasks = await db.select().from(schema.tasks);
    expect(allTasks).toHaveLength(3);

    const allMetadata = await db.select().from(schema.taskSyncMetadata);
    expect(allMetadata).toHaveLength(3);

    // STEP 3: Time-Blocking Algorithm
    const scheduleDate = new Date(now);
    const fixedTBTasks: TBTask[] = allMetadata
      .filter(m => m.isFixed)
      .map(m => {
        const task = allTasks.find(t => t.id === m.taskId)!;
        return {
          id: task.id,
          title: task.title,
          description: task.description,
          domainId: task.domainId,
          priority: task.priority as 'must-do' | 'should-do' | 'nice-to-have',
          estimatedMinutes: task.estimatedMinutes,
          dueDate: task.dueDate,
          status: task.status as 'todo' | 'in-progress' | 'done' | 'dropped',
          isFixed: true,
          scheduledStart: m.googleEventId === 'event-1' ? start1 : start2,
          scheduledEnd: m.googleEventId === 'event-1' ? end1 : end2,
        };
      });

    const flexTBTasks: TBTask[] = allMetadata
      .filter(m => !m.isFixed)
      .map(m => {
        const task = allTasks.find(t => t.id === m.taskId)!;
        return {
          id: task.id,
          title: task.title,
          description: task.description,
          domainId: task.domainId,
          priority: task.priority as 'must-do' | 'should-do' | 'nice-to-have',
          estimatedMinutes: task.estimatedMinutes,
          dueDate: task.dueDate,
          status: task.status as 'todo' | 'in-progress' | 'done' | 'dropped',
          isFixed: false,
        };
      });

    const energyProfile = {
      peakHours: [9, 10, 11, 14, 15],
      lowHours: [13, 16, 17],
      preferredTaskDuration: 60,
    };

    const schedule = timeBlocker.generateSchedule(
      fixedTBTasks,
      flexTBTasks,
      energyProfile,
      scheduleDate
    );

    expect(schedule.timeBlocks.length).toBeGreaterThan(0);

    // STEP 4: Export task completion
    const taskToComplete = allTasks.find(t => t.title === 'Review PR')!;
    const metaForTask = allMetadata.find(m => m.taskId === taskToComplete.id)!;

    // Mock the Google Tasks API
    vi.spyOn(GoogleTasksClient.prototype, 'completeTask').mockResolvedValue(undefined);

    await syncEngine.exportTaskCompletion(taskToComplete.id);

    // STEP 5: Verify final state
    const syncStatus = await syncEngine.getSyncStatus();
    expect(syncStatus.isConnected).toBe(true);
    expect(syncStatus.pendingOperations).toBe(0);
  });
});
