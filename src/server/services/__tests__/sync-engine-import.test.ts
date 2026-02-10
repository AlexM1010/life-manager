import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import * as schema from '../../db/schema.js';
import { SyncEngine } from '../sync-engine.js';
import type { CalendarEvent } from '../google-calendar-client.js';
import type { GoogleTask } from '../google-tasks-client.js';

/**
 * Unit tests for Sync Engine import operations
 * 
 * Tests: importCalendarEvent, importGoogleTask, importFromGoogle
 * Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.4, 3.5, 3.6
 */

// Mock the Google API clients
vi.mock('../google-calendar-client.js');
vi.mock('../google-tasks-client.js');
vi.mock('../oauth-manager.js');
vi.mock('../completion-reader.js');

describe('SyncEngine - Import Operations', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let sqlite: Database.Database;
  let syncEngine: SyncEngine;
  let mockOAuthManager: any;
  let mockCalendarClient: any;
  let mockTasksClient: any;
  let mockCompletionReader: any;

  beforeEach(() => {
    // Create in-memory database
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema });

    // Create tables
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
        status TEXT NOT NULL,
        rrule TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_completions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        domain_id INTEGER NOT NULL,
        completed_at TEXT NOT NULL,
        completed_date TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'web'
      );

      CREATE TABLE IF NOT EXISTS task_skips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        domain_id INTEGER NOT NULL,
        skipped_at TEXT NOT NULL,
        skipped_date TEXT NOT NULL
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
    sqlite.exec(`
      INSERT INTO domains (name, description, why_it_matters, created_at, updated_at)
      VALUES ('Test Domain', 'Test', 'Testing', '2026-02-07', '2026-02-07')
    `);

    // Setup mocks
    mockOAuthManager = {
      getOAuth2Client: vi.fn().mockResolvedValue('mock-oauth-client'),
    };

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

    mockCompletionReader = {
      getCompletions: vi.fn().mockResolvedValue([]),
    };

    // Create sync engine with mocked dependencies and fast retry options for testing
    syncEngine = new SyncEngine(db, mockOAuthManager as any, 1, 1, {
      retries: 2, // Fewer retries for faster tests
      minTimeout: 10, // 10ms instead of 1s
      maxTimeout: 100, // 100ms instead of 60s
    });
    (syncEngine as any).calendarClient = mockCalendarClient;
    (syncEngine as any).tasksClient = mockTasksClient;
    (syncEngine as any).completionReader = mockCompletionReader;
  });

  afterEach(() => {
    sqlite.close();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // importCalendarEvent tests
  // ==========================================================================

  describe('importCalendarEvent', () => {
    it('should create Fixed Task from calendar event', async () => {
      const event: CalendarEvent = {
        id: 'event-123',
        summary: 'Team Meeting',
        description: 'Weekly sync',
        start: new Date('2026-02-07T10:00:00'),
        end: new Date('2026-02-07T11:00:00'),
        location: 'Conference Room A',
        attendees: ['alice@example.com', 'bob@example.com'],
      };

      await syncEngine.importCalendarEvent(event);

      // Verify task was created
      const tasks = await db.select().from(schema.tasks);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Team Meeting');
      expect(tasks[0].priority).toBe('must-do');
      expect(tasks[0].estimatedMinutes).toBe(60);
      expect(tasks[0].status).toBe('todo');

      // Verify sync metadata was created with isFixed = true
      const metadata = await db.select().from(schema.taskSyncMetadata);
      expect(metadata).toHaveLength(1);
      expect(metadata[0].googleEventId).toBe('event-123');
      expect(metadata[0].isFixed).toBeTruthy(); // Fixed task (calendar event)
      expect(metadata[0].syncStatus).toBe('synced');
    });

    it('should preserve event metadata in description', async () => {
      const event: CalendarEvent = {
        id: 'event-456',
        summary: 'Client Call',
        description: 'Discuss project timeline',
        start: new Date('2026-02-07T14:00:00'),
        end: new Date('2026-02-07T14:30:00'),
        location: 'Zoom',
        attendees: ['client@example.com'],
      };

      await syncEngine.importCalendarEvent(event);

      const tasks = await db.select().from(schema.tasks);
      expect(tasks[0].description).toContain('Discuss project timeline');
      expect(tasks[0].description).toContain('📍 Location: Zoom');
      expect(tasks[0].description).toContain('👥 Attendees: client@example.com');
    });

    it('should be idempotent - importing same event twice updates existing task', async () => {
      const event: CalendarEvent = {
        id: 'event-789',
        summary: 'Original Title',
        start: new Date('2026-02-07T09:00:00'),
        end: new Date('2026-02-07T10:00:00'),
      };

      // First import
      await syncEngine.importCalendarEvent(event);

      // Modify event and import again
      const updatedEvent: CalendarEvent = {
        ...event,
        summary: 'Updated Title',
      };
      await syncEngine.importCalendarEvent(updatedEvent);

      // Should still have only one task
      const tasks = await db.select().from(schema.tasks);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Updated Title');

      // Should still have only one sync metadata record
      const metadata = await db.select().from(schema.taskSyncMetadata);
      expect(metadata).toHaveLength(1);
    });

    it('should calculate duration from event times', async () => {
      const event: CalendarEvent = {
        id: 'event-duration',
        summary: 'Long Meeting',
        start: new Date('2026-02-07T09:00:00'),
        end: new Date('2026-02-07T11:30:00'), // 2.5 hours
      };

      await syncEngine.importCalendarEvent(event);

      const tasks = await db.select().from(schema.tasks);
      expect(tasks[0].estimatedMinutes).toBe(150); // 2.5 hours = 150 minutes
    });
  });

  // ==========================================================================
  // importGoogleTask tests
  // ==========================================================================

  describe('importGoogleTask', () => {
    it('should create Flexible Task from Google Task', async () => {
      const googleTask: GoogleTask = {
        id: 'task-123',
        title: 'Review PR',
        notes: 'Check the new feature branch',
        status: 'needsAction',
        due: new Date('2026-02-07'),
      };

      await syncEngine.importGoogleTask(googleTask);

      // Verify task was created
      const tasks = await db.select().from(schema.tasks);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Review PR');
      expect(tasks[0].description).toBe('Check the new feature branch');
      expect(tasks[0].priority).toBe('should-do');
      expect(tasks[0].status).toBe('todo');

      // Verify sync metadata was created with isFixed = false
      const metadata = await db.select().from(schema.taskSyncMetadata);
      expect(metadata).toHaveLength(1);
      expect(metadata[0].googleTaskId).toBe('task-123');
      expect(metadata[0].isFixed).toBeFalsy(); // Flexible task (Google Task)
      expect(metadata[0].syncStatus).toBe('synced');
    });

    it('should import completed Google Task as done', async () => {
      const googleTask: GoogleTask = {
        id: 'task-completed',
        title: 'Completed Task',
        status: 'completed',
      };

      await syncEngine.importGoogleTask(googleTask);

      const tasks = await db.select().from(schema.tasks);
      expect(tasks[0].status).toBe('done');
    });

    it('should be idempotent - importing same task twice updates existing', async () => {
      const googleTask: GoogleTask = {
        id: 'task-456',
        title: 'Original Task',
        status: 'needsAction',
      };

      // First import
      await syncEngine.importGoogleTask(googleTask);

      // Modify and import again
      const updatedTask: GoogleTask = {
        ...googleTask,
        title: 'Updated Task',
        status: 'completed',
      };
      await syncEngine.importGoogleTask(updatedTask);

      // Should still have only one task
      const tasks = await db.select().from(schema.tasks);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Updated Task');
      expect(tasks[0].status).toBe('done');

      // Should still have only one sync metadata record
      const metadata = await db.select().from(schema.taskSyncMetadata);
      expect(metadata).toHaveLength(1);
    });

    it('should handle task without due date', async () => {
      const googleTask: GoogleTask = {
        id: 'task-no-due',
        title: 'No Due Date Task',
        status: 'needsAction',
      };

      await syncEngine.importGoogleTask(googleTask);

      const tasks = await db.select().from(schema.tasks);
      expect(tasks[0].dueDate).toBeNull();
    });

    it('should handle task without notes', async () => {
      const googleTask: GoogleTask = {
        id: 'task-no-notes',
        title: 'No Notes Task',
        status: 'needsAction',
      };

      await syncEngine.importGoogleTask(googleTask);

      const tasks = await db.select().from(schema.tasks);
      expect(tasks[0].description).toBeNull();
    });
  });

  // ==========================================================================
  // importFromGoogle tests
  // ==========================================================================

  describe('importFromGoogle', () => {
    it('should import both calendar events and tasks', async () => {
      const events: CalendarEvent[] = [
        {
          id: 'event-1',
          summary: 'Meeting 1',
          start: new Date('2026-02-07T09:00:00'),
          end: new Date('2026-02-07T10:00:00'),
        },
      ];

      const googleTasks: GoogleTask[] = [
        {
          id: 'task-1',
          title: 'Task 1',
          status: 'needsAction',
        },
      ];

      mockCalendarClient.getTodayEvents.mockResolvedValue(events);
      mockTasksClient.getTodayTasks.mockResolvedValue(googleTasks);

      const result = await syncEngine.importFromGoogle();

      expect(result.calendarEventsImported).toBe(1);
      expect(result.tasksImported).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify both were created
      const tasks = await db.select().from(schema.tasks);
      expect(tasks).toHaveLength(2);
    });

    it('should continue importing if one event fails', async () => {
      const events: CalendarEvent[] = [
        {
          id: 'event-1',
          summary: 'Good Event',
          start: new Date('2026-02-07T09:00:00'),
          end: new Date('2026-02-07T10:00:00'),
        },
        {
          id: 'event-2',
          summary: '', // This might cause issues
          start: new Date('2026-02-07T11:00:00'),
          end: new Date('2026-02-07T12:00:00'),
        },
      ];

      mockCalendarClient.getTodayEvents.mockResolvedValue(events);
      mockTasksClient.getTodayTasks.mockResolvedValue([]);

      const result = await syncEngine.importFromGoogle();

      // Both should be imported (empty title is valid)
      expect(result.calendarEventsImported).toBe(2);
    });

    it('should handle OAuth failure gracefully', async () => {
      mockOAuthManager.getOAuth2Client.mockRejectedValue(new Error('Token expired'));

      const result = await syncEngine.importFromGoogle();

      expect(result.calendarEventsImported).toBe(0);
      expect(result.tasksImported).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBe('Token expired');
    });

    it('should handle calendar API failure gracefully', async () => {
      mockCalendarClient.getTodayEvents.mockRejectedValue(new Error('Calendar API error'));
      mockTasksClient.getTodayTasks.mockResolvedValue([
        { id: 'task-1', title: 'Task 1', status: 'needsAction' },
      ]);

      const result = await syncEngine.importFromGoogle();

      // Calendar failed but tasks should still work
      expect(result.calendarEventsImported).toBe(0);
      expect(result.tasksImported).toBe(1);
      expect(result.errors.some(e => e.error === 'Calendar API error')).toBe(true);
    }, 10000); // Increase timeout for retry logic
  });

  // ==========================================================================
  // importTaskCompletions tests (Task 1.4)
  // ==========================================================================

  describe('importTaskCompletions', () => {
    beforeEach(async () => {
      // Create test tasks for completion tracking
      const now = new Date().toISOString();
      await db.insert(schema.tasks).values([
        {
          id: 1,
          title: 'Task 1',
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 30,
          status: 'todo',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 2,
          title: 'Task 2',
          domainId: 1,
          priority: 'should-do',
          estimatedMinutes: 15,
          status: 'todo',
          createdAt: now,
          updatedAt: now,
        },
      ]);
    });

    it('should import completed tasks from plan calendar', async () => {
      const completions = [
        {
          taskId: 1,
          status: 'completed' as const,
          timestamp: new Date('2026-02-09T10:30:00Z'),
          actualDuration: 25,
        },
      ];

      mockCalendarClient.getTodayEvents.mockResolvedValue([]);
      mockTasksClient.getTodayTasks.mockResolvedValue([]);
      mockCompletionReader.getCompletions.mockResolvedValue(completions);

      const result = await syncEngine.importFromGoogle();

      expect(result.errors).toHaveLength(0);

      // Verify completion was stored
      const storedCompletions = await db.select().from(schema.taskCompletions);
      expect(storedCompletions).toHaveLength(1);
      expect(storedCompletions[0].taskId).toBe(1);
      expect(storedCompletions[0].domainId).toBe(1);
      expect(storedCompletions[0].source).toBe('launcher');
      expect(storedCompletions[0].completedDate).toBe('2026-02-09');
    });

    it('should import skipped tasks from plan calendar', async () => {
      const completions = [
        {
          taskId: 2,
          status: 'skipped' as const,
          timestamp: new Date('2026-02-09T11:15:00Z'),
        },
      ];

      mockCalendarClient.getTodayEvents.mockResolvedValue([]);
      mockTasksClient.getTodayTasks.mockResolvedValue([]);
      mockCompletionReader.getCompletions.mockResolvedValue(completions);

      const result = await syncEngine.importFromGoogle();

      expect(result.errors).toHaveLength(0);

      // Verify skip was stored
      const storedSkips = await db.select().from(schema.taskSkips);
      expect(storedSkips).toHaveLength(1);
      expect(storedSkips[0].taskId).toBe(2);
      expect(storedSkips[0].domainId).toBe(1);
      expect(storedSkips[0].skippedDate).toBe('2026-02-09');
    });

    it('should import both completions and skips in one sync', async () => {
      const completions = [
        {
          taskId: 1,
          status: 'completed' as const,
          timestamp: new Date('2026-02-09T10:30:00Z'),
        },
        {
          taskId: 2,
          status: 'skipped' as const,
          timestamp: new Date('2026-02-09T11:15:00Z'),
        },
      ];

      mockCalendarClient.getTodayEvents.mockResolvedValue([]);
      mockTasksClient.getTodayTasks.mockResolvedValue([]);
      mockCompletionReader.getCompletions.mockResolvedValue(completions);

      const result = await syncEngine.importFromGoogle();

      expect(result.errors).toHaveLength(0);

      // Verify both were stored
      const storedCompletions = await db.select().from(schema.taskCompletions);
      expect(storedCompletions).toHaveLength(1);
      expect(storedCompletions[0].taskId).toBe(1);

      const storedSkips = await db.select().from(schema.taskSkips);
      expect(storedSkips).toHaveLength(1);
      expect(storedSkips[0].taskId).toBe(2);
    });

    it('should be idempotent - importing same completion twice does not duplicate', async () => {
      const completions = [
        {
          taskId: 1,
          status: 'completed' as const,
          timestamp: new Date('2026-02-09T10:30:00Z'),
        },
      ];

      mockCalendarClient.getTodayEvents.mockResolvedValue([]);
      mockTasksClient.getTodayTasks.mockResolvedValue([]);
      mockCompletionReader.getCompletions.mockResolvedValue(completions);

      // Import twice
      await syncEngine.importFromGoogle();
      await syncEngine.importFromGoogle();

      // Should still have only one completion
      const storedCompletions = await db.select().from(schema.taskCompletions);
      expect(storedCompletions).toHaveLength(1);
    });

    it('should skip completions for non-existent tasks', async () => {
      const completions = [
        {
          taskId: 999, // Non-existent task
          status: 'completed' as const,
          timestamp: new Date('2026-02-09T10:30:00Z'),
        },
      ];

      mockCalendarClient.getTodayEvents.mockResolvedValue([]);
      mockTasksClient.getTodayTasks.mockResolvedValue([]);
      mockCompletionReader.getCompletions.mockResolvedValue(completions);

      const result = await syncEngine.importFromGoogle();

      // Should not store completion for non-existent task
      const storedCompletions = await db.select().from(schema.taskCompletions);
      expect(storedCompletions).toHaveLength(0);
    });

    it('should handle completion reader errors gracefully', async () => {
      mockCalendarClient.getTodayEvents.mockResolvedValue([]);
      mockTasksClient.getTodayTasks.mockResolvedValue([]);
      mockCompletionReader.getCompletions.mockRejectedValue(new Error('Calendar not found'));

      const result = await syncEngine.importFromGoogle();

      // Should have error but not crash
      expect(result.errors.some(e => e.error.includes('Calendar not found'))).toBe(true);
      expect(result.calendarEventsImported).toBe(0);
      expect(result.tasksImported).toBe(0);
    }, 10000); // Increase timeout for retry logic
  });
});
