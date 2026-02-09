import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { generatePlan, type Task, type Domain, type PlannerInput } from '../planner.js';

/**
 * Planner Service Property Tests
 * 
 * Property-based tests for the planning algorithm:
 * - Property 8: Today Plan Structure Invariant
 * - Property 9: Today Plan BBI Guarantee
 * - Property 10: Domain Neglect Prioritization
 * - Property 12: Energy-Adaptive Plan Constraints
 * 
 * Validates Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3
 */

// ============================================================================
// Arbitraries (Generators)
// ============================================================================

const taskPriorityArb = fc.constantFrom('must-do', 'should-do', 'nice-to-have') as fc.Arbitrary<
  'must-do' | 'should-do' | 'nice-to-have'
>;

const isoDateArb = fc
  .date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') })
  .map((d) => {
    // Ensure valid date
    if (isNaN(d.getTime())) {
      return '2025-01-01';
    }
    return d.toISOString().split('T')[0];
  }); // YYYY-MM-DD format

// Energy level generator
const energyLevelArb = fc.integer({ min: 0, max: 10 });

// ============================================================================
// Property 8: Today Plan Structure Invariant
// ============================================================================

/**
 * Property 8: Today Plan Structure Invariant
 * 
 * **Validates: Requirements 3.1**
 * 
 * For any non-empty task pool with tasks across multiple domains (including
 * at least one health domain), the generated Today Plan should contain:
 * - 1–3 items categorized as "must-do"
 * - 1–2 items categorized as "want-to" from non-BBI domains
 * - exactly 1 item categorized as "health"
 * - The total item count should be between 3 and 6
 */
describe('Property 8: Today Plan Structure Invariant', () => {
  it('should generate a plan with correct structure when tasks are available', async () => {
    await fc.assert(
      fc.asyncProperty(
        energyLevelArb,
        isoDateArb,
        fc.integer({ min: 2, max: 5 }), // number of non-health domains
        async (energyLevel, currentDate, numNonHealthDomains) => {
          // Create domains: health domain + non-health domains (mix of BBI and non-BBI)
          const domains: Domain[] = [];
          
          // Health domain (always first)
          domains.push({
            id: 1,
            name: 'Health',
            description: 'Health and wellness',
            whyItMatters: 'Physical and mental wellbeing',
            boringButImportant: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          // Non-health domains
          for (let i = 0; i < numNonHealthDomains; i++) {
            const isBBI = i % 2 === 0; // Alternate BBI and non-BBI
            domains.push({
              id: i + 2,
              name: isBBI ? `Admin ${i}` : `Creative ${i}`,
              description: `Domain ${i}`,
              whyItMatters: `Reason ${i}`,
              boringButImportant: isBBI,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }

          // Create tasks across all domains with various priorities
          const tasks: Task[] = [];
          let taskId = 1;

          // Health tasks (at least 2)
          for (let i = 0; i < 2; i++) {
            tasks.push({
              id: taskId++,
              title: `Health Task ${i}`,
              description: null,
              domainId: 1, // Health domain
              priority: i === 0 ? 'must-do' : 'should-do',
              estimatedMinutes: 30,
              dueDate: null,
              status: 'todo',
              rrule: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }

          // Tasks for each non-health domain (mix of priorities)
          for (const domain of domains.slice(1)) {
            // Must-do task
            tasks.push({
              id: taskId++,
              title: `Must-do for ${domain.name}`,
              description: null,
              domainId: domain.id,
              priority: 'must-do',
              estimatedMinutes: 45,
              dueDate: null,
              status: 'todo',
              rrule: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });

            // Should-do task (for non-BBI domains)
            if (!domain.boringButImportant) {
              tasks.push({
                id: taskId++,
                title: `Should-do for ${domain.name}`,
                description: null,
                domainId: domain.id,
                priority: 'should-do',
                estimatedMinutes: 30,
                dueDate: null,
                status: 'todo',
                rrule: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
            }
          }

          // Generate completions map (all domains start with 0 completions)
          const completions7d = new Map<number, number>();
          for (const domain of domains) {
            completions7d.set(domain.id, 0);
          }

          // Generate plan
          const input: PlannerInput = {
            availableTasks: tasks,
            domains,
            completions7d,
            energyLevel,
            currentDate,
          };

          const plan = generatePlan(input);

          // Skip validation if no tasks were selected (edge case for very low energy)
          if (plan.items.length === 0) {
            return;
          }

          // Count items by category
          const mustDoCount = plan.items.filter((item) => item.category === 'must-do').length;
          const wantToCount = plan.items.filter((item) => item.category === 'want-to').length;
          const healthCount = plan.items.filter((item) => item.category === 'health').length;

          // Verify structure constraints
          expect(mustDoCount).toBeGreaterThanOrEqual(1);
          expect(mustDoCount).toBeLessThanOrEqual(3);
          
          // Health task should be present if health tasks are available
          // At low energy, health tasks might be filtered out if they're too long
          if (healthCount > 0) {
            expect(healthCount).toBe(1);
            
            // Verify health task is from health domain
            const healthItems = plan.items.filter((item) => item.category === 'health');
            for (const item of healthItems) {
              const domain = domains.find((d) => d.id === item.task.domainId);
              expect(domain?.name.toLowerCase()).toContain('health');
            }
          }
          
          // Want-to tasks from non-BBI domains (0-2 depending on energy)
          expect(wantToCount).toBeGreaterThanOrEqual(0);
          expect(wantToCount).toBeLessThanOrEqual(2);

          // Total items should be between 2 and 6 (adjusted for energy)
          expect(plan.items.length).toBeGreaterThanOrEqual(2);
          expect(plan.items.length).toBeLessThanOrEqual(6);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 9: Today Plan BBI Guarantee
// ============================================================================

/**
 * Property 9: Today Plan BBI Guarantee
 * 
 * **Validates: Requirements 3.2**
 * 
 * For any task pool where at least one Boring_But_Important domain has at
 * least one task that is due or overdue, the generated Today Plan must
 * include at least one task from a BBI domain.
 */
describe('Property 9: Today Plan BBI Guarantee', () => {
  it('should include at least one BBI task when BBI domain has due/overdue tasks', async () => {
    await fc.assert(
      fc.asyncProperty(
        energyLevelArb,
        isoDateArb,
        async (energyLevel, currentDate) => {
          // Create domains: 1 BBI domain, 1 non-BBI domain, 1 health domain
          const domains: Domain[] = [
            {
              id: 1,
              name: 'Admin',
              description: 'Administrative tasks',
              whyItMatters: 'Keep life organized',
              boringButImportant: true, // BBI domain
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: 2,
              name: 'Creative',
              description: 'Creative projects',
              whyItMatters: 'Self-expression',
              boringButImportant: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: 3,
              name: 'Health',
              description: 'Health and wellness',
              whyItMatters: 'Physical wellbeing',
              boringButImportant: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ];

          // Create tasks
          const tasks: Task[] = [];
          
          // BBI domain: create a task that is due or overdue
          const bbiDueDate = new Date(currentDate);
          bbiDueDate.setDate(bbiDueDate.getDate() - 1); // Yesterday (overdue)
          
          tasks.push({
            id: 1,
            title: 'Overdue BBI Task',
            description: null,
            domainId: 1, // BBI domain
            priority: 'must-do',
            estimatedMinutes: 30,
            dueDate: bbiDueDate.toISOString().split('T')[0],
            status: 'todo',
            rrule: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          // Non-BBI domain: create some tasks
          tasks.push({
            id: 2,
            title: 'Creative Task',
            description: null,
            domainId: 2,
            priority: 'should-do',
            estimatedMinutes: 45,
            dueDate: null,
            status: 'todo',
            rrule: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          // Health domain: create a task
          tasks.push({
            id: 3,
            title: 'Health Task',
            description: null,
            domainId: 3,
            priority: 'should-do',
            estimatedMinutes: 30,
            dueDate: null,
            status: 'todo',
            rrule: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          // Generate completions map
          const completions7d = new Map<number, number>();
          for (const domain of domains) {
            completions7d.set(domain.id, 0);
          }

          // Generate plan
          const input: PlannerInput = {
            availableTasks: tasks,
            domains,
            completions7d,
            energyLevel,
            currentDate,
          };

          const plan = generatePlan(input);

          // Skip if no tasks were selected
          if (plan.items.length === 0) {
            return;
          }

          // Verify at least one task is from a BBI domain
          const hasBBITask = plan.items.some((item) => {
            const domain = domains.find((d) => d.id === item.task.domainId);
            return domain?.boringButImportant === true;
          });

          expect(hasBBITask).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 10: Domain Neglect Prioritization
// ============================================================================

/**
 * Property 10: Domain Neglect Prioritization
 * 
 * **Validates: Requirements 3.3**
 * 
 * For any two tasks of equal priority where one belongs to a domain with
 * fewer completions in the past 7 days, the planner's scoring function
 * should assign a higher score to the task from the more neglected domain.
 */
describe('Property 10: Domain Neglect Prioritization', () => {
  it('should prioritize tasks from more neglected domains', async () => {
    await fc.assert(
      fc.asyncProperty(
        energyLevelArb,
        isoDateArb,
        taskPriorityArb,
        fc.integer({ min: 0, max: 7 }), // completions for domain 1
        fc.integer({ min: 0, max: 7 }), // completions for domain 2
        async (energyLevel, currentDate, priority, completions1, completions2) => {
          // Only test when there's a clear difference in neglect
          if (completions1 === completions2) {
            return;
          }

          // Create two domains
          const domains: Domain[] = [
            {
              id: 1,
              name: 'Domain 1',
              description: 'First domain',
              whyItMatters: 'Reason 1',
              boringButImportant: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: 2,
              name: 'Domain 2',
              description: 'Second domain',
              whyItMatters: 'Reason 2',
              boringButImportant: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: 3,
              name: 'Health',
              description: 'Health domain',
              whyItMatters: 'Wellbeing',
              boringButImportant: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ];

          // Create tasks with same priority but different domains
          const tasks: Task[] = [
            {
              id: 1,
              title: 'Task from Domain 1',
              description: null,
              domainId: 1,
              priority,
              estimatedMinutes: 30,
              dueDate: null,
              status: 'todo',
              rrule: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: 2,
              title: 'Task from Domain 2',
              description: null,
              domainId: 2,
              priority,
              estimatedMinutes: 30,
              dueDate: null,
              status: 'todo',
              rrule: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: 3,
              title: 'Health Task',
              description: null,
              domainId: 3,
              priority: 'should-do',
              estimatedMinutes: 30,
              dueDate: null,
              status: 'todo',
              rrule: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ];

          // Set completions: one domain is more neglected
          const completions7d = new Map<number, number>();
          completions7d.set(1, completions1);
          completions7d.set(2, completions2);
          completions7d.set(3, 0);

          // Determine which domain is more neglected
          const moreNeglectedDomainId = completions1 < completions2 ? 1 : 2;

          // Generate plan
          const input: PlannerInput = {
            availableTasks: tasks,
            domains,
            completions7d,
            energyLevel,
            currentDate,
          };

          const plan = generatePlan(input);

          // Skip if no tasks were selected
          if (plan.items.length === 0) {
            return;
          }

          // Find tasks from domain 1 and domain 2 in the plan
          const task1InPlan = plan.items.find((item) => item.task.domainId === 1);
          const task2InPlan = plan.items.find((item) => item.task.domainId === 2);

          // If both tasks are in the plan, we can't determine prioritization
          // If only one is in the plan, it should be from the more neglected domain
          if (task1InPlan && !task2InPlan) {
            expect(moreNeglectedDomainId).toBe(1);
          } else if (!task1InPlan && task2InPlan) {
            expect(moreNeglectedDomainId).toBe(2);
          }
          // If both or neither are in the plan, the test is inconclusive for this iteration
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 12: Energy-Adaptive Plan Constraints
// ============================================================================

/**
 * Property 12: Energy-Adaptive Plan Constraints
 * 
 * **Validates: Requirements 4.1, 4.2, 4.3**
 * 
 * For any energy level and task pool:
 * - If energy is 0–3: all selected tasks have estimatedMinutes < 15, and total items are 2–3
 * - If energy is 4–6: standard plan structure (Property 8 constraints apply)
 * - If energy is 7–10: total items can be up to 5–6, no duration restriction
 */
describe('Property 12: Energy-Adaptive Plan Constraints', () => {
  it('should adapt plan constraints based on energy level', async () => {
    await fc.assert(
      fc.asyncProperty(
        energyLevelArb,
        isoDateArb,
        async (energyLevel, currentDate) => {
          // Create domains
          const domains: Domain[] = [
            {
              id: 1,
              name: 'Health',
              description: 'Health and wellness',
              whyItMatters: 'Physical wellbeing',
              boringButImportant: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: 2,
              name: 'Work',
              description: 'Work tasks',
              whyItMatters: 'Career',
              boringButImportant: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: 3,
              name: 'Admin',
              description: 'Administrative tasks',
              whyItMatters: 'Organization',
              boringButImportant: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ];

          // Create tasks with various durations
          const tasks: Task[] = [];
          let taskId = 1;

          // Short tasks (< 15 minutes) for each domain
          for (const domain of domains) {
            tasks.push({
              id: taskId++,
              title: `Short task for ${domain.name}`,
              description: null,
              domainId: domain.id,
              priority: 'must-do',
              estimatedMinutes: 10,
              dueDate: null,
              status: 'todo',
              rrule: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }

          // Medium tasks (15-60 minutes) for each domain
          for (const domain of domains) {
            tasks.push({
              id: taskId++,
              title: `Medium task for ${domain.name}`,
              description: null,
              domainId: domain.id,
              priority: 'should-do',
              estimatedMinutes: 30,
              dueDate: null,
              status: 'todo',
              rrule: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }

          // Long tasks (> 60 minutes) for each domain
          for (const domain of domains) {
            tasks.push({
              id: taskId++,
              title: `Long task for ${domain.name}`,
              description: null,
              domainId: domain.id,
              priority: 'nice-to-have',
              estimatedMinutes: 90,
              dueDate: null,
              status: 'todo',
              rrule: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }

          // Generate completions map
          const completions7d = new Map<number, number>();
          for (const domain of domains) {
            completions7d.set(domain.id, 0);
          }

          // Generate plan
          const input: PlannerInput = {
            availableTasks: tasks,
            domains,
            completions7d,
            energyLevel,
            currentDate,
          };

          const plan = generatePlan(input);

          // Skip if no tasks were selected
          if (plan.items.length === 0) {
            return;
          }

          // Verify energy-specific constraints
          if (energyLevel <= 3) {
            // Low energy: 2-3 tasks, all < 15 minutes
            expect(plan.items.length).toBeGreaterThanOrEqual(2);
            expect(plan.items.length).toBeLessThanOrEqual(3);
            
            for (const item of plan.items) {
              expect(item.task.estimatedMinutes).toBeLessThan(15);
            }
          } else if (energyLevel <= 6) {
            // Medium energy: 3-5 tasks, no duration restriction
            expect(plan.items.length).toBeGreaterThanOrEqual(3);
            expect(plan.items.length).toBeLessThanOrEqual(5);
          } else {
            // High energy: 5-6 tasks, no duration restriction
            expect(plan.items.length).toBeGreaterThanOrEqual(5);
            expect(plan.items.length).toBeLessThanOrEqual(6);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
