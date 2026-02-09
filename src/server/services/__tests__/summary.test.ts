/**
 * Unit Tests for Summary Service
 * 
 * Tests specific examples and edge cases for weekly summary generation.
 */

import { describe, it, expect } from 'vitest';
import { generateWeeklySummary, type SummaryInput, type DailyLog, type TaskCompletion, type Domain, type Streaks, type DomainBalance } from '../summary';

// ============================================================================
// Test Helpers
// ============================================================================

function createDomain(id: number, name: string, boringButImportant = false): Domain {
  return {
    id,
    name,
    description: `${name} description`,
    whyItMatters: `${name} matters`,
    boringButImportant,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function createDailyLog(id: number, date: string, hoursSlept: number, energy: number, mood: number, medicationTaken: string): DailyLog {
  return {
    id,
    date,
    hoursSlept,
    energy,
    mood,
    medicationTaken,
    createdAt: `${date}T00:00:00Z`,
    updatedAt: `${date}T00:00:00Z`,
  };
}

function createCompletion(id: number, taskId: number, domainId: number, date: string): TaskCompletion {
  return {
    id,
    taskId,
    domainId,
    completedAt: `${date}T12:00:00Z`,
    completedDate: date,
  };
}

function createStreaks(medication: number, healthTask: number, boringButImportant: number): Streaks {
  return {
    medication,
    healthTask,
    boringButImportant,
  };
}

function createBalance(domainId: number, name: string, completions7d: number, neglected: boolean): DomainBalance {
  return {
    domainId,
    name,
    completions7d,
    neglected,
  };
}

// ============================================================================
// Unit Tests
// ============================================================================

describe('Summary Service - Unit Tests', () => {
  describe('Empty week', () => {
    it('should generate summary with no data', () => {
      const domains = [
        createDomain(1, 'Health'),
        createDomain(2, 'Admin', true),
      ];
      
      const input: SummaryInput = {
        dailyLogs: [],
        taskCompletions: [],
        domains,
        streaks: createStreaks(0, 0, 0),
        balance: [
          createBalance(1, 'Health', 0, true),
          createBalance(2, 'Admin', 0, true),
        ],
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = generateWeeklySummary(input);
      
      // Should contain header
      expect(result).toContain('WEEKLY SUMMARY');
      expect(result).toContain('Jan 1-7, 2024');
      
      // Should indicate no logs
      expect(result).toContain('No daily logs recorded for this period');
      
      // Should indicate no tasks
      expect(result).toContain('No tasks completed during this period');
      
      // Should show zero streaks
      expect(result).toContain('Medication adherence: 0 days');
      expect(result).toContain('Health tasks: 0 days');
      expect(result).toContain('Boring-but-important tasks: 0 days');
      
      // Should list neglected domains
      expect(result).toContain('Health');
      expect(result).toContain('Admin');
    });
  });

  describe('Partial week', () => {
    it('should handle partial week with some logs', () => {
      const domains = [createDomain(1, 'Health')];
      
      const dailyLogs = [
        createDailyLog(1, '2024-01-01', 7.5, 6, 7, 'yes'),
        createDailyLog(2, '2024-01-02', 8.0, 7, 8, 'yes'),
        createDailyLog(3, '2024-01-03', 6.5, 5, 6, 'no'),
      ];
      
      const input: SummaryInput = {
        dailyLogs,
        taskCompletions: [],
        domains,
        streaks: createStreaks(2, 0, 0),
        balance: [createBalance(1, 'Health', 0, true)],
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = generateWeeklySummary(input);
      
      // Should show partial logging
      expect(result).toContain('Days logged: 3 of 7');
      
      // Should calculate averages correctly
      expect(result).toContain('Average sleep: 7.3 hours');
      expect(result).toContain('Average energy: 6.0 / 10');
      expect(result).toContain('Average mood: 7.0 / 10');
      
      // Should show medication adherence
      expect(result).toContain('Medication adherence: 2 of 3 days (66.7%)');
    });
  });

  describe('Full week with data', () => {
    it('should generate complete summary with all sections', () => {
      const domains = [
        createDomain(1, 'Health'),
        createDomain(2, 'Admin', true),
        createDomain(3, 'Creative'),
      ];
      
      const dailyLogs = [
        createDailyLog(1, '2024-01-01', 7.5, 6, 7, 'yes'),
        createDailyLog(2, '2024-01-02', 8.0, 7, 8, 'yes'),
        createDailyLog(3, '2024-01-03', 6.5, 5, 6, 'yes'),
        createDailyLog(4, '2024-01-04', 7.0, 6, 7, 'yes'),
        createDailyLog(5, '2024-01-05', 8.5, 8, 9, 'yes'),
        createDailyLog(6, '2024-01-06', 7.5, 7, 8, 'yes'),
        createDailyLog(7, '2024-01-07', 7.0, 6, 7, 'yes'),
      ];
      
      const taskCompletions = [
        createCompletion(1, 1, 1, '2024-01-01'), // Health
        createCompletion(2, 2, 1, '2024-01-02'), // Health
        createCompletion(3, 3, 2, '2024-01-03'), // Admin
        createCompletion(4, 4, 3, '2024-01-04'), // Creative
        createCompletion(5, 5, 1, '2024-01-05'), // Health
      ];
      
      const input: SummaryInput = {
        dailyLogs,
        taskCompletions,
        domains,
        streaks: createStreaks(7, 5, 3),
        balance: [
          createBalance(1, 'Health', 3, false),
          createBalance(2, 'Admin', 1, false),
          createBalance(3, 'Creative', 1, false),
        ],
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = generateWeeklySummary(input);
      
      // Header
      expect(result).toContain('WEEKLY SUMMARY');
      expect(result).toContain('Jan 1-7, 2024');
      
      // Daily logs
      expect(result).toContain('Days logged: 7 of 7');
      expect(result).toContain('Average sleep: 7.4 hours');
      expect(result).toContain('Average energy: 6.4 / 10');
      expect(result).toContain('Average mood: 7.4 / 10');
      expect(result).toContain('Medication adherence: 7 of 7 days (100.0%)');
      
      // Task completion
      expect(result).toContain('Total tasks completed: 5');
      expect(result).toContain('Admin: 1 tasks (20.0%)');
      expect(result).toContain('Creative: 1 tasks (20.0%)');
      expect(result).toContain('Health: 3 tasks (60.0%)');
      
      // Streaks
      expect(result).toContain('Medication adherence: 7 days');
      expect(result).toContain('Health tasks: 5 days');
      expect(result).toContain('Boring-but-important tasks: 3 days');
      
      // Balance
      expect(result).toContain('All domains had at least one task completed this week');
    });
  });

  describe('Neglected domains', () => {
    it('should list neglected domains', () => {
      const domains = [
        createDomain(1, 'Health'),
        createDomain(2, 'Admin', true),
        createDomain(3, 'Creative'),
      ];
      
      const taskCompletions = [
        createCompletion(1, 1, 1, '2024-01-01'), // Health only
      ];
      
      const input: SummaryInput = {
        dailyLogs: [],
        taskCompletions,
        domains,
        streaks: createStreaks(0, 1, 0),
        balance: [
          createBalance(1, 'Health', 1, false),
          createBalance(2, 'Admin', 0, true),
          createBalance(3, 'Creative', 0, true),
        ],
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = generateWeeklySummary(input);
      
      expect(result).toContain('Domains with no tasks completed this week');
      expect(result).toContain('- Admin');
      expect(result).toContain('- Creative');
      expect(result).not.toContain('- Health');
    });
  });

  describe('Plain text format', () => {
    it('should not contain HTML tags', () => {
      const domains = [createDomain(1, 'Health')];
      
      const input: SummaryInput = {
        dailyLogs: [createDailyLog(1, '2024-01-01', 7, 6, 7, 'yes')],
        taskCompletions: [createCompletion(1, 1, 1, '2024-01-01')],
        domains,
        streaks: createStreaks(1, 1, 0),
        balance: [createBalance(1, 'Health', 1, false)],
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = generateWeeklySummary(input);
      
      // Should not contain HTML tags
      expect(result).not.toMatch(/<[^>]+>/);
    });

    it('should not contain markdown formatting', () => {
      const domains = [createDomain(1, 'Health')];
      
      const input: SummaryInput = {
        dailyLogs: [createDailyLog(1, '2024-01-01', 7, 6, 7, 'yes')],
        taskCompletions: [createCompletion(1, 1, 1, '2024-01-01')],
        domains,
        streaks: createStreaks(1, 1, 0),
        balance: [createBalance(1, 'Health', 1, false)],
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = generateWeeklySummary(input);
      
      // Should not contain markdown headers (except the plain text ones we use)
      expect(result).not.toMatch(/^#{1,6}\s/m);
      
      // Should not contain markdown bold/italic
      expect(result).not.toMatch(/\*\*[^*]+\*\*/);
      expect(result).not.toMatch(/\*[^*]+\*/);
      expect(result).not.toMatch(/__[^_]+__/);
      expect(result).not.toMatch(/_[^_]+_/);
      
      // Should not contain markdown code blocks
      expect(result).not.toMatch(/```/);
      expect(result).not.toMatch(/`[^`]+`/);
    });
  });

  describe('Date range formatting', () => {
    it('should format same-month range correctly', () => {
      const domains = [createDomain(1, 'Health')];
      
      const input: SummaryInput = {
        dailyLogs: [],
        taskCompletions: [],
        domains,
        streaks: createStreaks(0, 0, 0),
        balance: [createBalance(1, 'Health', 0, true)],
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = generateWeeklySummary(input);
      
      expect(result).toContain('Jan 1-7, 2024');
    });

    it('should format cross-month range correctly', () => {
      const domains = [createDomain(1, 'Health')];
      
      const input: SummaryInput = {
        dailyLogs: [],
        taskCompletions: [],
        domains,
        streaks: createStreaks(0, 0, 0),
        balance: [createBalance(1, 'Health', 0, true)],
        startDate: '2024-01-29',
        endDate: '2024-02-04',
      };
      
      const result = generateWeeklySummary(input);
      
      expect(result).toContain('Jan 29 - Feb 4, 2024');
    });
  });

  describe('Boundary values', () => {
    it('should handle perfect scores', () => {
      const domains = [createDomain(1, 'Health')];
      
      const dailyLogs = [
        createDailyLog(1, '2024-01-01', 10, 10, 10, 'yes'),
      ];
      
      const input: SummaryInput = {
        dailyLogs,
        taskCompletions: [],
        domains,
        streaks: createStreaks(1, 0, 0),
        balance: [createBalance(1, 'Health', 0, true)],
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = generateWeeklySummary(input);
      
      expect(result).toContain('Average sleep: 10.0 hours');
      expect(result).toContain('Average energy: 10.0 / 10');
      expect(result).toContain('Average mood: 10.0 / 10');
    });

    it('should handle minimum scores', () => {
      const domains = [createDomain(1, 'Health')];
      
      const dailyLogs = [
        createDailyLog(1, '2024-01-01', 0, 0, 0, 'no'),
      ];
      
      const input: SummaryInput = {
        dailyLogs,
        taskCompletions: [],
        domains,
        streaks: createStreaks(0, 0, 0),
        balance: [createBalance(1, 'Health', 0, true)],
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = generateWeeklySummary(input);
      
      expect(result).toContain('Average sleep: 0.0 hours');
      expect(result).toContain('Average energy: 0.0 / 10');
      expect(result).toContain('Average mood: 0.0 / 10');
      expect(result).toContain('Medication adherence: 0 of 1 days (0.0%)');
    });
  });

  describe('Footer', () => {
    it('should include disclaimer footer', () => {
      const domains = [createDomain(1, 'Health')];
      
      const input: SummaryInput = {
        dailyLogs: [],
        taskCompletions: [],
        domains,
        streaks: createStreaks(0, 0, 0),
        balance: [createBalance(1, 'Health', 0, true)],
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = generateWeeklySummary(input);
      
      expect(result).toContain('This summary is generated by Life Manager');
      expect(result).toContain('does not include medical advice');
    });
  });
});
