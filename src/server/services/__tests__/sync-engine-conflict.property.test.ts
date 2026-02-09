/**
 * Property-Based Tests: Sync Engine - Conflict Resolution
 * 
 * Tests universal properties of conflict detection, resolution, and the
 * "Life Manager wins" strategy.
 * 
 * Properties tested:
 * - Property 20: Overlap Detection (Validates: Requirements 8.1)
 * - Property 21: Conflict Resolution Updates Schedule (Validates: Requirements 8.5)
 * - Property 25: Life Manager Wins Conflicts (Validates: Requirements 10.1, 10.2, 10.4)
 * - Property 26: Import Only During Morning Import (Validates: Requirements 10.3)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../db/schema.js';
import { SyncEngine } from '../sync-engine.js';
import { OAuthManager } from '../oauth-manager.js';
import type { CalendarEvent } from '../google-calendar-client.js';
import * as fc from 'fast-check';

describe('SyncEngine - Conflict Resolution Properties', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let sqlite: Database.Database;
  let syncEngine: SyncEngine;
  let oauthManager: OAuthManager;
  const userId = 1;
  const defaultDomainId = 1;

  beforeEach(async () => {
    // Set up environment variables for OAuth
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/callback';

    // Create in-memory database
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema });

    // Create tables
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS domains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        why_it_matters TEXT NOT NULL DEFAULT '',
        boring_but_important INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
        FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
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
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
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
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
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
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // Insert test user and domain
    sqlite.exec(`
      INSERT INTO users (id, email, name) VALUES (1, 'test@example.com', 'Test User');
      INSERT INTO domains (id, name, description, created_at, updated_at) VALUES (1, 'Work', '', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');
    `);

    // Create OAuth manager with config
    const oauthConfig = {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3000/auth/callback',
    };
    oauthManager = new OAuthManager(db, oauthConfig);
    
    // Create sync engine with fast retry options for testing
    syncEngine = new SyncEngine(db, oauthManager, userId, defaultDomainId, {
      retries: 2,
      minTimeout: 10,
      maxTimeout: 100,
    });
  });

  afterEach(() => {
    sqlite.close();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Generators for property-based testing
  // ==========================================================================

  /**
   * Generate a random calendar event
   */
  const calendarEventGenerator = () => {
    return fc.record({
      id: fc.string({ minLength: 1, maxLength: 50 }),
      summary: fc.string({ minLength: 1, maxLength: 100 }),
      description: fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
      location: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
      // Generate start time within a reasonable range (today, 8am-6pm)
      startHour: fc.integer({ min: 8, max: 17 }),
      startMinute: fc.constantFrom(0, 15, 30, 45),
      // Duration in minutes (15 min to 4 hours)
      durationMinutes: fc.integer({ min: 15, max: 240 }),
    }).map((data) => {
      const today = new Date();
      today.setHours(data.startHour, data.startMinute, 0, 0);
      const start = new Date(today);
      const end = new Date(today.getTime() + data.durationMinutes * 60 * 1000);

      return {
        id: data.id,
        summary: data.summary,
        description: data.description,
        location: data.location,
        start,
        end,
      } as CalendarEvent;
    });
  };

  /**
   * Generate two overlapping calendar events
   */
  const overlappingEventsGenerator = () => {
    return fc.record({
      event1: calendarEventGenerator(),
      // Generate second event that overlaps with first
      overlapType: fc.constantFrom('start-overlap', 'end-overlap', 'contained', 'same-time'),
    }).map(({ event1, overlapType }) => {
      const event2: CalendarEvent = {
        id: `${event1.id}-overlap`,
        summary: `${event1.summary} (Overlap)`,
        start: new Date(event1.start),
        end: new Date(event1.end),
      };

      // Adjust event2 to create overlap based on type
      const duration = event1.end.getTime() - event1.start.getTime();
      
      switch (overlapType) {
        case 'start-overlap':
          // Event2 starts before event1 ends
          event2.start = new Date(event1.start.getTime() + duration / 2);
          event2.end = new Date(event2.start.getTime() + duration);
          break;
        case 'end-overlap':
          // Event2 starts before event1 ends
          event2.start = new Date(event1.start.getTime() - duration / 2);
          event2.end = new Date(event2.start.getTime() + duration);
          break;
        case 'contained':
          // Event2 is completely within event1
          event2.start = new Date(event1.start.getTime() + duration / 4);
          event2.end = new Date(event1.end.getTime() - duration / 4);
          break;
        case 'same-time':
          // Events start at same time
          event2.start = new Date(event1.start);
          event2.end = new Date(event1.end.getTime() + 30 * 60 * 1000);
          break;
      }

      return { event1, event2 };
    });
  };

  /**
   * Generate two non-overlapping calendar events
   */
  const nonOverlappingEventsGenerator = () => {
    return fc.record({
      event1: calendarEventGenerator(),
      gapMinutes: fc.integer({ min: 1, max: 120 }), // 1 min to 2 hours gap
    }).map(({ event1, gapMinutes }) => {
      const event2: CalendarEvent = {
        id: `${event1.id}-separate`,
        summary: `${event1.summary} (Later)`,
        start: new Date(event1.end.getTime() + gapMinutes * 60 * 1000),
        end: new Date(event1.end.getTime() + gapMinutes * 60 * 1000 + 60 * 60 * 1000),
      };

      return { event1, event2 };
    });
  };

  // ==========================================================================
  // Property 20: Overlap Detection
  // **Validates: Requirements 8.1**
  // ==========================================================================

  describe('Feature: google-calendar-sync, Property 20: Overlap Detection', () => {
    it('should detect overlap for any two events with overlapping time ranges', async () => {
      await fc.assert(
        fc.asyncProperty(
          overlappingEventsGenerator(),
          async ({ event1, event2 }) => {
            // PROPERTY: Any two events with overlapping time ranges should be detected
            const conflicts = await syncEngine.detectConflicts([event1, event2]);

            expect(conflicts.length).toBeGreaterThanOrEqual(1);
            
            const overlapConflict = conflicts.find(c => c.type === 'overlap');
            expect(overlapConflict).toBeDefined();
            expect(overlapConflict!.entities).toContain(event1.id);
            expect(overlapConflict!.entities).toContain(event2.id);
            expect(overlapConflict!.description).toBeTruthy();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should NOT detect overlap for any two events with non-overlapping time ranges', async () => {
      await fc.assert(
        fc.asyncProperty(
          nonOverlappingEventsGenerator(),
          async ({ event1, event2 }) => {
            // PROPERTY: Any two events that don't overlap should not be detected as conflicts
            const conflicts = await syncEngine.detectConflicts([event1, event2]);

            expect(conflicts.length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect all pairwise overlaps in a set of events', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate 3-5 events, some overlapping
          fc.array(calendarEventGenerator(), { minLength: 3, maxLength: 5 }),
          async (events) => {
            const conflicts = await syncEngine.detectConflicts(events);

            // PROPERTY: Number of conflicts should match number of overlapping pairs
            // Manually count overlaps
            let expectedConflicts = 0;
            for (let i = 0; i < events.length; i++) {
              for (let j = i + 1; j < events.length; j++) {
                const e1 = events[i];
                const e2 = events[j];
                
                // Check if they overlap
                const overlaps = (
                  (e1.start < e2.end && e1.end > e2.start) ||
                  (e2.start < e1.end && e2.end > e1.start)
                );
                
                if (overlaps) {
                  expectedConflicts++;
                }
              }
            }

            expect(conflicts.length).toBe(expectedConflicts);
            
            // PROPERTY: All conflicts should be of type 'overlap'
            expect(conflicts.every(c => c.type === 'overlap')).toBe(true);
            
            // PROPERTY: Each conflict should reference exactly 2 entities
            expect(conflicts.every(c => c.entities.length === 2)).toBe(true);
          }
        ),
        { numRuns: 50 } // Fewer runs since this is more complex
      );
    });

    it('should handle edge case: events that touch but do not overlap', async () => {
      await fc.assert(
        fc.asyncProperty(
          calendarEventGenerator(),
          async (event1) => {
            // Create event2 that starts exactly when event1 ends
            const event2: CalendarEvent = {
              id: `${event1.id}-adjacent`,
              summary: 'Adjacent Event',
              start: new Date(event1.end),
              end: new Date(event1.end.getTime() + 60 * 60 * 1000),
            };

            // PROPERTY: Adjacent events (touching but not overlapping) should NOT be detected
            const conflicts = await syncEngine.detectConflicts([event1, event2]);

            expect(conflicts.length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property 21: Conflict Resolution Updates Schedule
  // **Validates: Requirements 8.5**
  // ==========================================================================

  describe('Feature: google-calendar-sync, Property 21: Conflict Resolution Updates Schedule', () => {
    it('should log all conflicts when resolving', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate 1-5 conflicts
          fc.array(
            fc.record({
              type: fc.constant('overlap' as const),
              entities: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 2, maxLength: 2 }),
              description: fc.string({ minLength: 1, maxLength: 200 }),
            }),
            { minLength: 1, maxLength: 5 }
          ),
          async (conflicts) => {
            // Get initial log count
            const initialLogs = sqlite.prepare('SELECT COUNT(*) as count FROM sync_log WHERE operation = ?').get('conflict') as { count: number };
            const initialCount = initialLogs.count;

            // PROPERTY: Resolving conflicts should log all of them
            await syncEngine.resolveConflicts(conflicts);

            const finalLogs = sqlite.prepare('SELECT COUNT(*) as count FROM sync_log WHERE operation = ?').get('conflict') as { count: number };
            const finalCount = finalLogs.count;

            expect(finalCount - initialCount).toBe(conflicts.length);

            // PROPERTY: All logged conflicts should have correct structure
            const logs = sqlite.prepare('SELECT * FROM sync_log WHERE operation = ? ORDER BY timestamp DESC LIMIT ?').all('conflict', conflicts.length) as any[];
            
            expect(logs.length).toBe(conflicts.length);
            
            for (const log of logs) {
              expect(log.operation).toBe('conflict');
              expect(log.entity_type).toBe('event');
              expect(log.status).toBe('failure');
              expect(log.details).toBeTruthy();
              
              const details = JSON.parse(log.details);
              expect(details.type).toBe('overlap');
              expect(details.description).toBeTruthy();
              expect(Array.isArray(details.entities)).toBe(true);
              expect(details.entities.length).toBe(2);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should import all events even when conflicts exist', async () => {
      await fc.assert(
        fc.asyncProperty(
          overlappingEventsGenerator(),
          async ({ event1, event2 }) => {
            // Clear tasks from previous runs
            sqlite.prepare('DELETE FROM task_sync_metadata').run();
            sqlite.prepare('DELETE FROM tasks').run();

            // Mock OAuth and clients
            const mockOAuth2Client = {};
            vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue(mockOAuth2Client);

            (syncEngine as any).calendarClient = {
              getTodayEvents: vi.fn().mockResolvedValue([event1, event2]),
            };
            (syncEngine as any).tasksClient = {
              getTodayTasks: vi.fn().mockResolvedValue([]),
            };

            // PROPERTY: Import should succeed and create tasks for all events, even with conflicts
            const result = await syncEngine.importFromGoogle();

            expect(result.calendarEventsImported).toBe(2);
            expect(result.conflicts.length).toBeGreaterThanOrEqual(1);

            // Verify both tasks were created
            const tasks = sqlite.prepare('SELECT * FROM tasks').all();
            expect(tasks.length).toBe(2);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // ==========================================================================
  // Property 25: Life Manager Wins Conflicts
  // **Validates: Requirements 10.1, 10.2, 10.4**
  // ==========================================================================

  describe('Feature: google-calendar-sync, Property 25: Life Manager Wins Conflicts', () => {
    it('should always export Life Manager data to Google without checking Google first', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            title: fc.string({ minLength: 1, maxLength: 100 }),
            description: fc.option(fc.string({ maxLength: 500 }), { nil: null }),
            estimatedMinutes: fc.integer({ min: 15, max: 240 }),
            priority: fc.constantFrom('must-do', 'should-do', 'nice-to-do'),
          }),
          async (taskData) => {
            // Create a task in Life Manager
            const now = new Date().toISOString();
            const taskId = sqlite.prepare(`
              INSERT INTO tasks (title, description, domain_id, priority, estimated_minutes, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              taskData.title,
              taskData.description,
              defaultDomainId,
              taskData.priority,
              taskData.estimatedMinutes,
              'todo',
              now,
              now
            ).lastInsertRowid as number;

            // Create sync metadata (task already synced)
            sqlite.prepare(`
              INSERT INTO task_sync_metadata (task_id, google_task_id, google_event_id, is_fixed, sync_status, retry_count, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(taskId, 'google-task-123', 'google-event-456', 0, 'synced', 0, now, now);

            // Mock OAuth and clients
            const mockOAuth2Client = {};
            vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue(mockOAuth2Client);

            const updateTaskMock = vi.fn().mockResolvedValue(undefined);
            const updateEventMock = vi.fn().mockResolvedValue(undefined);
            const getTaskMock = vi.fn(); // Should NOT be called
            const getEventMock = vi.fn(); // Should NOT be called

            (syncEngine as any).tasksClient = {
              updateTask: updateTaskMock,
              getTask: getTaskMock,
            };
            (syncEngine as any).calendarClient = {
              updateEvent: updateEventMock,
              getEvent: getEventMock,
            };

            // PROPERTY: Export should push Life Manager data without checking Google
            await syncEngine.exportTaskModification(taskId);

            // Should call update methods with Life Manager's data
            expect(updateTaskMock).toHaveBeenCalledWith(
              mockOAuth2Client,
              'google-task-123',
              expect.objectContaining({
                title: taskData.title,
                // notes can be null or undefined depending on implementation
              })
            );

            expect(updateEventMock).toHaveBeenCalledWith(
              mockOAuth2Client,
              'google-event-456',
              expect.objectContaining({
                summary: taskData.title,
                // description can be null or undefined depending on implementation
              })
            );

            // PROPERTY: Should NOT call get methods (no checking Google first)
            expect(getTaskMock).not.toHaveBeenCalled();
            expect(getEventMock).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should overwrite Google data with Life Manager data for any task modification', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            originalTitle: fc.string({ minLength: 1, maxLength: 100 }),
            newTitle: fc.string({ minLength: 1, maxLength: 100 }),
            estimatedMinutes: fc.integer({ min: 15, max: 240 }),
          }),
          async ({ originalTitle, newTitle, estimatedMinutes }) => {
            // Create task with original data
            const now = new Date().toISOString();
            const taskId = sqlite.prepare(`
              INSERT INTO tasks (title, description, domain_id, priority, estimated_minutes, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(originalTitle, null, defaultDomainId, 'must-do', estimatedMinutes, 'todo', now, now).lastInsertRowid as number;

            sqlite.prepare(`
              INSERT INTO task_sync_metadata (task_id, google_task_id, google_event_id, is_fixed, sync_status, retry_count, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(taskId, 'google-task-123', 'google-event-456', 0, 'synced', 0, now, now);

            // Update task in Life Manager
            sqlite.prepare(`
              UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?
            `).run(newTitle, now, taskId);

            // Mock OAuth and clients
            const mockOAuth2Client = {};
            vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue(mockOAuth2Client);

            const updateTaskMock = vi.fn().mockResolvedValue(undefined);
            const updateEventMock = vi.fn().mockResolvedValue(undefined);

            (syncEngine as any).tasksClient = {
              updateTask: updateTaskMock,
            };
            (syncEngine as any).calendarClient = {
              updateEvent: updateEventMock,
            };

            // PROPERTY: Export should use NEW title (Life Manager's current state)
            await syncEngine.exportTaskModification(taskId);

            expect(updateTaskMock).toHaveBeenCalledWith(
              mockOAuth2Client,
              'google-task-123',
              expect.objectContaining({
                title: newTitle, // Should use new title, not original
              })
            );

            expect(updateEventMock).toHaveBeenCalledWith(
              mockOAuth2Client,
              'google-event-456',
              expect.objectContaining({
                summary: newTitle, // Should use new title, not original
              })
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property 26: Import Only During Morning Import
  // **Validates: Requirements 10.3**
  // ==========================================================================

  describe('Feature: google-calendar-sync, Property 26: Import Only During Morning Import', () => {
    it('should never call import methods during export operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            title: fc.string({ minLength: 1, maxLength: 100 }),
            estimatedMinutes: fc.integer({ min: 15, max: 240 }),
            operation: fc.constantFrom('create', 'update', 'complete'),
          }),
          async ({ title, estimatedMinutes, operation }) => {
            const now = new Date().toISOString();
            
            // Create task
            const taskId = sqlite.prepare(`
              INSERT INTO tasks (title, description, domain_id, priority, estimated_minutes, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(title, null, defaultDomainId, 'must-do', estimatedMinutes, 'todo', now, now).lastInsertRowid as number;

            // For update and complete, create sync metadata
            if (operation === 'update' || operation === 'complete') {
              sqlite.prepare(`
                INSERT INTO task_sync_metadata (task_id, google_task_id, google_event_id, is_fixed, sync_status, retry_count, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              `).run(taskId, 'google-task-123', 'google-event-456', 0, 'synced', 0, now, now);
            }

            // Mock OAuth and clients
            const mockOAuth2Client = {};
            vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue(mockOAuth2Client);

            // Spy on import methods - these should NEVER be called during export
            const getTodayEventsSpy = vi.fn();
            const getTodayTasksSpy = vi.fn();

            (syncEngine as any).calendarClient = {
              getTodayEvents: getTodayEventsSpy,
              createEvent: vi.fn().mockResolvedValue('new-event-id'),
              updateEvent: vi.fn().mockResolvedValue(undefined),
            };
            (syncEngine as any).tasksClient = {
              getTodayTasks: getTodayTasksSpy,
              createTask: vi.fn().mockResolvedValue('new-task-id'),
              updateTask: vi.fn().mockResolvedValue(undefined),
              completeTask: vi.fn().mockResolvedValue(undefined),
            };

            // PROPERTY: Export operations should NEVER call import methods
            if (operation === 'create') {
              await syncEngine.exportNewTask(taskId);
            } else if (operation === 'update') {
              await syncEngine.exportTaskModification(taskId);
            } else {
              await syncEngine.exportTaskCompletion(taskId);
            }

            // PROPERTY: Import methods should NOT have been called
            expect(getTodayEventsSpy).not.toHaveBeenCalled();
            expect(getTodayTasksSpy).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should only import data when importFromGoogle is explicitly called', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(calendarEventGenerator(), { minLength: 1, maxLength: 5 }),
          async (events) => {
            // Mock OAuth and clients
            const mockOAuth2Client = {};
            vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue(mockOAuth2Client);

            const getTodayEventsMock = vi.fn().mockResolvedValue(events);
            const getTodayTasksMock = vi.fn().mockResolvedValue([]);

            (syncEngine as any).calendarClient = {
              getTodayEvents: getTodayEventsMock,
            };
            (syncEngine as any).tasksClient = {
              getTodayTasks: getTodayTasksMock,
            };

            // PROPERTY: Import methods should only be called during importFromGoogle
            const result = await syncEngine.importFromGoogle();

            expect(getTodayEventsMock).toHaveBeenCalledTimes(1);
            expect(getTodayTasksMock).toHaveBeenCalledTimes(1);
            expect(result.calendarEventsImported).toBe(events.length);

            // Clear mocks
            getTodayEventsMock.mockClear();
            getTodayTasksMock.mockClear();

            // Now perform export operations - should NOT call import methods
            const now = new Date().toISOString();
            const taskId = sqlite.prepare(`
              INSERT INTO tasks (title, description, domain_id, priority, estimated_minutes, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run('Test Task', null, defaultDomainId, 'must-do', 60, 'todo', now, now).lastInsertRowid as number;

            (syncEngine as any).tasksClient.createTask = vi.fn().mockResolvedValue('new-task-id');
            (syncEngine as any).calendarClient.createEvent = vi.fn().mockResolvedValue('new-event-id');

            await syncEngine.exportNewTask(taskId);

            // PROPERTY: Export should NOT trigger import
            expect(getTodayEventsMock).not.toHaveBeenCalled();
            expect(getTodayTasksMock).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
