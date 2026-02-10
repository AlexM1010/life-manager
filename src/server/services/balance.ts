/**
 * Balance Service
 * 
 * Calculates domain balance by counting task completions per domain over a time window.
 * Flags domains with zero completions as "neglected".
 * 
 * Algorithm:
 * 1. Group task completions by domain
 * 2. Count completions per domain within the time window
 * 3. Flag domains with zero completions as neglected
 */

// ============================================================================
// Types
// ============================================================================

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

export interface BalanceInput {
  domains: Domain[];
  taskCompletions: TaskCompletion[];
  startDate: string;         // ISO date (YYYY-MM-DD) - start of window (inclusive)
  endDate: string;           // ISO date (YYYY-MM-DD) - end of window (inclusive)
}

export interface DomainBalance {
  domainId: number;
  name: string;
  completions7d: number;     // Count of completions in the time window
  neglected: boolean;        // true if completions7d === 0
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a date falls within a date range (inclusive)
 */
function isDateInRange(date: string, startDate: string, endDate: string): boolean {
  return date >= startDate && date <= endDate;
}

/**
 * Count completions per domain within the date range
 */
function countCompletionsByDomain(
  completions: TaskCompletion[],
  startDate: string,
  endDate: string
): Map<number, number> {
  const counts = new Map<number, number>();
  
  for (const completion of completions) {
    // Only count completions within the date range
    if (isDateInRange(completion.completedDate, startDate, endDate)) {
      const currentCount = counts.get(completion.domainId) || 0;
      counts.set(completion.domainId, currentCount + 1);
    }
  }
  
  return counts;
}

// ============================================================================
// Main Balance Calculation Function
// ============================================================================

/**
 * Calculate domain balance
 * 
 * Returns completion counts per domain over the specified time window,
 * with neglect flags for domains with zero completions.
 * 
 * NOTE: This function includes ALL task completions regardless of source
 * (web or launcher), so launcher completions are automatically included
 * in domain balance calculations.
 * 
 * @param input - Domains, task completions, and date range
 * @returns Array of domain balance objects, one per domain
 */
export function calculateDomainBalance(input: BalanceInput): DomainBalance[] {
  // Count completions per domain within the date range
  const completionCounts = countCompletionsByDomain(
    input.taskCompletions,
    input.startDate,
    input.endDate
  );
  
  // Build balance result for each domain
  const balances: DomainBalance[] = input.domains.map(domain => {
    const completions7d = completionCounts.get(domain.id) || 0;
    
    return {
      domainId: domain.id,
      name: domain.name,
      completions7d,
      neglected: completions7d === 0,
    };
  });
  
  return balances;
}
