import { describe, it, expect, beforeEach } from 'vitest';
import { PlanExporter } from '../plan-exporter.js';
import { GoogleCalendarClient } from '../google-calendar-client.js';
import { TodayPlanItem } from '../planner.js';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../db/schema.js';

/**
 * Unit tests for Plan Exporter
 * 
 * Tests encoding functions for task titles and descriptions.
 * 
 * Requirements: 1.1, 1.2, 1.3
 */

describe('PlanExporter - Encoding Functions', () => {
  let exporter: PlanExporter;
  let mockCalendarClient: GoogleCalendarClient;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(() => {
    // Create in-memory database for testing
    const sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema });
    
    mockCalendarClient = new GoogleCalendarClient();
    exporter = new PlanExporter(mockCalendarClient, db);
  });

  describe('encodeTaskTitle', () => {
    it('should encode must-do task with [!!!] marker', () => {
      const item: TodayPlanItem = {
        taskId: 1,
        task: {
          id: 1,
          title: 'Call Mom',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 15,
          dueDate: null,
          status: 'todo',
          rrule: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        category: 'must-do',
      };

      const encoded = exporter.encodeTaskTitle(item);
      expect(encoded).toBe('[!!!] Call Mom (15m)');
    });

    it('should encode should-do task with [!!] marker', () => {
      const item: TodayPlanItem = {
        taskId: 2,
        task: {
          id: 2,
          title: 'Pay bills',
          description: null,
          domainId: 2,
          priority: 'should-do',
          estimatedMinutes: 10,
          dueDate: null,
          status: 'todo',
          rrule: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        category: 'must-do',
      };

      const encoded = exporter.encodeTaskTitle(item);
      expect(encoded).toBe('[!!] Pay bills (10m)');
    });

    it('should encode nice-to-have task with [!] marker', () => {
      const item: TodayPlanItem = {
        taskId: 3,
        task: {
          id: 3,
          title: 'Read article',
          description: null,
          domainId: 3,
          priority: 'nice-to-have',
          estimatedMinutes: 20,
          dueDate: null,
          status: 'todo',
          rrule: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        category: 'want-to',
      };

      const encoded = exporter.encodeTaskTitle(item);
      expect(encoded).toBe('[!] Read article (20m)');
    });

    it('should handle tasks with long durations', () => {
      const item: TodayPlanItem = {
        taskId: 4,
        task: {
          id: 4,
          title: 'Deep work session',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 120,
          dueDate: null,
          status: 'todo',
          rrule: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        category: 'must-do',
      };

      const encoded = exporter.encodeTaskTitle(item);
      expect(encoded).toBe('[!!!] Deep work session (120m)');
    });
  });

  describe('encodeTaskDescription', () => {
    it('should encode task description with all metadata', () => {
      const item: TodayPlanItem = {
        taskId: 42,
        task: {
          id: 42,
          title: 'Call Mom',
          description: 'Weekly check-in call',
          domainId: 5,
          priority: 'must-do',
          estimatedMinutes: 15,
          dueDate: null,
          status: 'todo',
          rrule: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        category: 'must-do',
      };

      const encoded = exporter.encodeTaskDescription(item, 'Relationships');
      
      expect(encoded).toContain('Domain: Relationships');
      expect(encoded).toContain('Task ID: 42');
      expect(encoded).toContain('Category: must-do');
      expect(encoded).toContain('Status: pending');
      expect(encoded).toContain('Weekly check-in call');
    });

    it('should encode task without description', () => {
      const item: TodayPlanItem = {
        taskId: 10,
        task: {
          id: 10,
          title: 'Exercise',
          description: null,
          domainId: 3,
          priority: 'should-do',
          estimatedMinutes: 30,
          dueDate: null,
          status: 'todo',
          rrule: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        category: 'health',
      };

      const encoded = exporter.encodeTaskDescription(item, 'Health');
      
      expect(encoded).toContain('Domain: Health');
      expect(encoded).toContain('Task ID: 10');
      expect(encoded).toContain('Category: health');
      expect(encoded).toContain('Status: pending');
      expect(encoded).not.toContain('null');
    });

    it('should encode want-to category correctly', () => {
      const item: TodayPlanItem = {
        taskId: 7,
        task: {
          id: 7,
          title: 'Learn guitar',
          description: 'Practice scales',
          domainId: 8,
          priority: 'nice-to-have',
          estimatedMinutes: 25,
          dueDate: null,
          status: 'todo',
          rrule: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        category: 'want-to',
      };

      const encoded = exporter.encodeTaskDescription(item, 'Creative');
      
      expect(encoded).toContain('Category: want-to');
    });

    it('should format description with proper line breaks', () => {
      const item: TodayPlanItem = {
        taskId: 1,
        task: {
          id: 1,
          title: 'Task',
          description: 'Multi-line\ndescription',
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 10,
          dueDate: null,
          status: 'todo',
          rrule: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        category: 'must-do',
      };

      const encoded = exporter.encodeTaskDescription(item, 'Test');
      const lines = encoded.split('\n');
      
      // Should have metadata lines, blank line, then description
      expect(lines[0]).toBe('Domain: Test');
      expect(lines[1]).toBe('Task ID: 1');
      expect(lines[2]).toBe('Category: must-do');
      expect(lines[3]).toBe('Status: pending');
      expect(lines[4]).toBe('');
      expect(lines[5]).toBe('Multi-line');
    });
  });
});
