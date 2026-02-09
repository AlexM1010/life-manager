/**
 * Streak Service
 * 
 * Calculates consecutive-day streaks for:
 * - Medication adherence (consecutive days with medicationTaken = "yes")
 * - Health task completion (consecutive days with ≥1 health domain task completed)
 * - Boring-but-important task completion (consecutive days with ≥1 BBI domain task completed)
 * 
 * Algorithm:
 * Walk backwards from today. For each streak type, count consecutive days where the condition holds.
 * Stop at first gap (missing day or condition not met).
 */

// ============================================================================
// Types
// ============================================================================

export interface DailyLog {
  id: number;
  date: string;              // ISO date (YYYY-MM-DD)
  hoursSlept: number;
  energy: number;            // 0-10
  mood: number;              // 0-10
  medicationTaken: string;   // "yes" or "no"
  createdAt: string;
  updatedAt: string;
}

export interface TaskCompletion {
  id: number;
  taskId: number;
  domainId: number;
  completedAt: string;       // ISO datetime
  completedDate: string;     // ISO date (YYYY-MM-DD)
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

export interface StreakInput {
  dailyLogs: DailyLog[];           // ordered by date desc (most recent first)
  taskCompletions: TaskCompletion[]; // ordered by date desc
  domains: Domain[];
  currentDate: string;             // ISO date (YYYY-MM-DD) - typically today
}

export interface Streaks {
  medication: number;       // consecutive days medication=yes
  healthTask: number;       // consecutive days with ≥1 health domain completion
  boringButImportant: number; // consecutive days with ≥1 BBI domain completion
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a list of consecutive dates going backwards from startDate
 */
function generateDateSequence(startDate: string, count: number): string[] {
  const dates: string[] = [];
  const date = new Date(startDate + 'T00:00:00Z');
  
  for (let i = 0; i < count; i++) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    
    // Move to previous day
    date.setUTCDate(date.getUTCDate() - 1);
  }
  
  return dates;
}

/**
 * Group task completions by date
 */
function groupCompletionsByDate(completions: TaskCompletion[]): Map<string, TaskCompletion[]> {
  const grouped = new Map<string, TaskCompletion[]>();
  
  for (const completion of completions) {
    const date = completion.completedDate;
    if (!grouped.has(date)) {
      grouped.set(date, []);
    }
    grouped.get(date)!.push(completion);
  }
  
  return grouped;
}

/**
 * Group daily logs by date
 */
function groupLogsByDate(logs: DailyLog[]): Map<string, DailyLog> {
  const grouped = new Map<string, DailyLog>();
  
  for (const log of logs) {
    grouped.set(log.date, log);
  }
  
  return grouped;
}

// ============================================================================
// Streak Calculation Functions
// ============================================================================

/**
 * Calculate medication streak
 * Counts consecutive days (from currentDate backwards) where medicationTaken = "yes"
 */
function calculateMedicationStreak(
  logsByDate: Map<string, DailyLog>,
  currentDate: string
): number {
  let streak = 0;
  const dates = generateDateSequence(currentDate, 365); // Check up to 1 year back
  
  for (const date of dates) {
    const log = logsByDate.get(date);
    
    // If no log exists for this date, streak breaks
    if (!log) {
      break;
    }
    
    // If medication was taken, increment streak
    if (log.medicationTaken === 'yes') {
      streak++;
    } else {
      // Medication not taken, streak breaks
      break;
    }
  }
  
  return streak;
}

/**
 * Calculate health task streak
 * Counts consecutive days (from currentDate backwards) where ≥1 task in a health domain was completed
 */
function calculateHealthTaskStreak(
  completionsByDate: Map<string, TaskCompletion[]>,
  domains: Domain[],
  currentDate: string
): number {
  // Identify health domain IDs (domains with "health" in name, case-insensitive)
  const healthDomainIds = new Set(
    domains.filter(d => d.name.toLowerCase().includes('health')).map(d => d.id)
  );
  
  // If no health domains exist, streak is 0
  if (healthDomainIds.size === 0) {
    return 0;
  }
  
  let streak = 0;
  const dates = generateDateSequence(currentDate, 365);
  
  for (const date of dates) {
    const completions = completionsByDate.get(date) || [];
    
    // Check if any completion is from a health domain
    const hasHealthCompletion = completions.some(c => healthDomainIds.has(c.domainId));
    
    if (hasHealthCompletion) {
      streak++;
    } else {
      // No health task completed on this day, streak breaks
      break;
    }
  }
  
  return streak;
}

/**
 * Calculate boring-but-important task streak
 * Counts consecutive days (from currentDate backwards) where ≥1 task in a BBI domain was completed
 */
function calculateBBIStreak(
  completionsByDate: Map<string, TaskCompletion[]>,
  domains: Domain[],
  currentDate: string
): number {
  // Identify BBI domain IDs
  const bbiDomainIds = new Set(
    domains.filter(d => d.boringButImportant).map(d => d.id)
  );
  
  // If no BBI domains exist, streak is 0
  if (bbiDomainIds.size === 0) {
    return 0;
  }
  
  let streak = 0;
  const dates = generateDateSequence(currentDate, 365);
  
  for (const date of dates) {
    const completions = completionsByDate.get(date) || [];
    
    // Check if any completion is from a BBI domain
    const hasBBICompletion = completions.some(c => bbiDomainIds.has(c.domainId));
    
    if (hasBBICompletion) {
      streak++;
    } else {
      // No BBI task completed on this day, streak breaks
      break;
    }
  }
  
  return streak;
}

// ============================================================================
// Main Streak Calculation Function
// ============================================================================

/**
 * Calculate all streaks
 * 
 * @param input - Daily logs, task completions, domains, and current date
 * @returns Object with medication, healthTask, and boringButImportant streak counts
 */
export function calculateStreaks(input: StreakInput): Streaks {
  // Group data by date for efficient lookup
  const logsByDate = groupLogsByDate(input.dailyLogs);
  const completionsByDate = groupCompletionsByDate(input.taskCompletions);
  
  // Calculate each streak type
  const medication = calculateMedicationStreak(logsByDate, input.currentDate);
  const healthTask = calculateHealthTaskStreak(completionsByDate, input.domains, input.currentDate);
  const boringButImportant = calculateBBIStreak(completionsByDate, input.domains, input.currentDate);
  
  return {
    medication,
    healthTask,
    boringButImportant,
  };
}
