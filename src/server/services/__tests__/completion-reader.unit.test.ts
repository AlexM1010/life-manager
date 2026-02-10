import { describe, it, expect, beforeEach } from 'vitest';
import { CompletionReader } from '../completion-reader.js';
import { GoogleCalendarClient } from '../google-calendar-client.js';

/**
 * Unit tests for Completion Reader
 * 
 * Tests parsing functions for extracting completion data from calendar events.
 * 
 * Requirements: 1.2, 1.4
 */

describe('CompletionReader - Parsing Functions', () => {
  let reader: CompletionReader;
  let mockCalendarClient: GoogleCalendarClient;

  beforeEach(() => {
    mockCalendarClient = new GoogleCalendarClient();
    reader = new CompletionReader(mockCalendarClient);
  });

  describe('parseStatus', () => {
    it('should extract completed status', () => {
      const description = `Domain: Relationships
Task ID: 42
Category: must-do
Status: completed
CompletedAt: 2026-02-09T09:12:00Z`;

      const status = reader.parseStatus(description);
      expect(status).toBe('completed');
    });

    it('should extract skipped status', () => {
      const description = `Domain: Health
Task ID: 10
Category: health
Status: skipped
SkippedAt: 2026-02-09T14:30:00Z`;

      const status = reader.parseStatus(description);
      expect(status).toBe('skipped');
    });

    it('should extract pending status', () => {
      const description = `Domain: Admin
Task ID: 5
Category: must-do
Status: pending`;

      const status = reader.parseStatus(description);
      expect(status).toBe('pending');
    });

    it('should return null for missing status', () => {
      const description = `Domain: Creative
Task ID: 7
Category: want-to`;

      const status = reader.parseStatus(description);
      expect(status).toBeNull();
    });

    it('should return null for undefined description', () => {
      const status = reader.parseStatus(undefined);
      expect(status).toBeNull();
    });

    it('should return null for null description', () => {
      const status = reader.parseStatus(null);
      expect(status).toBeNull();
    });

    it('should return null for empty description', () => {
      const status = reader.parseStatus('');
      expect(status).toBeNull();
    });

    it('should handle status with extra whitespace', () => {
      const description = 'Status:   completed  ';
      const status = reader.parseStatus(description);
      expect(status).toBe('completed');
    });
  });

  describe('parseTaskId', () => {
    it('should extract task ID', () => {
      const description = `Domain: Relationships
Task ID: 42
Category: must-do
Status: completed`;

      const taskId = reader.parseTaskId(description);
      expect(taskId).toBe(42);
    });

    it('should extract single-digit task ID', () => {
      const description = 'Task ID: 5';
      const taskId = reader.parseTaskId(description);
      expect(taskId).toBe(5);
    });

    it('should extract large task ID', () => {
      const description = 'Task ID: 999999';
      const taskId = reader.parseTaskId(description);
      expect(taskId).toBe(999999);
    });

    it('should return null for missing task ID', () => {
      const description = `Domain: Health
Category: health
Status: pending`;

      const taskId = reader.parseTaskId(description);
      expect(taskId).toBeNull();
    });

    it('should return null for undefined description', () => {
      const taskId = reader.parseTaskId(undefined);
      expect(taskId).toBeNull();
    });

    it('should return null for null description', () => {
      const taskId = reader.parseTaskId(null);
      expect(taskId).toBeNull();
    });

    it('should return null for empty description', () => {
      const taskId = reader.parseTaskId('');
      expect(taskId).toBeNull();
    });

    it('should handle task ID with extra whitespace', () => {
      const description = 'Task ID:   123  ';
      const taskId = reader.parseTaskId(description);
      expect(taskId).toBe(123);
    });
  });

  describe('parseTimestamp', () => {
    it('should extract CompletedAt timestamp for completed status', () => {
      const description = `Domain: Relationships
Task ID: 42
Status: completed
CompletedAt: 2026-02-09T09:12:00Z`;

      const timestamp = reader.parseTimestamp(description, 'completed');
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp?.toISOString()).toBe('2026-02-09T09:12:00.000Z');
    });

    it('should extract SkippedAt timestamp for skipped status', () => {
      const description = `Domain: Health
Task ID: 10
Status: skipped
SkippedAt: 2026-02-09T14:30:00Z`;

      const timestamp = reader.parseTimestamp(description, 'skipped');
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp?.toISOString()).toBe('2026-02-09T14:30:00.000Z');
    });

    it('should return null when CompletedAt is missing', () => {
      const description = `Domain: Admin
Task ID: 5
Status: completed`;

      const timestamp = reader.parseTimestamp(description, 'completed');
      expect(timestamp).toBeNull();
    });

    it('should return null when SkippedAt is missing', () => {
      const description = `Domain: Creative
Task ID: 7
Status: skipped`;

      const timestamp = reader.parseTimestamp(description, 'skipped');
      expect(timestamp).toBeNull();
    });

    it('should return null for undefined description', () => {
      const timestamp = reader.parseTimestamp(undefined, 'completed');
      expect(timestamp).toBeNull();
    });

    it('should return null for null description', () => {
      const timestamp = reader.parseTimestamp(null, 'skipped');
      expect(timestamp).toBeNull();
    });

    it('should return null for empty description', () => {
      const timestamp = reader.parseTimestamp('', 'completed');
      expect(timestamp).toBeNull();
    });

    it('should handle timestamp with milliseconds', () => {
      const description = 'CompletedAt: 2026-02-09T09:12:34.567Z';
      const timestamp = reader.parseTimestamp(description, 'completed');
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp?.toISOString()).toBe('2026-02-09T09:12:34.567Z');
    });

    it('should handle timestamp with timezone offset', () => {
      const description = 'CompletedAt: 2026-02-09T09:12:00-05:00';
      const timestamp = reader.parseTimestamp(description, 'completed');
      expect(timestamp).toBeInstanceOf(Date);
      // Should parse correctly even with timezone offset
      expect(timestamp?.toISOString()).toBe('2026-02-09T14:12:00.000Z');
    });

    it('should handle timestamp with extra whitespace', () => {
      const description = 'CompletedAt:   2026-02-09T09:12:00Z  ';
      const timestamp = reader.parseTimestamp(description, 'completed');
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp?.toISOString()).toBe('2026-02-09T09:12:00.000Z');
    });
  });

  describe('parseStatus - edge cases', () => {
    it('should handle multiline descriptions', () => {
      const description = `Domain: Relationships
Task ID: 42
Category: must-do
Status: completed
CompletedAt: 2026-02-09T09:12:00Z

Weekly check-in call with Mom`;

      const status = reader.parseStatus(description);
      expect(status).toBe('completed');
    });

    it('should match first occurrence of Status', () => {
      const description = `Status: completed
Some other text with Status: pending`;

      const status = reader.parseStatus(description);
      expect(status).toBe('completed');
    });
  });

  describe('parseTaskId - edge cases', () => {
    it('should handle multiline descriptions', () => {
      const description = `Domain: Health
Task ID: 123
Category: health
Status: pending

Go for a 30-minute walk`;

      const taskId = reader.parseTaskId(description);
      expect(taskId).toBe(123);
    });

    it('should match first occurrence of Task ID', () => {
      const description = `Task ID: 42
Some other text with Task ID: 99`;

      const taskId = reader.parseTaskId(description);
      expect(taskId).toBe(42);
    });
  });

  describe('parseTimestamp - edge cases', () => {
    it('should handle multiline descriptions with timestamp', () => {
      const description = `Domain: Admin
Task ID: 5
Status: completed
CompletedAt: 2026-02-09T10:00:00Z

Pay utility bills`;

      const timestamp = reader.parseTimestamp(description, 'completed');
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp?.toISOString()).toBe('2026-02-09T10:00:00.000Z');
    });

    it('should match first occurrence of timestamp', () => {
      const description = `CompletedAt: 2026-02-09T09:00:00Z
Some other text with CompletedAt: 2026-02-09T10:00:00Z`;

      const timestamp = reader.parseTimestamp(description, 'completed');
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp?.toISOString()).toBe('2026-02-09T09:00:00.000Z');
    });
  });

  describe('Integration - Full event description parsing', () => {
    it('should parse complete event description with all fields', () => {
      const description = `Domain: Relationships
Task ID: 42
Category: must-do
Status: completed
CompletedAt: 2026-02-09T09:12:00Z
ActualDuration: 18

Weekly check-in call with Mom`;

      const status = reader.parseStatus(description);
      const taskId = reader.parseTaskId(description);
      const timestamp = reader.parseTimestamp(description, 'completed');

      expect(status).toBe('completed');
      expect(taskId).toBe(42);
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp?.toISOString()).toBe('2026-02-09T09:12:00.000Z');
    });

    it('should parse skipped event description', () => {
      const description = `Domain: Health
Task ID: 10
Category: health
Status: skipped
SkippedAt: 2026-02-09T14:30:00Z

30-minute workout`;

      const status = reader.parseStatus(description);
      const taskId = reader.parseTaskId(description);
      const timestamp = reader.parseTimestamp(description, 'skipped');

      expect(status).toBe('skipped');
      expect(taskId).toBe(10);
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp?.toISOString()).toBe('2026-02-09T14:30:00.000Z');
    });

    it('should parse pending event description', () => {
      const description = `Domain: Admin
Task ID: 5
Category: must-do
Status: pending

Pay bills`;

      const status = reader.parseStatus(description);
      const taskId = reader.parseTaskId(description);
      const timestamp = reader.parseTimestamp(description, 'completed');

      expect(status).toBe('pending');
      expect(taskId).toBe(5);
      expect(timestamp).toBeNull(); // No timestamp for pending
    });
  });
});
