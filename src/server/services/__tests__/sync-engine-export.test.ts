import { describe, it, expect, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import * as schema from '../../db/schema.js';
import { domains, tasks, taskSyncMetadata } from '../../db/schema.js';
import { SyncEngine } from '../sync-engine.js';
import { OAuthManager } from '../oauth-manager.js';

/**
 * Unit tests for Sync Engine export operations
 * 
 * Tests: exportTaskCompletion, exportNewTask, exportTaskModification
 * Validates: Requirements 4.1, 4.4, 5.1, 5.2, 5.5, 6.1, 6.2, 6.3, 6.5
 * 
 * Note: These tests verify the sync engine orchestrates export operations correctly
 * by checking database state changes (sync metadata updates).
 */

describe('SyncEngine - Export Operations', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let syncEngine: SyncEngine;
  let mockOAuthManager: OAuthManager;

  beforeEach(async () => {
    // Create in-memory database
    const sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema });

    // Create tables
    sqlite.exec(`
      CREATE TABLE domains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        why_it_matters TEXT NOT NULL DEFAULT '',
        boring_but_important INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE tasks (
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

      CREATE TABLE task_sync_metadata (
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

      CREATE TABLE sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        operation TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        status TEXT NOT NULL,
        details TEXT,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE oauth_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        provider TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        scope TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Insert test domain
    await db.insert(domains).values({
      name: 'Test Domain',
      description: 'Test',
      whyItMatters: 'Testing',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Mock OAuth manager - will succeed for tests with metadata, fail for tests without
    mockOAuthManager = {
      getOAuth2Client: vi.fn().mockResolvedValue({
        credentials: { access_token: 'mock-token' }
      }),
    } as any;

    // Create sync engine
    syncEngine = new SyncEngine(
      db,
      mockOAuthManager,
      1, // userId
      1  // defaultDomainId
    );

    // Mock the internal Google clients to prevent actual API calls
    (syncEngine as any).calendarClient = {
      createEvent: vi.fn().mockResolvedValue('cal-123'),
      updateEvent: vi.fn().mockResolvedValue('cal-123'),
      deleteEvent: vi.fn().mockResolvedValue(undefined),
    };

    (syncEngine as any).tasksClient = {
      createTask: vi.fn().mockResolvedValue('task-123'),
      updateTask: vi.fn().mockResolvedValue('task-123'),
      completeTask: vi.fn().mockResolvedValue(undefined),
      deleteTask: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe('exportTaskCompletion', () => {
    it('should export task completion to Google Tasks', async () => {
      const now = new Date().toISOString();
      
      // Insert test task
      const [task] = await db.insert(tasks).values({
        title: 'Test Task',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'done',
        createdAt: now,
        updatedAt: now,
      }).returning();

      await db.insert(taskSyncMetadata).values({
        taskId: task.id,
        googleTaskId: 'task-123',
        syncStatus: 'synced',
        createdAt: now,
        updatedAt: now,
      });

      // Export completion
      await syncEngine.exportTaskCompletion(task.id);

      // Verify sync metadata was updated
      const metadata = await db.select().from(taskSyncMetadata).where(
        eq(taskSyncMetadata.taskId, task.id)
      );
      expect(metadata[0].syncStatus).toBe('synced');
      expect(metadata[0].lastSyncTime).toBeTruthy();
    });

    it('should handle missing sync metadata', async () => {
      const now = new Date().toISOString();
      const [task] = await db.insert(tasks).values({
        title: 'Test Task',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        status: 'done',
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Should not throw - should return early gracefully
      await syncEngine.exportTaskCompletion(task.id);
      
      // Verify no sync metadata was created (since there was none to begin with)
      const metadata = await db.select().from(taskSyncMetadata).where(
        eq(taskSyncMetadata.taskId, task.id)
      );
      expect(metadata).toHaveLength(0);
    });
  });

  describe('exportNewTask', () => {
    it('should create task in Google Tasks and Calendar', async () => {
      const now = new Date().toISOString();
      const [task] = await db.insert(tasks).values({
        title: 'New Task',
        description: 'Task description',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 60,
        dueDate: '2026-02-10',
        createdAt: now,
        updatedAt: now,
      }).returning();

      await syncEngine.exportNewTask(task.id);

      // Verify sync metadata was created
      const metadata = await db.select().from(taskSyncMetadata).where(
        eq(taskSyncMetadata.taskId, task.id)
      );
      expect(metadata).toHaveLength(1);
      expect(metadata[0]).toMatchObject({
        googleTaskId: 'task-123',
        googleEventId: 'cal-123',
        syncStatus: 'synced',
      });
    });

    it('should handle tasks without due dates', async () => {
      const now = new Date().toISOString();
      const [task] = await db.insert(tasks).values({
        title: 'No Due Date Task',
        domainId: 1,
        priority: 'nice-to-have',
        estimatedMinutes: 30,
        createdAt: now,
        updatedAt: now,
      }).returning();

      await syncEngine.exportNewTask(task.id);

      // Should still create sync metadata
      const metadata = await db.select().from(taskSyncMetadata).where(
        eq(taskSyncMetadata.taskId, task.id)
      );
      expect(metadata).toHaveLength(1);
    });
  });

  describe('exportTaskModification', () => {
    it('should update task in Google Tasks and Calendar', async () => {
      const now = new Date().toISOString();
      const [task] = await db.insert(tasks).values({
        title: 'Updated Task',
        description: 'Updated description',
        domainId: 1,
        priority: 'should-do',
        estimatedMinutes: 45,
        createdAt: now,
        updatedAt: now,
      }).returning();

      await db.insert(taskSyncMetadata).values({
        taskId: task.id,
        googleTaskId: 'task-123',
        googleEventId: 'cal-123',
        syncStatus: 'synced',
        createdAt: now,
        updatedAt: now,
      });

      await syncEngine.exportTaskModification(task.id);

      // Verify sync metadata was updated
      const metadata = await db.select().from(taskSyncMetadata).where(
        eq(taskSyncMetadata.taskId, task.id)
      );
      expect(metadata[0].lastSyncTime).toBeTruthy();
      expect(metadata[0].syncStatus).toBe('synced');
    });

    it('should handle tasks without sync metadata', async () => {
      const now = new Date().toISOString();
      const [task] = await db.insert(tasks).values({
        title: 'Unsynced Task',
        domainId: 1,
        priority: 'must-do',
        estimatedMinutes: 30,
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Should return early gracefully
      await syncEngine.exportTaskModification(task.id);
      
      // Verify no sync metadata was created
      const metadata = await db.select().from(taskSyncMetadata).where(
        eq(taskSyncMetadata.taskId, task.id)
      );
      expect(metadata).toHaveLength(0);
    });
  });
});
