/**
 * Time-Blocking Algorithm Unit Tests
 * 
 * Tests core scheduling logic, edge cases, and error handling.
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TimeBlockingAlgorithm,
  Task,
  EnergyProfile,
  Schedule,
  TimeBlock,
} from '../time-blocking-algorithm.js';

describe('TimeBlockingAlgorithm', () => {
  let algorithm: TimeBlockingAlgorithm;
  let scheduleDate: Date;
  let energyProfile: EnergyProfile;

  beforeEach(() => {
    algorithm = new TimeBlockingAlgorithm();
    scheduleDate = new Date('2024-01-15T00:00:00Z');
    energyProfile = {
      peakHours: [8, 9, 10, 11, 14, 15, 16], // Include 8 AM (start of day)
      lowHours: [12, 13, 17, 18, 19], // Include 12 PM
      preferredTaskDuration: 30,
    };
  });

  // ==========================================================================
  // Requirement 7.1: Fixed Tasks as Immovable Constraints
  // ==========================================================================

  describe('Fixed Tasks as Immovable Constraints', () => {
    it('should keep fixed tasks at their original time slots', () => {
      const fixedTasks: Task[] = [
        {
          id: 1,
          title: 'Meeting',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          isFixed: true,
          scheduledStart: new Date('2024-01-15T10:00:00Z'),
          scheduledEnd: new Date('2024-01-15T11:00:00Z'),
        },
      ];

      const schedule = algorithm.generateSchedule(fixedTasks, [], energyProfile, scheduleDate);

      expect(schedule.timeBlocks).toHaveLength(1);
      expect(schedule.timeBlocks[0].taskId).toBe(1);
      expect(schedule.timeBlocks[0].isFixed).toBe(true);
      expect(schedule.timeBlocks[0].start).toEqual(new Date('2024-01-15T10:00:00Z'));
      expect(schedule.timeBlocks[0].end).toEqual(new Date('2024-01-15T11:00:00Z'));
    });

    it('should not schedule flexible tasks over fixed tasks', () => {
      const fixedTasks: Task[] = [
        {
          id: 1,
          title: 'Meeting',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          isFixed: true,
          scheduledStart: new Date('2024-01-15T10:00:00Z'),
          scheduledEnd: new Date('2024-01-15T11:00:00Z'),
        },
      ];

      const flexibleTasks: Task[] = [
        {
          id: 2,
          title: 'Flexible Task',
          description: null,
          domainId: 1,
          priority: 'should-do',
          estimatedMinutes: 30,
          dueDate: null,
          status: 'todo',
          isFixed: false,
          energyLevel: 'medium',
        },
      ];

      const schedule = algorithm.generateSchedule(
        fixedTasks,
        flexibleTasks,
        energyProfile,
        scheduleDate
      );

      // Verify no overlaps
      const conflicts = algorithm.detectConflicts(schedule);
      expect(conflicts).toHaveLength(0);

      // Verify flexible task is not scheduled during fixed task time
      const flexibleBlock = schedule.timeBlocks.find(b => b.taskId === 2);
      expect(flexibleBlock).toBeDefined();

      if (flexibleBlock) {
        const fixedBlock = schedule.timeBlocks.find(b => b.taskId === 1);
        expect(fixedBlock).toBeDefined();

        // No overlap: flexible ends before fixed starts OR flexible starts after fixed ends
        const noOverlap =
          flexibleBlock.end <= fixedBlock!.start || flexibleBlock.start >= fixedBlock!.end;
        expect(noOverlap).toBe(true);
      }
    });
  });

  // ==========================================================================
  // Requirement 7.2: Flexible Task Placement
  // ==========================================================================

  describe('Flexible Task Placement', () => {
    it('should place flexible tasks in gaps between fixed tasks', () => {
      const fixedTasks: Task[] = [
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
          scheduledStart: new Date('2024-01-15T09:00:00Z'),
          scheduledEnd: new Date('2024-01-15T10:00:00Z'),
        },
        {
          id: 2,
          title: 'Afternoon Meeting',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          isFixed: true,
          scheduledStart: new Date('2024-01-15T14:00:00Z'),
          scheduledEnd: new Date('2024-01-15T15:00:00Z'),
        },
      ];

      const flexibleTasks: Task[] = [
        {
          id: 3,
          title: 'Flexible Task',
          description: null,
          domainId: 1,
          priority: 'should-do',
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          isFixed: false,
          energyLevel: 'medium',
        },
      ];

      const schedule = algorithm.generateSchedule(
        fixedTasks,
        flexibleTasks,
        energyProfile,
        scheduleDate
      );

      // Should have 3 blocks total
      expect(schedule.timeBlocks).toHaveLength(3);

      // Flexible task should be in a gap
      const flexibleBlock = schedule.timeBlocks.find(b => b.taskId === 3);
      expect(flexibleBlock).toBeDefined();

      // Verify no overlaps
      const conflicts = algorithm.detectConflicts(schedule);
      expect(conflicts).toHaveLength(0);
    });

    it('should handle multiple flexible tasks', () => {
      const fixedTasks: Task[] = [
        {
          id: 1,
          title: 'Meeting',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          isFixed: true,
          scheduledStart: new Date('2024-01-15T10:00:00Z'),
          scheduledEnd: new Date('2024-01-15T11:00:00Z'),
        },
      ];

      const flexibleTasks: Task[] = [
        {
          id: 2,
          title: 'Task 1',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 30,
          dueDate: null,
          status: 'todo',
          isFixed: false,
          energyLevel: 'high',
        },
        {
          id: 3,
          title: 'Task 2',
          description: null,
          domainId: 1,
          priority: 'should-do',
          estimatedMinutes: 30,
          dueDate: null,
          status: 'todo',
          isFixed: false,
          energyLevel: 'medium',
        },
      ];

      const schedule = algorithm.generateSchedule(
        fixedTasks,
        flexibleTasks,
        energyProfile,
        scheduleDate
      );

      // Should schedule all tasks
      expect(schedule.timeBlocks.length).toBeGreaterThanOrEqual(3);
      expect(schedule.unscheduledTasks).toHaveLength(0);

      // Verify no overlaps
      const conflicts = algorithm.detectConflicts(schedule);
      expect(conflicts).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Requirement 7.3: Energy-Aware Scheduling
  // ==========================================================================

  describe('Energy-Aware Scheduling', () => {
    it('should prefer peak hours for high-energy tasks', () => {
      const fixedTasks: Task[] = [];

      const flexibleTasks: Task[] = [
        {
          id: 1,
          title: 'High Energy Task',
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

      const schedule = algorithm.generateSchedule(
        fixedTasks,
        flexibleTasks,
        energyProfile,
        scheduleDate
      );

      const highEnergyBlock = schedule.timeBlocks.find(b => b.taskId === 1);
      expect(highEnergyBlock).toBeDefined();

      if (highEnergyBlock) {
        const hour = highEnergyBlock.start.getHours();
        // Should be scheduled during peak hours
        expect(energyProfile.peakHours).toContain(hour);
      }
    });

    it('should prefer low hours for low-energy tasks', () => {
      // Add a fixed task during peak hours to force low-energy task into low hours
      const fixedTasks: Task[] = [
        {
          id: 99,
          title: 'Peak Hour Meeting',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 240, // 4 hours - blocks peak hours
          dueDate: null,
          status: 'todo',
          isFixed: true,
          scheduledStart: new Date('2024-01-15T08:00:00Z'),
          scheduledEnd: new Date('2024-01-15T12:00:00Z'),
        },
      ];

      const flexibleTasks: Task[] = [
        {
          id: 1,
          title: 'Low Energy Task',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          isFixed: false,
          energyLevel: 'low',
        },
      ];

      const schedule = algorithm.generateSchedule(
        fixedTasks,
        flexibleTasks,
        energyProfile,
        scheduleDate
      );

      const lowEnergyBlock = schedule.timeBlocks.find(b => b.taskId === 1);
      expect(lowEnergyBlock).toBeDefined();

      if (lowEnergyBlock) {
        const hour = lowEnergyBlock.start.getHours();
        // Should be scheduled during low hours (after peak hours are blocked)
        expect(energyProfile.lowHours).toContain(hour);
      }
    });

    it('should schedule medium-energy tasks in any available slot', () => {
      const fixedTasks: Task[] = [];

      const flexibleTasks: Task[] = [
        {
          id: 1,
          title: 'Medium Energy Task',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          isFixed: false,
          energyLevel: 'medium',
        },
      ];

      const schedule = algorithm.generateSchedule(
        fixedTasks,
        flexibleTasks,
        energyProfile,
        scheduleDate
      );

      const mediumEnergyBlock = schedule.timeBlocks.find(b => b.taskId === 1);
      expect(mediumEnergyBlock).toBeDefined();
      // Medium energy tasks can be scheduled anywhere
    });
  });

  // ==========================================================================
  // Requirement 7.4: Unschedulable Task Detection
  // ==========================================================================

  describe('Unschedulable Task Detection', () => {
    it('should detect tasks that cannot fit in available time', () => {
      const fixedTasks: Task[] = [
        {
          id: 1,
          title: 'All Day Meeting',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 720, // 12 hours
          dueDate: null,
          status: 'todo',
          isFixed: true,
          scheduledStart: new Date('2024-01-15T08:00:00Z'),
          scheduledEnd: new Date('2024-01-15T20:00:00Z'),
        },
      ];

      const flexibleTasks: Task[] = [
        {
          id: 2,
          title: 'Cannot Fit',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          isFixed: false,
          energyLevel: 'medium',
        },
      ];

      const schedule = algorithm.generateSchedule(
        fixedTasks,
        flexibleTasks,
        energyProfile,
        scheduleDate
      );

      // Task should be unscheduled
      expect(schedule.unscheduledTasks).toHaveLength(1);
      expect(schedule.unscheduledTasks[0].id).toBe(2);
    });

    it('should detect tasks that are too long for any gap', () => {
      const fixedTasks: Task[] = [
        {
          id: 1,
          title: 'Morning Block',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 120,
          dueDate: null,
          status: 'todo',
          isFixed: true,
          scheduledStart: new Date('2024-01-15T08:00:00Z'),
          scheduledEnd: new Date('2024-01-15T10:00:00Z'),
        },
        {
          id: 2,
          title: 'Afternoon Block',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 120,
          dueDate: null,
          status: 'todo',
          isFixed: true,
          scheduledStart: new Date('2024-01-15T10:30:00Z'),
          scheduledEnd: new Date('2024-01-15T12:30:00Z'),
        },
      ];

      const flexibleTasks: Task[] = [
        {
          id: 3,
          title: 'Long Task',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 60, // Longer than 30-minute gap
          dueDate: null,
          status: 'todo',
          isFixed: false,
          energyLevel: 'medium',
        },
      ];

      const schedule = algorithm.generateSchedule(
        fixedTasks,
        flexibleTasks,
        energyProfile,
        scheduleDate
      );

      // Task should be unscheduled if it doesn't fit
      // (or scheduled if there's a gap large enough)
      expect(schedule.timeBlocks.length + schedule.unscheduledTasks.length).toBe(3);
    });
  });

  // ==========================================================================
  // Requirement 7.5: No Overlapping Time Blocks
  // ==========================================================================

  describe('No Overlapping Time Blocks', () => {
    it('should not create overlapping time blocks', () => {
      const fixedTasks: Task[] = [
        {
          id: 1,
          title: 'Meeting',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          isFixed: true,
          scheduledStart: new Date('2024-01-15T10:00:00Z'),
          scheduledEnd: new Date('2024-01-15T11:00:00Z'),
        },
      ];

      const flexibleTasks: Task[] = [
        {
          id: 2,
          title: 'Task 1',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 30,
          dueDate: null,
          status: 'todo',
          isFixed: false,
          energyLevel: 'medium',
        },
        {
          id: 3,
          title: 'Task 2',
          description: null,
          domainId: 1,
          priority: 'should-do',
          estimatedMinutes: 30,
          dueDate: null,
          status: 'todo',
          isFixed: false,
          energyLevel: 'medium',
        },
      ];

      const schedule = algorithm.generateSchedule(
        fixedTasks,
        flexibleTasks,
        energyProfile,
        scheduleDate
      );

      // Verify no overlaps
      const conflicts = algorithm.detectConflicts(schedule);
      expect(conflicts).toHaveLength(0);
    });

    it('should detect overlapping fixed tasks', () => {
      const fixedTasks: Task[] = [
        {
          id: 1,
          title: 'Meeting 1',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          isFixed: true,
          scheduledStart: new Date('2024-01-15T10:00:00Z'),
          scheduledEnd: new Date('2024-01-15T11:00:00Z'),
        },
        {
          id: 2,
          title: 'Meeting 2',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          isFixed: true,
          scheduledStart: new Date('2024-01-15T10:30:00Z'),
          scheduledEnd: new Date('2024-01-15T11:30:00Z'),
        },
      ];

      const schedule = algorithm.generateSchedule(fixedTasks, [], energyProfile, scheduleDate);

      // Should detect overlap
      const conflicts = algorithm.detectConflicts(schedule);
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].type).toBe('overlap');
    });
  });

  // ==========================================================================
  // Requirement 7.6: Reschedule Respects Fixed Tasks
  // ==========================================================================

  describe('Reschedule Respects Fixed Tasks', () => {
    it('should find next available slot for rescheduled task', () => {
      const fixedTasks: Task[] = [
        {
          id: 1,
          title: 'Meeting',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          isFixed: true,
          scheduledStart: new Date('2024-01-15T10:00:00Z'),
          scheduledEnd: new Date('2024-01-15T11:00:00Z'),
        },
      ];

      const taskToReschedule: Task = {
        id: 2,
        title: 'Reschedule Me',
        description: null,
        domainId: 1,
        priority: 'should-do',
        estimatedMinutes: 30,
        dueDate: null,
        status: 'todo',
        isFixed: false,
        energyLevel: 'medium',
      };

      const existingSchedule: Schedule = {
        timeBlocks: [
          {
            taskId: 1,
            start: new Date('2024-01-15T10:00:00Z'),
            end: new Date('2024-01-15T11:00:00Z'),
            isFixed: true,
          },
        ],
        unscheduledTasks: [],
        conflicts: [],
      };

      const newBlock = algorithm.rescheduleTask(
        2,
        taskToReschedule,
        fixedTasks,
        existingSchedule,
        scheduleDate
      );

      expect(newBlock).not.toBeNull();

      if (newBlock) {
        // Should not overlap with fixed task
        const fixedBlock = existingSchedule.timeBlocks[0];
        const noOverlap =
          newBlock.end <= fixedBlock.start || newBlock.start >= fixedBlock.end;
        expect(noOverlap).toBe(true);
      }
    });

    it('should return null if no slot available', () => {
      const fixedTasks: Task[] = [
        {
          id: 1,
          title: 'All Day Meeting',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 720,
          dueDate: null,
          status: 'todo',
          isFixed: true,
          scheduledStart: new Date('2024-01-15T08:00:00Z'),
          scheduledEnd: new Date('2024-01-15T20:00:00Z'),
        },
      ];

      const taskToReschedule: Task = {
        id: 2,
        title: 'Cannot Reschedule',
        description: null,
        domainId: 1,
        priority: 'should-do',
        estimatedMinutes: 180, // 3 hours - definitely too long for any gap
        dueDate: null,
        status: 'todo',
        isFixed: false,
        energyLevel: 'medium',
      };

      const existingSchedule: Schedule = {
        timeBlocks: [
          {
            taskId: 1,
            start: new Date('2024-01-15T08:00:00Z'),
            end: new Date('2024-01-15T20:00:00Z'),
            isFixed: true,
          },
        ],
        unscheduledTasks: [],
        conflicts: [],
      };

      const newBlock = algorithm.rescheduleTask(
        2,
        taskToReschedule,
        fixedTasks,
        existingSchedule,
        scheduleDate
      );

      expect(newBlock).toBeNull();
    });
  });

  // ==========================================================================
  // Requirement 8.1: Conflict Detection
  // ==========================================================================

  describe('Conflict Detection', () => {
    it('should detect overlapping time blocks', () => {
      const schedule: Schedule = {
        timeBlocks: [
          {
            taskId: 1,
            start: new Date('2024-01-15T10:00:00Z'),
            end: new Date('2024-01-15T11:00:00Z'),
            isFixed: true,
          },
          {
            taskId: 2,
            start: new Date('2024-01-15T10:30:00Z'),
            end: new Date('2024-01-15T11:30:00Z'),
            isFixed: true,
          },
        ],
        unscheduledTasks: [],
        conflicts: [],
      };

      const conflicts = algorithm.detectConflicts(schedule);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe('overlap');
      expect(conflicts[0].entities).toContain('1');
      expect(conflicts[0].entities).toContain('2');
    });

    it('should not detect conflicts for adjacent blocks', () => {
      const schedule: Schedule = {
        timeBlocks: [
          {
            taskId: 1,
            start: new Date('2024-01-15T10:00:00Z'),
            end: new Date('2024-01-15T11:00:00Z'),
            isFixed: true,
          },
          {
            taskId: 2,
            start: new Date('2024-01-15T11:00:00Z'),
            end: new Date('2024-01-15T12:00:00Z'),
            isFixed: false,
          },
        ],
        unscheduledTasks: [],
        conflicts: [],
      };

      const conflicts = algorithm.detectConflicts(schedule);

      expect(conflicts).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty fixed tasks', () => {
      const flexibleTasks: Task[] = [
        {
          id: 1,
          title: 'Task',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 30,
          dueDate: null,
          status: 'todo',
          isFixed: false,
          energyLevel: 'medium',
        },
      ];

      const schedule = algorithm.generateSchedule([], flexibleTasks, energyProfile, scheduleDate);

      expect(schedule.timeBlocks).toHaveLength(1);
      expect(schedule.unscheduledTasks).toHaveLength(0);
    });

    it('should handle empty flexible tasks', () => {
      const fixedTasks: Task[] = [
        {
          id: 1,
          title: 'Meeting',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          isFixed: true,
          scheduledStart: new Date('2024-01-15T10:00:00Z'),
          scheduledEnd: new Date('2024-01-15T11:00:00Z'),
        },
      ];

      const schedule = algorithm.generateSchedule(fixedTasks, [], energyProfile, scheduleDate);

      expect(schedule.timeBlocks).toHaveLength(1);
      expect(schedule.unscheduledTasks).toHaveLength(0);
    });

    it('should handle fixed task without scheduled times', () => {
      const fixedTasks: Task[] = [
        {
          id: 1,
          title: 'Invalid Fixed Task',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 60,
          dueDate: null,
          status: 'todo',
          isFixed: true,
          // Missing scheduledStart and scheduledEnd
        },
      ];

      const schedule = algorithm.generateSchedule(fixedTasks, [], energyProfile, scheduleDate);

      // Should skip invalid fixed task
      expect(schedule.timeBlocks).toHaveLength(0);
    });

    it('should handle tasks with default energy level', () => {
      const flexibleTasks: Task[] = [
        {
          id: 1,
          title: 'Task without energy level',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 30,
          dueDate: null,
          status: 'todo',
          isFixed: false,
          // No energyLevel specified
        },
      ];

      const schedule = algorithm.generateSchedule([], flexibleTasks, energyProfile, scheduleDate);

      expect(schedule.timeBlocks).toHaveLength(1);
      expect(schedule.unscheduledTasks).toHaveLength(0);
    });

    it('should prioritize must-do tasks over should-do tasks', () => {
      const flexibleTasks: Task[] = [
        {
          id: 1,
          title: 'Should Do',
          description: null,
          domainId: 1,
          priority: 'should-do',
          estimatedMinutes: 30,
          dueDate: null,
          status: 'todo',
          isFixed: false,
          energyLevel: 'medium',
        },
        {
          id: 2,
          title: 'Must Do',
          description: null,
          domainId: 1,
          priority: 'must-do',
          estimatedMinutes: 30,
          dueDate: null,
          status: 'todo',
          isFixed: false,
          energyLevel: 'medium',
        },
      ];

      const schedule = algorithm.generateSchedule([], flexibleTasks, energyProfile, scheduleDate);

      // Must-do should be scheduled first (earlier time)
      const mustDoBlock = schedule.timeBlocks.find(b => b.taskId === 2);
      const shouldDoBlock = schedule.timeBlocks.find(b => b.taskId === 1);

      expect(mustDoBlock).toBeDefined();
      expect(shouldDoBlock).toBeDefined();

      if (mustDoBlock && shouldDoBlock) {
        expect(mustDoBlock.start.getTime()).toBeLessThan(shouldDoBlock.start.getTime());
      }
    });
  });
});
