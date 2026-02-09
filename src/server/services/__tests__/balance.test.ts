/**
 * Unit Tests for Balance Service
 * 
 * Tests specific examples and edge cases for domain balance calculation.
 */

import { describe, it, expect } from 'vitest';
import { calculateDomainBalance, type BalanceInput, type Domain, type TaskCompletion } from '../balance';

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

function createCompletion(id: number, taskId: number, domainId: number, date: string): TaskCompletion {
  return {
    id,
    taskId,
    domainId,
    completedAt: `${date}T12:00:00Z`,
    completedDate: date,
  };
}

// ============================================================================
// Unit Tests
// ============================================================================

describe('Balance Service - Unit Tests', () => {
  describe('Empty completions', () => {
    it('should flag all domains as neglected when no completions exist', () => {
      const domains = [
        createDomain(1, 'Health'),
        createDomain(2, 'Admin', true),
      ];
      
      const input: BalanceInput = {
        domains,
        taskCompletions: [],
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = calculateDomainBalance(input);
      
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        domainId: 1,
        name: 'Health',
        completions7d: 0,
        neglected: true,
      });
      expect(result[1]).toEqual({
        domainId: 2,
        name: 'Admin',
        completions7d: 0,
        neglected: true,
      });
    });
  });

  describe('Single domain', () => {
    it('should count completions correctly for a single domain', () => {
      const domains = [createDomain(1, 'Health')];
      
      const completions = [
        createCompletion(1, 1, 1, '2024-01-01'),
        createCompletion(2, 2, 1, '2024-01-03'),
        createCompletion(3, 3, 1, '2024-01-05'),
      ];
      
      const input: BalanceInput = {
        domains,
        taskCompletions: completions,
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = calculateDomainBalance(input);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        domainId: 1,
        name: 'Health',
        completions7d: 3,
        neglected: false,
      });
    });
  });

  describe('Multiple domains with varying completions', () => {
    it('should count completions per domain and flag neglected domains', () => {
      const domains = [
        createDomain(1, 'Health'),
        createDomain(2, 'Admin', true),
        createDomain(3, 'Creative'),
      ];
      
      const completions = [
        createCompletion(1, 1, 1, '2024-01-01'), // Health
        createCompletion(2, 2, 1, '2024-01-02'), // Health
        createCompletion(3, 3, 2, '2024-01-03'), // Admin
        // No completions for Creative
      ];
      
      const input: BalanceInput = {
        domains,
        taskCompletions: completions,
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = calculateDomainBalance(input);
      
      expect(result).toHaveLength(3);
      
      const healthBalance = result.find(b => b.domainId === 1);
      expect(healthBalance).toEqual({
        domainId: 1,
        name: 'Health',
        completions7d: 2,
        neglected: false,
      });
      
      const adminBalance = result.find(b => b.domainId === 2);
      expect(adminBalance).toEqual({
        domainId: 2,
        name: 'Admin',
        completions7d: 1,
        neglected: false,
      });
      
      const creativeBalance = result.find(b => b.domainId === 3);
      expect(creativeBalance).toEqual({
        domainId: 3,
        name: 'Creative',
        completions7d: 0,
        neglected: true,
      });
    });
  });

  describe('Date range filtering', () => {
    it('should only count completions within the date range', () => {
      const domains = [createDomain(1, 'Health')];
      
      const completions = [
        createCompletion(1, 1, 1, '2023-12-31'), // Before range
        createCompletion(2, 2, 1, '2024-01-01'), // Start of range
        createCompletion(3, 3, 1, '2024-01-04'), // Within range
        createCompletion(4, 4, 1, '2024-01-07'), // End of range
        createCompletion(5, 5, 1, '2024-01-08'), // After range
      ];
      
      const input: BalanceInput = {
        domains,
        taskCompletions: completions,
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = calculateDomainBalance(input);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        domainId: 1,
        name: 'Health',
        completions7d: 3, // Only completions 2, 3, 4 are counted
        neglected: false,
      });
    });

    it('should handle single-day range', () => {
      const domains = [createDomain(1, 'Health')];
      
      const completions = [
        createCompletion(1, 1, 1, '2024-01-01'),
        createCompletion(2, 2, 1, '2024-01-02'),
        createCompletion(3, 3, 1, '2024-01-03'),
      ];
      
      const input: BalanceInput = {
        domains,
        taskCompletions: completions,
        startDate: '2024-01-02',
        endDate: '2024-01-02',
      };
      
      const result = calculateDomainBalance(input);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        domainId: 1,
        name: 'Health',
        completions7d: 1, // Only completion on 2024-01-02
        neglected: false,
      });
    });
  });

  describe('Boundary cases', () => {
    it('should handle domain with exactly 1 completion (not neglected)', () => {
      const domains = [createDomain(1, 'Health')];
      
      const completions = [
        createCompletion(1, 1, 1, '2024-01-01'),
      ];
      
      const input: BalanceInput = {
        domains,
        taskCompletions: completions,
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = calculateDomainBalance(input);
      
      expect(result[0].completions7d).toBe(1);
      expect(result[0].neglected).toBe(false);
    });

    it('should handle many completions in a single domain', () => {
      const domains = [createDomain(1, 'Health')];
      
      const completions = Array.from({ length: 50 }, (_, i) => 
        createCompletion(i + 1, i + 1, 1, '2024-01-01')
      );
      
      const input: BalanceInput = {
        domains,
        taskCompletions: completions,
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = calculateDomainBalance(input);
      
      expect(result[0].completions7d).toBe(50);
      expect(result[0].neglected).toBe(false);
    });
  });

  describe('Domain ordering', () => {
    it('should return balances in the same order as input domains', () => {
      const domains = [
        createDomain(3, 'Creative'),
        createDomain(1, 'Health'),
        createDomain(2, 'Admin'),
      ];
      
      const completions = [
        createCompletion(1, 1, 1, '2024-01-01'),
        createCompletion(2, 2, 2, '2024-01-02'),
        createCompletion(3, 3, 3, '2024-01-03'),
      ];
      
      const input: BalanceInput = {
        domains,
        taskCompletions: completions,
        startDate: '2024-01-01',
        endDate: '2024-01-07',
      };
      
      const result = calculateDomainBalance(input);
      
      expect(result).toHaveLength(3);
      expect(result[0].domainId).toBe(3); // Creative
      expect(result[1].domainId).toBe(1); // Health
      expect(result[2].domainId).toBe(2); // Admin
    });
  });
});
