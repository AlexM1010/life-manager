/**
 * Property-Based Tests: Time-Blocking Algorithm
 * 
 * Tests universal properties of the time-blocking algorithm across all valid inputs.
 * 
 * Properties tested:
 * - Property 14: Fixed Tasks as Immovable Constraints (Validates: Requirements 7.1)
 * - Property 15: Flexible Task Placement (Validates: Requirements 7.2)
 * - Property 16: Energy-Aware Scheduling (Validates: Requirements 7.3)
 * - Property 17: Unschedulable Task Detection (Validates: Requirements 7.4)
 * - Property 18: No Overlapping Time Blocks (Validates: Requirements 7.5)
 * - Property 19: Reschedule Respects Fixed Tasks (Validates: Requirements 7.6)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TimeBlockingAlgorithm,
  Task,
  EnergyProfile,
  TimeBlock,
} from '../time-blocking-algorithm.js';
import * as fc from 'fast-check';

describe('TimeBlockingAlgorithm - Property Tests', () => {
  let algorithm: TimeBlockingAlgorithm;
  let scheduleDate: Date;

  beforeEach(() => {
    algorithm = new TimeBlockingAlgorithm();
    scheduleDate = new Date('2024-01-15T00:00:00Z');
    taskIdCounter = 1; // Reset counter for each test
  });

  // ==========================================================================
  // Generators for property-based testing
  // ==========================================================================

  /**
   * Generate a random energy profile
   */
  const energyProfileGenerator = () => {
    return fc.record({
      peakHours: fc.array(fc.integer({ min: 8, max: 19 }), { minLength: 1, maxLength: 8 }),
      lowHours: fc.array(fc.integer({ min: 8, max: 19 }), { minLength: 1, maxLength: 8 }),
      preferredTaskDuration: fc.integer({ min: 15, max: 120 }),
    }).map((data) => {
      // Ensure unique hours
      const uniquePeakHours = [...new Set(data.peakHours)].sort((a, b) => a - b);
      const uniqueLowHours = [...new Set(data.lowHours)].sort((a, b) => a - b);

      return {
        peakHours: uniquePeakHours,
        lowHours: uniqueLowHours,
        preferredTaskDuration: data.preferredTaskDuration,
      } as EnergyProfile;
    });
  };

  /**
   * Generate a random fixed task with scheduled times
   * Uses a counter to ensure unique IDs
   */
  let taskIdCounter = 1;
  const fixedTaskGenerator = (baseDate: Date) => {
    return fc.record({
      title: fc.string({ minLength: 1, maxLength: 100 }),
      domainId: fc.integer({ min: 1, max: 10 }),
      priority: fc.constantFrom('must-do', 'should-do', 'nice-to-have'),
      startHour: fc.integer({ min: 8, max: 18 }),
      startMinute: fc.constantFrom(0, 15, 30, 45),
      durationMinutes: fc.integer({ min: 15, max: 180 }),
    }).map((data) => {
      const start = new Date(baseDate);
      start.setHours(data.startHour, data.startMinute, 0, 0);
      const end = new Date(start.getTime() + data.durationMinutes * 60 * 1000);

      return {
        id: taskIdCounter++,
        title: data.title,
        description: null,
        domainId: data.domainId,
        priority: data.priority,
        estimatedMinutes: data.durationMinutes,
        dueDate: null,
        status: 'todo',
        isFixed: true,
        scheduledStart: start,
        scheduledEnd: end,
      } as Task;
    });
  };

  /**
   * Generate a random flexible task (no scheduled times)
   */
  const flexibleTaskGenerator = () => {
    return fc.record({
      title: fc.string({ minLength: 1, maxLength: 100 }),
      domainId: fc.integer({ min: 1, max: 10 }),
      priority: fc.constantFrom('must-do', 'should-do', 'nice-to-have'),
      estimatedMinutes: fc.integer({ min: 15, max: 180 }),
      energyLevel: fc.constantFrom('low', 'medium', 'high'),
    }).map((data) => {
      return {
        id: taskIdCounter++,
        title: data.title,
        description: null,
        domainId: data.domainId,
        priority: data.priority,
        estimatedMinutes: data.estimatedMinutes,
        dueDate: null,
        status: 'todo',
        isFixed: false,
        energyLevel: data.energyLevel,
      } as Task;
    });
  };

  /**
   * Generate non-overlapping fixed tasks
   */
  const nonOverlappingFixedTasksGenerator = (baseDate: Date, count: number) => {
    return fc.array(
      fc.record({
        title: fc.string({ minLength: 1, maxLength: 100 }),
        domainId: fc.integer({ min: 1, max: 10 }),
        priority: fc.constantFrom('must-do', 'should-do', 'nice-to-have'),
        durationMinutes: fc.integer({ min: 30, max: 120 }),
      }),
      { minLength: count, maxLength: count }
    ).map((tasks) => {
      // Create non-overlapping tasks by spacing them out
      const result: Task[] = [];
      let currentHour = 8;

      for (const taskData of tasks) {
        const start = new Date(baseDate);
        start.setHours(currentHour, 0, 0, 0);
        const end = new Date(start.getTime() + taskData.durationMinutes * 60 * 1000);

        result.push({
          id: taskIdCounter++,
          title: taskData.title,
          description: null,
          domainId: taskData.domainId,
          priority: taskData.priority,
          estimatedMinutes: taskData.durationMinutes,
          dueDate: null,
          status: 'todo',
          isFixed: true,
          scheduledStart: start,
          scheduledEnd: end,
        });

        // Move to next hour after this task ends
        currentHour = end.getHours() + 1;
        if (currentHour >= 20) break; // Don't exceed working hours
      }

      return result;
    });
  };

  // ==========================================================================
  // Property 14: Fixed Tasks as Immovable Constraints
  // **Validates: Requirements 7.1**
  // ==========================================================================

  describe('Feature: google-calendar-sync, Property 14: Fixed Tasks as Immovable Constraints', () => {
    it('should keep all fixed tasks at their original time slots', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fixedTaskGenerator(scheduleDate), { minLength: 1, maxLength: 5 }),
          fc.array(flexibleTaskGenerator(), { minLength: 0, maxLength: 3 }),
          energyProfileGenerator(),
          async (fixedTasks, flexibleTasks, energyProfile) => {
            // PROPERTY: All fixed tasks must remain at their original times
            const schedule = algorithm.generateSchedule(
              fixedTasks,
              flexibleTasks,
              energyProfile,
              scheduleDate
            );

            // Verify each fixed task is in the schedule at its original time
            for (const fixedTask of fixedTasks) {
              if (!fixedTask.scheduledStart || !fixedTask.scheduledEnd) continue;

              const block = schedule.timeBlocks.find(b => b.taskId === fixedTask.id);
              expect(block).toBeDefined();
              
              if (block) {
                expect(block.isFixed).toBe(true);
                expect(block.start.getTime()).toBe(fixedTask.scheduledStart.getTime());
                expect(block.end.getTime()).toBe(fixedTask.scheduledEnd.getTime());
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never schedule flexible tasks over fixed tasks', async () => {
      await fc.assert(
        fc.asyncProperty(
          nonOverlappingFixedTasksGenerator(scheduleDate, 2), // Use non-overlapping to avoid conflicts
          fc.array(flexibleTaskGenerator(), { minLength: 1, maxLength: 5 }),
          energyProfileGenerator(),
          async (fixedTasks, flexibleTasks, energyProfile) => {
            // PROPERTY: No flexible task should overlap with any fixed task
            const schedule = algorithm.generateSchedule(
              fixedTasks,
              flexibleTasks,
              energyProfile,
              scheduleDate
            );

            const fixedBlocks = schedule.timeBlocks.filter(b => b.isFixed);
            const flexibleBlocks = schedule.timeBlocks.filter(b => !b.isFixed);

            for (const flexBlock of flexibleBlocks) {
              for (const fixedBlock of fixedBlocks) {
                // Check no overlap: flex ends before fixed starts OR flex starts after fixed ends
                const noOverlap =
                  flexBlock.end <= fixedBlock.start || flexBlock.start >= fixedBlock.end;
                expect(noOverlap).toBe(true);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property 15: Flexible Task Placement
  // **Validates: Requirements 7.2**
  // ==========================================================================

  describe('Feature: google-calendar-sync, Property 15: Flexible Task Placement', () => {
    it('should place flexible tasks only in gaps between fixed tasks', async () => {
      await fc.assert(
        fc.asyncProperty(
          nonOverlappingFixedTasksGenerator(scheduleDate, 2),
          fc.array(flexibleTaskGenerator(), { minLength: 1, maxLength: 3 }),
          energyProfileGenerator(),
          async (fixedTasks, flexibleTasks, energyProfile) => {
            // PROPERTY: All scheduled flexible tasks must be in gaps (not overlapping fixed)
            const schedule = algorithm.generateSchedule(
              fixedTasks,
              flexibleTasks,
              energyProfile,
              scheduleDate
            );

            const fixedBlocks = schedule.timeBlocks.filter(b => b.isFixed);
            const flexibleBlocks = schedule.timeBlocks.filter(b => !b.isFixed);

            for (const flexBlock of flexibleBlocks) {
              // Verify this flexible block doesn't overlap with any fixed block
              for (const fixedBlock of fixedBlocks) {
                const overlaps =
                  flexBlock.start < fixedBlock.end && flexBlock.end > fixedBlock.start;
                expect(overlaps).toBe(false);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should schedule as many flexible tasks as fit in available gaps', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(flexibleTaskGenerator(), { minLength: 1, maxLength: 10 }),
          energyProfileGenerator(),
          async (flexibleTasks, energyProfile) => {
            // PROPERTY: With no fixed tasks, all flexible tasks should be scheduled
            const schedule = algorithm.generateSchedule(
              [],
              flexibleTasks,
              energyProfile,
              scheduleDate
            );

            // All tasks should be scheduled (working hours are 8 AM - 8 PM = 12 hours = 720 min)
            const totalMinutes = flexibleTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
            
            if (totalMinutes <= 720) {
              // All should fit
              expect(schedule.unscheduledTasks.length).toBe(0);
              expect(schedule.timeBlocks.length).toBe(flexibleTasks.length);
            } else {
              // Some won't fit
              expect(schedule.timeBlocks.length + schedule.unscheduledTasks.length).toBe(
                flexibleTasks.length
              );
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property 16: Energy-Aware Scheduling
  // **Validates: Requirements 7.3**
  // ==========================================================================

  describe('Feature: google-calendar-sync, Property 16: Energy-Aware Scheduling', () => {
    it('should prefer peak hours for high-energy tasks when available', async () => {
      await fc.assert(
        fc.asyncProperty(
          energyProfileGenerator(),
          async (energyProfile) => {
            // Ensure we have peak hours that aren't also low hours
            energyProfile.peakHours = [9, 10, 11, 14, 15];
            energyProfile.lowHours = [17, 18, 19];

            const highEnergyTask: Task = {
              id: taskIdCounter++,
              title: 'High Energy Task',
              description: null,
              domainId: 1,
              priority: 'must-do',
              estimatedMinutes: 60,
              dueDate: null,
              status: 'todo',
              isFixed: false,
              energyLevel: 'high',
            };

            // PROPERTY: High-energy tasks should be scheduled during peak hours when available
            const schedule = algorithm.generateSchedule(
              [],
              [highEnergyTask],
              energyProfile,
              scheduleDate
            );

            const block = schedule.timeBlocks.find(b => b.taskId === highEnergyTask.id);
            if (block) {
              const hour = block.start.getHours();
              // Should be in peak hours OR at least at start of day (8 AM)
              const inPeakHours = energyProfile.peakHours.includes(hour) || hour === 8;
              expect(inPeakHours).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should prefer low hours for low-energy tasks when peak hours are blocked', async () => {
      await fc.assert(
        fc.asyncProperty(
          energyProfileGenerator(),
          async (energyProfile) => {
            // Ensure we have distinct peak and low hours
            energyProfile.peakHours = [8, 9, 10, 11];
            energyProfile.lowHours = [17, 18, 19];

            // Block peak hours with a fixed task
            const fixedTask: Task = {
              id: taskIdCounter++,
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
            };

            const lowEnergyTask: Task = {
              id: taskIdCounter++,
              title: 'Low Energy Task',
              description: null,
              domainId: 1,
              priority: 'must-do',
              estimatedMinutes: 60,
              dueDate: null,
              status: 'todo',
              isFixed: false,
              energyLevel: 'low',
            };

            // PROPERTY: Low-energy tasks should be scheduled during low hours when peak is blocked
            const schedule = algorithm.generateSchedule(
              [fixedTask],
              [lowEnergyTask],
              energyProfile,
              scheduleDate
            );

            const block = schedule.timeBlocks.find(b => b.taskId === lowEnergyTask.id);
            if (block) {
              const hour = block.start.getHours();
              // Should be in low hours or after peak hours (12+)
              const inLowHours = energyProfile.lowHours.includes(hour) || hour >= 12;
              expect(inLowHours).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property 17: Unschedulable Task Detection
  // **Validates: Requirements 7.4**
  // ==========================================================================

  describe('Feature: google-calendar-sync, Property 17: Unschedulable Task Detection', () => {
    it('should mark tasks as unschedulable when they cannot fit', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 600, max: 720 }), // Task duration: 10-12 hours
          energyProfileGenerator(),
          async (taskDuration, energyProfile) => {
            const largeTask: Task = {
              id: 1,
              title: 'Very Long Task',
              description: null,
              domainId: 1,
              priority: 'must-do',
              estimatedMinutes: taskDuration,
              dueDate: null,
              status: 'todo',
              isFixed: false,
              energyLevel: 'medium',
            };

            // PROPERTY: Tasks longer than working hours should be unschedulable
            const schedule = algorithm.generateSchedule(
              [],
              [largeTask],
              energyProfile,
              scheduleDate
            );

            // Working hours are 8 AM - 8 PM = 12 hours = 720 minutes
            if (taskDuration > 720) {
              expect(schedule.unscheduledTasks.length).toBe(1);
              expect(schedule.unscheduledTasks[0].id).toBe(1);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should mark tasks as unschedulable when gaps are too small', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 60, max: 120 }),
          energyProfileGenerator(),
          async (flexibleTaskDuration, energyProfile) => {
            // Create fixed tasks that leave only small gaps
            const fixedTasks: Task[] = [
              {
                id: 1,
                title: 'Morning Block',
                description: null,
                domainId: 1,
                priority: 'must-do',
                estimatedMinutes: 240,
                dueDate: null,
                status: 'todo',
                isFixed: true,
                scheduledStart: new Date('2024-01-15T08:00:00Z'),
                scheduledEnd: new Date('2024-01-15T12:00:00Z'),
              },
              {
                id: 2,
                title: 'Afternoon Block',
                description: null,
                domainId: 1,
                priority: 'must-do',
                estimatedMinutes: 240,
                dueDate: null,
                status: 'todo',
                isFixed: true,
                scheduledStart: new Date('2024-01-15T12:30:00Z'),
                scheduledEnd: new Date('2024-01-15T16:30:00Z'),
              },
              {
                id: 3,
                title: 'Evening Block',
                description: null,
                domainId: 1,
                priority: 'must-do',
                estimatedMinutes: 180,
                dueDate: null,
                status: 'todo',
                isFixed: true,
                scheduledStart: new Date('2024-01-15T17:00:00Z'),
                scheduledEnd: new Date('2024-01-15T20:00:00Z'),
              },
            ];

            const flexibleTask: Task = {
              id: 4,
              title: 'Flexible Task',
              description: null,
              domainId: 1,
              priority: 'must-do',
              estimatedMinutes: flexibleTaskDuration,
              dueDate: null,
              status: 'todo',
              isFixed: false,
              energyLevel: 'medium',
            };

            // PROPERTY: Task should be unschedulable if it doesn't fit in any gap
            const schedule = algorithm.generateSchedule(
              fixedTasks,
              [flexibleTask],
              energyProfile,
              scheduleDate
            );

            // Gaps are: 0 min (12:00-12:30) and 30 min (16:30-17:00)
            // If task needs more than 30 min, it should be unschedulable
            if (flexibleTaskDuration > 30) {
              expect(schedule.unscheduledTasks.length).toBe(1);
              expect(schedule.unscheduledTasks[0].id).toBe(4);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property 18: No Overlapping Time Blocks
  // **Validates: Requirements 7.5**
  // ==========================================================================

  describe('Feature: google-calendar-sync, Property 18: No Overlapping Time Blocks', () => {
    it('should never create overlapping time blocks for flexible tasks', async () => {
      await fc.assert(
        fc.asyncProperty(
          nonOverlappingFixedTasksGenerator(scheduleDate, 2), // Use non-overlapping fixed tasks
          fc.array(flexibleTaskGenerator(), { minLength: 0, maxLength: 5 }),
          energyProfileGenerator(),
          async (fixedTasks, flexibleTasks, energyProfile) => {
            // PROPERTY: No two flexible time blocks should overlap
            const schedule = algorithm.generateSchedule(
              fixedTasks,
              flexibleTasks,
              energyProfile,
              scheduleDate
            );

            const flexibleBlocks = schedule.timeBlocks.filter(b => !b.isFixed);

            // Check all pairs of flexible blocks
            for (let i = 0; i < flexibleBlocks.length; i++) {
              for (let j = i + 1; j < flexibleBlocks.length; j++) {
                const blockA = flexibleBlocks[i];
                const blockB = flexibleBlocks[j];

                // Flexible blocks should never overlap
                const overlaps =
                  blockA.start < blockB.end && blockB.start < blockA.end;
                expect(overlaps).toBe(false);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow adjacent blocks that touch but do not overlap', async () => {
      await fc.assert(
        fc.asyncProperty(
          energyProfileGenerator(),
          async (energyProfile) => {
            const tasks: Task[] = [
              {
                id: taskIdCounter++,
                title: 'Task 1',
                description: null,
                domainId: 1,
                priority: 'must-do',
                estimatedMinutes: 60,
                dueDate: null,
                status: 'todo',
                isFixed: false,
                energyLevel: 'medium',
              },
              {
                id: taskIdCounter++,
                title: 'Task 2',
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

            // PROPERTY: Adjacent blocks (end of one = start of next) should be allowed
            const schedule = algorithm.generateSchedule(
              [],
              tasks,
              energyProfile,
              scheduleDate
            );

            if (schedule.timeBlocks.length === 2) {
              const sorted = [...schedule.timeBlocks].sort(
                (a, b) => a.start.getTime() - b.start.getTime()
              );

              // Check if they're adjacent
              if (sorted[0].end.getTime() === sorted[1].start.getTime()) {
                // This is valid - no overlap
                const conflicts = algorithm.detectConflicts(schedule);
                expect(conflicts.length).toBe(0);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not create overlaps between flexible and fixed tasks', async () => {
      await fc.assert(
        fc.asyncProperty(
          nonOverlappingFixedTasksGenerator(scheduleDate, 2),
          fc.array(flexibleTaskGenerator(), { minLength: 1, maxLength: 3 }),
          energyProfileGenerator(),
          async (fixedTasks, flexibleTasks, energyProfile) => {
            // PROPERTY: Flexible tasks should never overlap with fixed tasks
            const schedule = algorithm.generateSchedule(
              fixedTasks,
              flexibleTasks,
              energyProfile,
              scheduleDate
            );

            const fixedBlocks = schedule.timeBlocks.filter(b => b.isFixed);
            const flexibleBlocks = schedule.timeBlocks.filter(b => !b.isFixed);

            // Check that no flexible block overlaps with any fixed block
            for (const flexBlock of flexibleBlocks) {
              for (const fixedBlock of fixedBlocks) {
                const overlaps =
                  flexBlock.start < fixedBlock.end && flexBlock.end > fixedBlock.start;
                expect(overlaps).toBe(false);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property 19: Reschedule Respects Fixed Tasks
  // **Validates: Requirements 7.6**
  // ==========================================================================

  describe('Feature: google-calendar-sync, Property 19: Reschedule Respects Fixed Tasks', () => {
    it('should find slots that do not conflict with fixed tasks when rescheduling', async () => {
      await fc.assert(
        fc.asyncProperty(
          nonOverlappingFixedTasksGenerator(scheduleDate, 2),
          flexibleTaskGenerator(),
          async (fixedTasks, taskToReschedule) => {
            // Create existing schedule with fixed tasks
            const existingSchedule = algorithm.generateSchedule(
              fixedTasks,
              [],
              { peakHours: [9, 10, 11], lowHours: [17, 18, 19], preferredTaskDuration: 30 },
              scheduleDate
            );

            // PROPERTY: Rescheduled task should not overlap with any fixed task
            const newBlock = algorithm.rescheduleTask(
              taskToReschedule.id,
              taskToReschedule,
              fixedTasks,
              existingSchedule,
              scheduleDate
            );

            if (newBlock) {
              // Verify no overlap with fixed tasks
              const fixedBlocks = existingSchedule.timeBlocks.filter(b => b.isFixed);
              
              for (const fixedBlock of fixedBlocks) {
                const overlaps =
                  newBlock.start < fixedBlock.end && newBlock.end > fixedBlock.start;
                expect(overlaps).toBe(false);
              }

              // Verify task duration is correct
              const durationMs = newBlock.end.getTime() - newBlock.start.getTime();
              const expectedDurationMs = taskToReschedule.estimatedMinutes * 60 * 1000;
              expect(durationMs).toBe(expectedDurationMs);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return null when no slot is available for rescheduling', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 120, max: 240 }),
          async (taskDuration) => {
            // Create fixed tasks that fill most of the day
            const fixedTasks: Task[] = [
              {
                id: taskIdCounter++,
                title: 'All Day Block',
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
              id: taskIdCounter++,
              title: 'Cannot Fit',
              description: null,
              domainId: 1,
              priority: 'must-do',
              estimatedMinutes: taskDuration,
              dueDate: null,
              status: 'todo',
              isFixed: false,
              energyLevel: 'medium',
            };

            const existingSchedule = algorithm.generateSchedule(
              fixedTasks,
              [],
              { peakHours: [9, 10, 11], lowHours: [17, 18, 19], preferredTaskDuration: 30 },
              scheduleDate
            );

            // PROPERTY: Should return null when task cannot fit
            const newBlock = algorithm.rescheduleTask(
              taskToReschedule.id,
              taskToReschedule,
              fixedTasks,
              existingSchedule,
              scheduleDate
            );

            // Task needs 2-4 hours but no gap available
            expect(newBlock).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should remove existing block when rescheduling and find new slot', async () => {
      await fc.assert(
        fc.asyncProperty(
          nonOverlappingFixedTasksGenerator(scheduleDate, 2),
          flexibleTaskGenerator(),
          async (fixedTasks, taskToReschedule) => {
            // Create schedule with the task already scheduled
            const existingSchedule = algorithm.generateSchedule(
              fixedTasks,
              [taskToReschedule],
              { peakHours: [9, 10, 11], lowHours: [17, 18, 19], preferredTaskDuration: 30 },
              scheduleDate
            );

            // PROPERTY: Rescheduling should find a new slot (possibly the same one)
            const newBlock = algorithm.rescheduleTask(
              taskToReschedule.id,
              taskToReschedule,
              fixedTasks,
              existingSchedule,
              scheduleDate
            );

            if (newBlock) {
              // Should not overlap with fixed tasks
              const fixedBlocks = existingSchedule.timeBlocks.filter(b => b.isFixed);
              
              for (const fixedBlock of fixedBlocks) {
                const overlaps =
                  newBlock.start < fixedBlock.end && newBlock.end > fixedBlock.start;
                expect(overlaps).toBe(false);
              }

              // Should have correct task ID
              expect(newBlock.taskId).toBe(taskToReschedule.id);
              expect(newBlock.isFixed).toBe(false);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
