/**
 * Time-Blocking Algorithm
 * 
 * Schedules flexible tasks around fixed calendar events with energy-aware placement.
 * 
 * Design Principles:
 * 1. Fixed tasks are immovable constraints (calendar events)
 * 2. Flexible tasks are placed in available gaps
 * 3. High-energy tasks scheduled during peak hours
 * 4. No overlapping time blocks
 * 5. Unschedulable tasks are detected and reported
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1
 */

// ============================================================================
// Types
// ============================================================================

export interface Task {
  id: number;
  title: string;
  description: string | null;
  domainId: number;
  priority: 'must-do' | 'should-do' | 'nice-to-have';
  estimatedMinutes: number;
  dueDate: string | null;
  status: 'todo' | 'in-progress' | 'done' | 'dropped';
  isFixed?: boolean; // True for calendar events
  energyLevel?: 'low' | 'medium' | 'high'; // Energy required for task
  scheduledStart?: Date; // For fixed tasks
  scheduledEnd?: Date; // For fixed tasks
}

export interface EnergyProfile {
  peakHours: number[]; // Hours of day (0-23) when user has high energy
  lowHours: number[]; // Hours of day (0-23) when user has low energy
  preferredTaskDuration: number; // Preferred duration in minutes
}

export interface TimeBlock {
  taskId: number;
  start: Date;
  end: Date;
  isFixed: boolean;
}

export interface Schedule {
  timeBlocks: TimeBlock[];
  unscheduledTasks: Task[];
  conflicts: Conflict[];
}

export interface Conflict {
  type: 'overlap' | 'duplicate';
  entities: string[];
  description: string;
}

// ============================================================================
// Time-Blocking Algorithm Class
// ============================================================================

export class TimeBlockingAlgorithm {
  /**
   * Generate a daily schedule by placing flexible tasks around fixed tasks
   * 
   * Algorithm:
   * 1. Sort fixed tasks by start time
   * 2. Identify gaps between fixed tasks
   * 3. Sort flexible tasks by priority and energy level
   * 4. Place flexible tasks in gaps, respecting energy profile
   * 5. Detect unschedulable tasks
   * 
   * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
   */
  generateSchedule(
    fixedTasks: Task[],
    flexibleTasks: Task[],
    energyProfile: EnergyProfile,
    scheduleDate: Date = new Date()
  ): Schedule {
    const schedule: Schedule = {
      timeBlocks: [],
      unscheduledTasks: [],
      conflicts: [],
    };

    // Validate and add fixed tasks to schedule
    const validFixedTasks = fixedTasks.filter(task => {
      if (!task.scheduledStart || !task.scheduledEnd) {
        console.warn(`Fixed task ${task.id} missing scheduled times, skipping`);
        return false;
      }
      return true;
    });

    // Sort fixed tasks by start time
    const sortedFixedTasks = [...validFixedTasks].sort((a, b) => {
      return a.scheduledStart!.getTime() - b.scheduledStart!.getTime();
    });

    // Add fixed tasks to schedule
    for (const task of sortedFixedTasks) {
      schedule.timeBlocks.push({
        taskId: task.id,
        start: task.scheduledStart!,
        end: task.scheduledEnd!,
        isFixed: true,
      });
    }

    // Detect overlaps in fixed tasks
    const overlaps = this.detectOverlaps(schedule.timeBlocks);
    if (overlaps.length > 0) {
      schedule.conflicts.push(...overlaps);
    }

    // Find available gaps for flexible tasks
    const gaps = this.findGaps(schedule.timeBlocks, scheduleDate);

    // Sort flexible tasks by priority and energy level
    const sortedFlexibleTasks = this.sortFlexibleTasks(flexibleTasks);

    // Place flexible tasks in gaps
    for (const task of sortedFlexibleTasks) {
      const placement = this.findBestPlacement(
        task,
        gaps,
        energyProfile,
        schedule.timeBlocks
      );

      if (placement) {
        schedule.timeBlocks.push({
          taskId: task.id,
          start: placement.start,
          end: placement.end,
          isFixed: false,
        });

        // Update gaps to reflect the newly scheduled task
        this.updateGaps(gaps, placement.start, placement.end);
      } else {
        // Task cannot be scheduled
        schedule.unscheduledTasks.push(task);
      }
    }

    // Sort time blocks by start time for cleaner output
    schedule.timeBlocks.sort((a, b) => a.start.getTime() - b.start.getTime());

    return schedule;
  }

  /**
   * Reschedule a task to the next available slot
   * 
   * Requirements: 7.6
   */
  rescheduleTask(
    taskId: number,
    task: Task,
    fixedTasks: Task[],
    existingSchedule: Schedule,
    scheduleDate: Date = new Date()
  ): TimeBlock | null {
    // Remove the task from existing schedule if present
    const filteredBlocks = existingSchedule.timeBlocks.filter(
      block => block.taskId !== taskId
    );

    // Find gaps in the filtered schedule
    const gaps = this.findGaps(filteredBlocks, scheduleDate);

    // Try to find a placement for the task
    const energyProfile: EnergyProfile = {
      peakHours: [9, 10, 11, 14, 15, 16],
      lowHours: [13, 17, 18, 19],
      preferredTaskDuration: 30,
    };

    const placement = this.findBestPlacement(
      task,
      gaps,
      energyProfile,
      filteredBlocks
    );

    if (placement) {
      return {
        taskId: task.id,
        start: placement.start,
        end: placement.end,
        isFixed: false,
      };
    }

    return null;
  }

  /**
   * Detect conflicts in a schedule
   * 
   * Requirements: 8.1
   */
  detectConflicts(schedule: Schedule): Conflict[] {
    return this.detectOverlaps(schedule.timeBlocks);
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Detect overlapping time blocks
   */
  private detectOverlaps(timeBlocks: TimeBlock[]): Conflict[] {
    const conflicts: Conflict[] = [];
    const sorted = [...timeBlocks].sort((a, b) => a.start.getTime() - b.start.getTime());

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const blockA = sorted[i];
        const blockB = sorted[j];

        // Check if blocks overlap
        if (this.blocksOverlap(blockA, blockB)) {
          conflicts.push({
            type: 'overlap',
            entities: [blockA.taskId.toString(), blockB.taskId.toString()],
            description: `Tasks ${blockA.taskId} and ${blockB.taskId} have overlapping time blocks`,
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Check if two time blocks overlap
   */
  private blocksOverlap(blockA: TimeBlock, blockB: TimeBlock): boolean {
    // Blocks overlap if one starts before the other ends
    return blockA.start < blockB.end && blockB.start < blockA.end;
  }

  /**
   * Find available gaps between fixed tasks
   */
  private findGaps(
    timeBlocks: TimeBlock[],
    scheduleDate: Date
  ): Array<{ start: Date; end: Date }> {
    const gaps: Array<{ start: Date; end: Date }> = [];

    // Define working hours (8 AM to 8 PM)
    const dayStart = new Date(scheduleDate);
    dayStart.setHours(8, 0, 0, 0);

    const dayEnd = new Date(scheduleDate);
    dayEnd.setHours(20, 0, 0, 0);

    // Sort blocks by start time
    const sorted = [...timeBlocks].sort((a, b) => a.start.getTime() - b.start.getTime());

    // Gap before first block
    if (sorted.length === 0) {
      gaps.push({ start: dayStart, end: dayEnd });
      return gaps;
    }

    if (sorted[0].start > dayStart) {
      gaps.push({ start: dayStart, end: sorted[0].start });
    }

    // Gaps between blocks
    for (let i = 0; i < sorted.length - 1; i++) {
      const currentEnd = sorted[i].end;
      const nextStart = sorted[i + 1].start;

      if (currentEnd < nextStart) {
        // Ensure gap doesn't extend beyond working hours
        const gapStart = currentEnd < dayStart ? dayStart : currentEnd;
        const gapEnd = nextStart > dayEnd ? dayEnd : nextStart;
        
        if (gapStart < gapEnd) {
          gaps.push({ start: gapStart, end: gapEnd });
        }
      }
    }

    // Gap after last block (only if within working hours)
    const lastBlock = sorted[sorted.length - 1];
    if (lastBlock.end < dayEnd) {
      gaps.push({ start: lastBlock.end, end: dayEnd });
    }

    return gaps;
  }

  /**
   * Sort flexible tasks by priority and energy level
   */
  private sortFlexibleTasks(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
      // Priority order: must-do > should-do > nice-to-have
      const priorityOrder = { 'must-do': 3, 'should-do': 2, 'nice-to-have': 1 };
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];

      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      // Energy level order: high > medium > low
      const energyOrder = { high: 3, medium: 2, low: 1 };
      const aEnergy = a.energyLevel || 'medium';
      const bEnergy = b.energyLevel || 'medium';

      return energyOrder[bEnergy] - energyOrder[aEnergy];
    });
  }

  /**
   * Find the best placement for a task in available gaps
   * 
   * Considers:
   * 1. Task duration fits in gap
   * 2. Energy level matches time of day
   * 3. Prefers earlier slots for high-priority tasks
   */
  private findBestPlacement(
    task: Task,
    gaps: Array<{ start: Date; end: Date }>,
    energyProfile: EnergyProfile,
    existingBlocks: TimeBlock[]
  ): { start: Date; end: Date } | null {
    const taskDurationMs = task.estimatedMinutes * 60 * 1000;
    const taskEnergy = task.energyLevel || 'medium';

    // Score each gap based on energy alignment
    const scoredGaps = gaps
      .map(gap => {
        const gapDurationMs = gap.end.getTime() - gap.start.getTime();

        // Skip gaps that are too small
        if (gapDurationMs < taskDurationMs) {
          return null;
        }

        // Calculate energy alignment score
        const gapHour = gap.start.getHours();
        let energyScore = 0;

        if (taskEnergy === 'high' && energyProfile.peakHours.includes(gapHour)) {
          energyScore = 10;
        } else if (taskEnergy === 'low' && energyProfile.lowHours.includes(gapHour)) {
          energyScore = 10;
        } else if (taskEnergy === 'medium') {
          energyScore = 5;
        } else {
          energyScore = 1; // Misaligned but acceptable
        }

        return { gap, energyScore };
      })
      .filter((item): item is { gap: { start: Date; end: Date }; energyScore: number } => item !== null);

    // Sort by energy score (descending), then by start time (ascending)
    scoredGaps.sort((a, b) => {
      if (b.energyScore !== a.energyScore) {
        return b.energyScore - a.energyScore;
      }
      return a.gap.start.getTime() - b.gap.start.getTime();
    });

    // Return the best gap
    if (scoredGaps.length > 0) {
      const bestGap = scoredGaps[0].gap;
      const start = new Date(bestGap.start);
      const end = new Date(start.getTime() + taskDurationMs);

      return { start, end };
    }

    return null;
  }

  /**
   * Update gaps after scheduling a task
   */
  private updateGaps(
    gaps: Array<{ start: Date; end: Date }>,
    scheduledStart: Date,
    scheduledEnd: Date
  ): void {
    for (let i = gaps.length - 1; i >= 0; i--) {
      const gap = gaps[i];

      // Check if the scheduled task overlaps with this gap
      if (scheduledStart < gap.end && scheduledEnd > gap.start) {
        // Remove the gap
        gaps.splice(i, 1);

        // Add back any remaining portions
        if (gap.start < scheduledStart) {
          gaps.push({ start: gap.start, end: scheduledStart });
        }

        if (scheduledEnd < gap.end) {
          gaps.push({ start: scheduledEnd, end: gap.end });
        }
      }
    }

    // Re-sort gaps by start time
    gaps.sort((a, b) => a.start.getTime() - b.start.getTime());
  }
}
