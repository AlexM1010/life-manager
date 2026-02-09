/**
 * Summary Service
 * 
 * Generates a plain text weekly summary aggregating:
 * - Daily logs (sleep, energy, mood averages)
 * - Task completion counts per domain
 * - Current streak values
 * - Neglected domains (zero completions)
 * 
 * Output format: Plain text suitable for copying into a message or document.
 * No markdown, no HTML — just clean, readable text.
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

export interface Streaks {
  medication: number;       // consecutive days medication=yes
  healthTask: number;       // consecutive days with ≥1 health domain completion
  boringButImportant: number; // consecutive days with ≥1 BBI domain completion
}

export interface DomainBalance {
  domainId: number;
  name: string;
  completions7d: number;     // Count of completions in the time window
  neglected: boolean;        // true if completions7d === 0
}

export interface SummaryInput {
  dailyLogs: DailyLog[];           // logs for the 7-day period
  taskCompletions: TaskCompletion[]; // completions for the 7-day period
  domains: Domain[];               // all domains
  streaks: Streaks;                // current streak values
  balance: DomainBalance[];        // domain balance for the period
  startDate: string;               // ISO date (YYYY-MM-DD) - start of period
  endDate: string;                 // ISO date (YYYY-MM-DD) - end of period
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate average of an array of numbers
 */
function average(numbers: number[]): number {
  if (numbers.length === 0) {
    return 0;
  }
  
  const sum = numbers.reduce((acc, n) => acc + n, 0);
  return sum / numbers.length;
}

/**
 * Format a number to 1 decimal place
 */
function formatDecimal(num: number): string {
  return num.toFixed(1);
}

/**
 * Format a date range for display
 */
function formatDateRange(startDate: string, endDate: string): string {
  // Parse dates
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  
  // Format as "Jan 1 - Jan 7, 2026"
  const startMonth = start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const startDay = start.getUTCDate();
  const endMonth = end.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const endDay = end.getUTCDate();
  const year = end.getUTCFullYear();
  
  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}, ${year}`;
  } else {
    return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`;
  }
}

/**
 * Count completions per domain
 */
function countCompletionsByDomain(
  completions: TaskCompletion[],
  domains: Domain[]
): Map<number, number> {
  const counts = new Map<number, number>();
  
  // Initialize all domains with 0
  for (const domain of domains) {
    counts.set(domain.id, 0);
  }
  
  // Count completions
  for (const completion of completions) {
    const currentCount = counts.get(completion.domainId) || 0;
    counts.set(completion.domainId, currentCount + 1);
  }
  
  return counts;
}

// ============================================================================
// Main Summary Generation Function
// ============================================================================

/**
 * Generate weekly summary as plain text
 * 
 * Aggregates 7 days of data into a human-readable summary suitable for
 * sharing with clinicians or care team.
 * 
 * @param input - Daily logs, completions, domains, streaks, balance, and date range
 * @returns Plain text summary (no markdown, no HTML)
 */
export function generateWeeklySummary(input: SummaryInput): string {
  const lines: string[] = [];
  
  // ========================================================================
  // Header
  // ========================================================================
  
  lines.push('WEEKLY SUMMARY');
  lines.push('');
  lines.push(`Period: ${formatDateRange(input.startDate, input.endDate)}`);
  lines.push('');
  lines.push('');
  
  // ========================================================================
  // Daily Logs Summary
  // ========================================================================
  
  lines.push('DAILY HEALTH METRICS');
  lines.push('');
  
  if (input.dailyLogs.length === 0) {
    lines.push('No daily logs recorded for this period.');
  } else {
    // Calculate averages
    const hoursSleptValues = input.dailyLogs.map(log => log.hoursSlept);
    const energyValues = input.dailyLogs.map(log => log.energy);
    const moodValues = input.dailyLogs.map(log => log.mood);
    
    const avgSleep = average(hoursSleptValues);
    const avgEnergy = average(energyValues);
    const avgMood = average(moodValues);
    
    // Count medication adherence
    const medicationYesCount = input.dailyLogs.filter(log => log.medicationTaken === 'yes').length;
    const medicationRate = (medicationYesCount / input.dailyLogs.length) * 100;
    
    lines.push(`Days logged: ${input.dailyLogs.length} of 7`);
    lines.push(`Average sleep: ${formatDecimal(avgSleep)} hours`);
    lines.push(`Average energy: ${formatDecimal(avgEnergy)} / 10`);
    lines.push(`Average mood: ${formatDecimal(avgMood)} / 10`);
    lines.push(`Medication adherence: ${medicationYesCount} of ${input.dailyLogs.length} days (${formatDecimal(medicationRate)}%)`);
  }
  
  lines.push('');
  lines.push('');
  
  // ========================================================================
  // Task Completion Summary
  // ========================================================================
  
  lines.push('TASK COMPLETION BY DOMAIN');
  lines.push('');
  
  if (input.taskCompletions.length === 0) {
    lines.push('No tasks completed during this period.');
  } else {
    // Count completions per domain
    const completionCounts = countCompletionsByDomain(input.taskCompletions, input.domains);
    
    // Calculate total completions
    const totalCompletions = input.taskCompletions.length;
    
    lines.push(`Total tasks completed: ${totalCompletions}`);
    lines.push('');
    
    // List completions per domain (sorted by domain name)
    const sortedDomains = [...input.domains].sort((a, b) => a.name.localeCompare(b.name));
    
    for (const domain of sortedDomains) {
      const count = completionCounts.get(domain.id) || 0;
      const percentage = totalCompletions > 0 ? (count / totalCompletions) * 100 : 0;
      lines.push(`  ${domain.name}: ${count} tasks (${formatDecimal(percentage)}%)`);
    }
  }
  
  lines.push('');
  lines.push('');
  
  // ========================================================================
  // Current Streaks
  // ========================================================================
  
  lines.push('CURRENT STREAKS');
  lines.push('');
  
  lines.push(`Medication adherence: ${input.streaks.medication} days`);
  lines.push(`Health tasks: ${input.streaks.healthTask} days`);
  lines.push(`Boring-but-important tasks: ${input.streaks.boringButImportant} days`);
  
  lines.push('');
  lines.push('');
  
  // ========================================================================
  // Neglected Domains
  // ========================================================================
  
  lines.push('DOMAIN BALANCE');
  lines.push('');
  
  const neglectedDomains = input.balance.filter(b => b.neglected);
  
  if (neglectedDomains.length === 0) {
    lines.push('All domains had at least one task completed this week.');
  } else {
    lines.push('Domains with no tasks completed this week:');
    lines.push('');
    
    for (const domain of neglectedDomains) {
      lines.push(`  - ${domain.name}`);
    }
  }
  
  lines.push('');
  lines.push('');
  
  // ========================================================================
  // Footer
  // ========================================================================
  
  lines.push('---');
  lines.push('');
  lines.push('This summary is generated by Life Manager for sharing with your care team.');
  lines.push('It contains objective data only and does not include medical advice.');
  
  // Join all lines with newlines
  return lines.join('\n');
}
