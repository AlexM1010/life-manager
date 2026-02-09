/**
 * Planner Service
 * 
 * Core planning algorithm that generates balanced daily plans.
 * 
 * Algorithm:
 * 1. Determine task count and duration cap from energy level
 * 2. Filter available tasks by duration cap (if low energy)
 * 3. Score each task: priority_weight + domain_neglect_bonus + overdue_bonus
 * 4. Select tasks to fill slots:
 *    - Must-do slots: top-scored tasks from must-do priority
 *    - Boring-but-important guarantee: if any BBI domain has due/overdue tasks, at least one is included
 *    - Want-to slots: top-scored tasks from non-BBI domains with priority should-do or nice-to-have
 *    - Health slot: top-scored task from health-related domains
 * 5. Return plan
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
  rrule: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Domain {
  id: number;
  name: string;
  description: string;
  whyItMatters: string;
  boringButImportant: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlannerInput {
  availableTasks: Task[];        // status=todo, not snoozed today
  domains: Domain[];
  completions7d: Map<number, number>; // domainId → completion count
  energyLevel: number;           // 0-10
  currentDate: string;           // ISO date (YYYY-MM-DD)
}

export interface TodayPlanItem {
  taskId: number;
  task: Task;
  category: 'must-do' | 'want-to' | 'health';
}

export interface TodayPlan {
  date: string;                  // ISO date
  energyLevel: number;
  items: TodayPlanItem[];
}

interface ScoredTask {
  task: Task;
  score: number;
}

// ============================================================================
// Energy Level Configuration
// ============================================================================

interface EnergyConfig {
  minTasks: number;
  maxTasks: number;
  durationCap: number | null; // null = no cap
}

function getEnergyConfig(energyLevel: number): EnergyConfig {
  if (energyLevel <= 3) {
    // Low energy: 2-3 tasks, max 15 minutes each
    return { minTasks: 2, maxTasks: 3, durationCap: 15 };
  } else if (energyLevel <= 6) {
    // Medium energy: 3-5 tasks, no duration cap
    return { minTasks: 3, maxTasks: 5, durationCap: null };
  } else {
    // High energy: 5-6 tasks, no duration cap
    return { minTasks: 5, maxTasks: 6, durationCap: null };
  }
}

// ============================================================================
// Task Scoring
// ============================================================================

function scoreTask(
  task: Task,
  _domain: Domain,
  completions7d: Map<number, number>,
  currentDate: string
): number {
  let score = 0;

  // Priority weight
  if (task.priority === 'must-do') {
    score += 10;
  } else if (task.priority === 'should-do') {
    score += 5;
  } else {
    score += 2; // nice-to-have
  }

  // Domain neglect bonus: more neglected = higher score
  const domainCompletions = completions7d.get(task.domainId) || 0;
  const neglectBonus = Math.max(0, 7 - domainCompletions);
  score += neglectBonus;

  // Overdue bonus
  if (task.dueDate) {
    const dueDate = task.dueDate.split('T')[0]; // Extract date part
    if (dueDate < currentDate) {
      score += 5; // Past due
    } else if (dueDate === currentDate) {
      score += 3; // Due today
    }
  }

  return score;
}

// ============================================================================
// Task Selection
// ============================================================================

function selectTasks(
  availableTasks: Task[],
  domains: Domain[],
  completions7d: Map<number, number>,
  energyLevel: number,
  currentDate: string
): TodayPlanItem[] {
  const config = getEnergyConfig(energyLevel);
  const domainMap = new Map(domains.map(d => [d.id, d]));
  
  // No tasks at all? Return empty.
  if (availableTasks.length === 0) {
    return [];
  }

  // Filter by duration cap if applicable
  let filteredTasks = availableTasks;
  const durationCap = config.durationCap;
  if (durationCap !== null) {
    filteredTasks = availableTasks.filter(t => t.estimatedMinutes <= durationCap);
    
    // If no tasks fit the cap, fall back to shortest available tasks
    // (low energy still gets something, just the quickest options)
    if (filteredTasks.length === 0) {
      const sorted = [...availableTasks].sort((a, b) => a.estimatedMinutes - b.estimatedMinutes);
      // Take up to minTasks of the shortest ones
      filteredTasks = sorted.slice(0, config.minTasks);
    }
  }

  // Score all tasks
  const scoredTasks: ScoredTask[] = filteredTasks.map(task => {
    const domain = domainMap.get(task.domainId);
    if (!domain) {
      throw new Error(`Domain not found for task ${task.id}`);
    }
    return {
      task,
      score: scoreTask(task, domain, completions7d, currentDate),
    };
  });

  // Sort by score descending
  scoredTasks.sort((a, b) => b.score - a.score);

  const selectedItems: TodayPlanItem[] = [];
  const selectedTaskIds = new Set<number>();

  // Helper to add task if not already selected
  const addTask = (scoredTask: ScoredTask, category: 'must-do' | 'want-to' | 'health') => {
    if (!selectedTaskIds.has(scoredTask.task.id)) {
      selectedItems.push({
        taskId: scoredTask.task.id,
        task: scoredTask.task,
        category,
      });
      selectedTaskIds.add(scoredTask.task.id);
      return true;
    }
    return false;
  };

  // 1. Select must-do tasks (1-3 depending on energy)
  const mustDoTasks = scoredTasks.filter(st => st.task.priority === 'must-do');
  const mustDoCount = Math.min(3, Math.max(1, Math.floor(config.maxTasks / 2)));
  
  for (let i = 0; i < mustDoCount && i < mustDoTasks.length; i++) {
    addTask(mustDoTasks[i], 'must-do');
  }

  // 2. BBI guarantee: if any BBI domain has due/overdue tasks, include at least one
  const bbiDueOrOverdueTasks = scoredTasks.filter(st => {
    const domain = domainMap.get(st.task.domainId);
    if (!domain || !domain.boringButImportant) return false;
    if (!st.task.dueDate) return false;
    const dueDate = st.task.dueDate.split('T')[0];
    return dueDate <= currentDate;
  });

  const hasBbiSelected = selectedItems.some(item => {
    const domain = domainMap.get(item.task.domainId);
    return domain?.boringButImportant;
  });

  if (bbiDueOrOverdueTasks.length > 0 && !hasBbiSelected) {
    // Add the highest-scored BBI due/overdue task
    addTask(bbiDueOrOverdueTasks[0], 'must-do');
  }

  // 3. Select health task (1 task from health-related domains)
  // Health domains are identified by name containing "health" (case-insensitive)
  const healthDomainIds = new Set(
    domains.filter(d => d.name.toLowerCase().includes('health')).map(d => d.id)
  );
  const healthTasks = scoredTasks.filter(st => healthDomainIds.has(st.task.domainId));
  
  if (healthTasks.length > 0) {
    addTask(healthTasks[0], 'health');
  }

  // 4. Fill remaining slots with want-to tasks (non-BBI, should-do or nice-to-have)
  const wantToTasks = scoredTasks.filter(st => {
    const domain = domainMap.get(st.task.domainId);
    if (!domain) return false;
    // Non-BBI domains, and priority is should-do or nice-to-have
    return !domain.boringButImportant && 
           (st.task.priority === 'should-do' || st.task.priority === 'nice-to-have');
  });

  const wantToCount = Math.min(2, config.maxTasks - selectedItems.length);
  for (let i = 0; i < wantToCount && i < wantToTasks.length; i++) {
    if (selectedItems.length >= config.maxTasks) break;
    addTask(wantToTasks[i], 'want-to');
  }

  // 5. If we haven't reached minTasks, fill with any remaining tasks
  if (selectedItems.length < config.minTasks) {
    for (const scoredTask of scoredTasks) {
      if (selectedItems.length >= config.minTasks) break;
      addTask(scoredTask, 'want-to');
    }
  }

  // 6. GUARANTEE: Always return at least 1 task if any are available
  if (selectedItems.length === 0 && scoredTasks.length > 0) {
    addTask(scoredTasks[0], 'want-to');
  }

  return selectedItems;
}

// ============================================================================
// Main Planning Function
// ============================================================================

export function generatePlan(input: PlannerInput): TodayPlan {
  const items = selectTasks(
    input.availableTasks,
    input.domains,
    input.completions7d,
    input.energyLevel,
    input.currentDate
  );

  return {
    date: input.currentDate,
    energyLevel: input.energyLevel,
    items,
  };
}
