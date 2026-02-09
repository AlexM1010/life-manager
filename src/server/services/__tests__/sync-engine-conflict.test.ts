/**
 * Unit Tests: Sync Engine - Conflict Detection and Resolution
 * 
 * Tests conflict detection for overlapping calendar events and
 * the "Life Manager wins" conflict resolution strategy.
 * 
 * Requirements: 8.1, 8.5, 10.1, 10.2, 10.3, 10.4, 10.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../db/schema.js';
import { SyncEngine } from '../sync-engine.js';
import { OAuthManager } from '../oauth-manager.js';
import { CalendarEvent } from '../google-calendar-client.js';

describe('SyncEngine - Conflict Detection and Resolution', () => {
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
    
    // Create sync engine with retry disabled for testing
    syncEngine = new SyncEngine(db, oauthManager, userId, defaultDomainId, {
      retries: 0, // Disable retries for testing
    });
  });

  describe('Overlap Detection', () => {
    it('should detect overlap when events have overlapping time ranges', async () => {
      // Create two overlapping events
      const event1: CalendarEvent = {
        id: 'event1',
        summary: 'Meeting 1',
        start: new Date('2024-01-15T10:00:00Z'),
        end: new Date('2024-01-15T11:00:00Z'),
      };

      const event2: CalendarEvent = {
        id: 'event2',
        summary: 'Meeting 2',
        start: new Date('2024-01-15T10:30:00Z'),
        end: new Date('2024-01-15T11:30:00Z'),
      };

      const conflicts = await syncEngine.detectConflicts([event1, event2]);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe('overlap');
      expect(conflicts[0].entities).toContain('event1');
      expect(conflicts[0].entities).toContain('event2');
      expect(conflicts[0].description).toContain('Meeting 1');
      expect(conflicts[0].description).toContain('Meeting 2');
    });

    it('should not detect overlap when events are adjacent but not overlapping', async () => {
      const event1: CalendarEvent = {
        id: 'event1',
        summary: 'Meeting 1',
        start: new Date('2024-01-15T10:00:00Z'),
        end: new Date('2024-01-15T11:00:00Z'),
      };

      const event2: CalendarEvent = {
        id: 'event2',
        summary: 'Meeting 2',
        start: new Date('2024-01-15T11:00:00Z'),
        end: new Date('2024-01-15T12:00:00Z'),
      };

      const conflicts = await syncEngine.detectConflicts([event1, event2]);

      expect(conflicts).toHaveLength(0);
    });

    it('should not detect overlap when events are completely separate', async () => {
      const event1: CalendarEvent = {
        id: 'event1',
        summary: 'Meeting 1',
        start: new Date('2024-01-15T10:00:00Z'),
        end: new Date('2024-01-15T11:00:00Z'),
      };

      const event2: CalendarEvent = {
        id: 'event2',
        summary: 'Meeting 2',
        start: new Date('2024-01-15T14:00:00Z'),
        end: new Date('2024-01-15T15:00:00Z'),
      };

      const conflicts = await syncEngine.detectConflicts([event1, event2]);

      expect(conflicts).toHaveLength(0);
    });

    it('should detect overlap when one event is completely contained within another', async () => {
      const event1: CalendarEvent = {
        id: 'event1',
        summary: 'All Day Workshop',
        start: new Date('2024-01-15T09:00:00Z'),
        end: new Date('2024-01-15T17:00:00Z'),
      };

      const event2: CalendarEvent = {
        id: 'event2',
        summary: 'Lunch Break',
        start: new Date('2024-01-15T12:00:00Z'),
        end: new Date('2024-01-15T13:00:00Z'),
      };

      const conflicts = await syncEngine.detectConflicts([event1, event2]);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe('overlap');
    });

    it('should detect multiple overlaps in a set of events', async () => {
      const event1: CalendarEvent = {
        id: 'event1',
        summary: 'Meeting 1',
        start: new Date('2024-01-15T10:00:00Z'),
        end: new Date('2024-01-15T11:00:00Z'),
      };

      const event2: CalendarEvent = {
        id: 'event2',
        summary: 'Meeting 2',
        start: new Date('2024-01-15T10:30:00Z'),
        end: new Date('2024-01-15T11:30:00Z'),
      };

      const event3: CalendarEvent = {
        id: 'event3',
        summary: 'Meeting 3',
        start: new Date('2024-01-15T10:45:00Z'),
        end: new Date('2024-01-15T11:45:00Z'),
      };

      const conflicts = await syncEngine.detectConflicts([event1, event2, event3]);

      // Should detect 3 conflicts: 1-2, 1-3, 2-3
      expect(conflicts).toHaveLength(3);
      expect(conflicts.every(c => c.type === 'overlap')).toBe(true);
    });

    it('should handle empty event list', async () => {
      const conflicts = await syncEngine.detectConflicts([]);
      expect(conflicts).toHaveLength(0);
    });

    it('should handle single event', async () => {
      const event: CalendarEvent = {
        id: 'event1',
        summary: 'Meeting',
        start: new Date('2024-01-15T10:00:00Z'),
        end: new Date('2024-01-15T11:00:00Z'),
      };

      const conflicts = await syncEngine.detectConflicts([event]);
      expect(conflicts).toHaveLength(0);
    });

    it('should detect overlap when events start at the same time', async () => {
      const event1: CalendarEvent = {
        id: 'event1',
        summary: 'Meeting 1',
        start: new Date('2024-01-15T10:00:00Z'),
        end: new Date('2024-01-15T11:00:00Z'),
      };

      const event2: CalendarEvent = {
        id: 'event2',
        summary: 'Meeting 2',
        start: new Date('2024-01-15T10:00:00Z'),
        end: new Date('2024-01-15T11:30:00Z'),
      };

      const conflicts = await syncEngine.detectConflicts([event1, event2]);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe('overlap');
    });

    it('should detect overlap when events end at the same time', async () => {
      const event1: CalendarEvent = {
        id: 'event1',
        summary: 'Meeting 1',
        start: new Date('2024-01-15T10:00:00Z'),
        end: new Date('2024-01-15T11:00:00Z'),
      };

      const event2: CalendarEvent = {
        id: 'event2',
        summary: 'Meeting 2',
        start: new Date('2024-01-15T10:30:00Z'),
        end: new Date('2024-01-15T11:00:00Z'),
      };

      const conflicts = await syncEngine.detectConflicts([event1, event2]);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe('overlap');
    });
  });

  describe('Conflict Resolution', () => {
    it('should log conflicts when resolving', async () => {
      const conflict = {
        type: 'overlap' as const,
        entities: ['event1', 'event2'],
        description: 'Test conflict',
      };

      await syncEngine.resolveConflicts([conflict]);

      // Check that conflict was logged
      const logs = sqlite.prepare('SELECT * FROM sync_log WHERE operation = ?').all('conflict');
      expect(logs).toHaveLength(1);
      expect(logs[0].entity_type).toBe('event');
      expect(logs[0].status).toBe('failure');
      
      const details = JSON.parse(logs[0].details);
      expect(details.type).toBe('overlap');
      expect(details.description).toBe('Test conflict');
      expect(details.entities).toEqual(['event1', 'event2']);
    });

    it('should log multiple conflicts', async () => {
      const conflicts = [
        {
          type: 'overlap' as const,
          entities: ['event1', 'event2'],
          description: 'Conflict 1',
        },
        {
          type: 'overlap' as const,
          entities: ['event2', 'event3'],
          description: 'Conflict 2',
        },
      ];

      await syncEngine.resolveConflicts(conflicts);

      const logs = sqlite.prepare('SELECT * FROM sync_log WHERE operation = ?').all('conflict');
      expect(logs).toHaveLength(2);
    });

    it('should handle empty conflict list', async () => {
      await syncEngine.resolveConflicts([]);

      const logs = sqlite.prepare('SELECT * FROM sync_log WHERE operation = ?').all('conflict');
      expect(logs).toHaveLength(0);
    });
  });

  describe('Import with Conflict Detection', () => {
    it('should detect and log conflicts during import', async () => {
      // Mock OAuth client
      const mockOAuth2Client = {};
      vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue(mockOAuth2Client);

      // Mock calendar client to return overlapping events
      const overlappingEvents: CalendarEvent[] = [
        {
          id: 'event1',
          summary: 'Meeting 1',
          start: new Date('2024-01-15T10:00:00Z'),
          end: new Date('2024-01-15T11:00:00Z'),
        },
        {
          id: 'event2',
          summary: 'Meeting 2',
          start: new Date('2024-01-15T10:30:00Z'),
          end: new Date('2024-01-15T11:30:00Z'),
        },
      ];

      // Directly mock the clients on the sync engine instance
      (syncEngine as any).calendarClient = {
        getTodayEvents: vi.fn().mockResolvedValue(overlappingEvents),
      };
      (syncEngine as any).tasksClient = {
        getTodayTasks: vi.fn().mockResolvedValue([]),
      };

      const result = await syncEngine.importFromGoogle();

      // Should detect 1 conflict
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].type).toBe('overlap');
      expect(result.conflicts[0].entities).toContain('event1');
      expect(result.conflicts[0].entities).toContain('event2');

      // Should still import both events
      expect(result.calendarEventsImported).toBe(2);

      // Should log the conflict
      const logs = sqlite.prepare('SELECT * FROM sync_log WHERE operation = ?').all('conflict');
      expect(logs).toHaveLength(1);
    });

    it('should import all events even when conflicts exist', async () => {
      const mockOAuth2Client = {};
      vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue(mockOAuth2Client);

      const overlappingEvents: CalendarEvent[] = [
        {
          id: 'event1',
          summary: 'Meeting 1',
          start: new Date('2024-01-15T10:00:00Z'),
          end: new Date('2024-01-15T11:00:00Z'),
        },
        {
          id: 'event2',
          summary: 'Meeting 2',
          start: new Date('2024-01-15T10:30:00Z'),
          end: new Date('2024-01-15T11:30:00Z'),
        },
        {
          id: 'event3',
          summary: 'Meeting 3',
          start: new Date('2024-01-15T14:00:00Z'),
          end: new Date('2024-01-15T15:00:00Z'),
        },
      ];

      // Directly mock the clients on the sync engine instance
      (syncEngine as any).calendarClient = {
        getTodayEvents: vi.fn().mockResolvedValue(overlappingEvents),
      };
      (syncEngine as any).tasksClient = {
        getTodayTasks: vi.fn().mockResolvedValue([]),
      };

      const result = await syncEngine.importFromGoogle();

      // Should detect 1 conflict (event1 and event2)
      expect(result.conflicts).toHaveLength(1);

      // Should import all 3 events
      expect(result.calendarEventsImported).toBe(3);

      // Verify all tasks were created
      const tasks = sqlite.prepare('SELECT * FROM tasks').all();
      expect(tasks).toHaveLength(3);
    });

    it('should not detect conflicts when events do not overlap', async () => {
      const mockOAuth2Client = {};
      vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue(mockOAuth2Client);

      const nonOverlappingEvents: CalendarEvent[] = [
        {
          id: 'event1',
          summary: 'Meeting 1',
          start: new Date('2024-01-15T10:00:00Z'),
          end: new Date('2024-01-15T11:00:00Z'),
        },
        {
          id: 'event2',
          summary: 'Meeting 2',
          start: new Date('2024-01-15T14:00:00Z'),
          end: new Date('2024-01-15T15:00:00Z'),
        },
      ];

      // Directly mock the clients on the sync engine instance
      (syncEngine as any).calendarClient = {
        getTodayEvents: vi.fn().mockResolvedValue(nonOverlappingEvents),
      };
      (syncEngine as any).tasksClient = {
        getTodayTasks: vi.fn().mockResolvedValue([]),
      };

      const result = await syncEngine.importFromGoogle();

      // Should not detect any conflicts
      expect(result.conflicts).toHaveLength(0);

      // Should import both events
      expect(result.calendarEventsImported).toBe(2);

      // Should not log any conflicts
      const logs = sqlite.prepare('SELECT * FROM sync_log WHERE operation = ?').all('conflict');
      expect(logs).toHaveLength(0);
    });
  });

  describe('Life Manager Wins Strategy', () => {
    it('should enforce Life Manager wins during real-time sync', async () => {
      // This is enforced by the export operations always overwriting Google data
      // The strategy is implicit in the design: export operations don't check Google first
      
      // Create a task
      const taskId = sqlite.prepare(`
        INSERT INTO tasks (title, description, domain_id, priority, estimated_minutes, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('Test Task', 'Description', defaultDomainId, 'must-do', 60, 'todo').lastInsertRowid as number;

      // Create sync metadata with Google IDs
      sqlite.prepare(`
        INSERT INTO task_sync_metadata (task_id, google_task_id, google_event_id, is_fixed, sync_status, retry_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(taskId, 'google-task-123', 'google-event-456', 0, 'synced', 0);

      const mockOAuth2Client = {};
      vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue(mockOAuth2Client);

      // Mock the update methods
      const updateTaskMock = vi.fn().mockResolvedValue(undefined);
      const updateEventMock = vi.fn().mockResolvedValue(undefined);
      
      (syncEngine as any).tasksClient = {
        updateTask: updateTaskMock,
      };
      (syncEngine as any).calendarClient = {
        updateEvent: updateEventMock,
      };

      // Export modification (Life Manager → Google)
      await syncEngine.exportTaskModification(taskId);

      // Should call update methods with Life Manager's data
      expect(updateTaskMock).toHaveBeenCalledWith(
        mockOAuth2Client,
        'google-task-123',
        expect.objectContaining({
          title: 'Test Task',
          notes: 'Description',
        })
      );

      expect(updateEventMock).toHaveBeenCalledWith(
        mockOAuth2Client,
        'google-event-456',
        expect.objectContaining({
          summary: 'Test Task',
          description: 'Description',
        })
      );
    });

    it('should only import during morning import, not during real-time sync', async () => {
      // This is enforced by the design: only importFromGoogle() imports data
      // Export operations (exportTaskCompletion, exportNewTask, exportTaskModification)
      // never import from Google - they only push to Google
      
      // The test verifies this by checking that export operations don't call
      // any import methods or check Google's current state
      
      const taskId = sqlite.prepare(`
        INSERT INTO tasks (title, description, domain_id, priority, estimated_minutes, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('Test Task', 'Description', defaultDomainId, 'must-do', 60, 'todo').lastInsertRowid as number;

      sqlite.prepare(`
        INSERT INTO task_sync_metadata (task_id, google_task_id, google_event_id, is_fixed, sync_status, retry_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(taskId, 'google-task-123', 'google-event-456', 0, 'synced', 0);

      const mockOAuth2Client = {};
      vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue(mockOAuth2Client);

      // Spy on import methods to ensure they're not called
      const getTodayEventsSpy = vi.fn();
      const getTodayTasksSpy = vi.fn();

      // Mock update methods
      (syncEngine as any).tasksClient = {
        updateTask: vi.fn().mockResolvedValue(undefined),
      };
      (syncEngine as any).calendarClient = {
        updateEvent: vi.fn().mockResolvedValue(undefined),
        getTodayEvents: getTodayEventsSpy,
      };
      (syncEngine as any).tasksClient.getTodayTasks = getTodayTasksSpy;

      // Export modification (real-time sync)
      await syncEngine.exportTaskModification(taskId);

      // Should NOT call import methods
      expect(getTodayEventsSpy).not.toHaveBeenCalled();
      expect(getTodayTasksSpy).not.toHaveBeenCalled();
    });
  });

  describe('getSyncStatus', () => {
    it('should return sync status with conflict information', async () => {
      // Create some sync logs including conflicts
      const now = new Date().toISOString();
      
      sqlite.prepare(`
        INSERT INTO sync_log (user_id, operation, entity_type, entity_id, status, details, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, 'conflict', 'event', 'event1,event2', 'failure', JSON.stringify({
        type: 'overlap',
        description: 'Test conflict',
      }), now);

      sqlite.prepare(`
        INSERT INTO sync_log (user_id, operation, entity_type, entity_id, status, details, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, 'import', 'event', null, 'success', JSON.stringify({
        count: 2,
        conflicts: 1,
      }), now);

      // Mock OAuth to return connected
      vi.spyOn(oauthManager, 'getTokens').mockResolvedValue({
        id: 1,
        userId,
        provider: 'google',
        accessToken: 'test-access',
        refreshToken: 'test-refresh',
        expiresAt: new Date(Date.now() + 3600000),
        scope: ['calendar', 'tasks'],
        createdAt: now,
        updatedAt: now,
      });
      vi.spyOn(oauthManager, 'getOAuth2Client').mockResolvedValue({});

      const status = await syncEngine.getSyncStatus();

      expect(status.isConnected).toBe(true);
      expect(status.hasTokens).toBe(true);
      expect(status.lastSyncTime).toBeTruthy();
      expect(status.pendingOperations).toBe(0);
      expect(status.failedOperations).toHaveLength(0);
    });

    it('should return isConnected false when OAuth fails', async () => {
      vi.spyOn(oauthManager, 'getTokens').mockResolvedValue(null);
      vi.spyOn(oauthManager, 'getOAuth2Client').mockRejectedValue(new Error('Not authenticated'));

      const status = await syncEngine.getSyncStatus();

      expect(status.isConnected).toBe(false);
      expect(status.hasTokens).toBe(false);
    });

    it('should return hasTokens true but isConnected false when refresh fails', async () => {
      const now = new Date().toISOString();
      
      // Tokens exist but OAuth client fails (e.g., refresh token expired)
      vi.spyOn(oauthManager, 'getTokens').mockResolvedValue({
        id: 1,
        userId,
        provider: 'google',
        accessToken: 'test-access',
        refreshToken: 'test-refresh',
        expiresAt: new Date(Date.now() + 3600000),
        scope: ['calendar', 'tasks'],
        createdAt: now,
        updatedAt: now,
      });
      vi.spyOn(oauthManager, 'getOAuth2Client').mockRejectedValue(new Error('Token refresh failed'));

      const status = await syncEngine.getSyncStatus();

      expect(status.isConnected).toBe(false);
      expect(status.hasTokens).toBe(true);
      expect(status.connectionError).toBe('Token refresh failed');
    });
  });
});
