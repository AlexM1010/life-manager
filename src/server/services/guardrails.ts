/**
 * Guardrails Service
 * 
 * Checks daily logs and task completion patterns for concerning trends.
 * Provides gentle, non-medical suggestions to reach out for support.
 * 
 * Safety boundaries:
 * - Never suggests medication changes
 * - Never provides medical advice
 * - Only recommends contacting care team or support network
 * 
 * Trigger conditions:
 * 1. Doctor suggestion: 3+ consecutive days with mood ≤ 3 OR energy ≤ 3
 * 2. Support suggestion: 5+ consecutive days with <50% plan completion AND avg mood/energy ≤ 4
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

export interface TodayPlan {
  id: number;
  date: string;              // ISO date (YYYY-MM-DD)
  energyLevel: number;
  createdAt: string;
}

export interface TodayPlanItem {
  id: number;
  planId: number;
  taskId: number;
  category: string;
  completed: boolean;
  snoozed: boolean;
}

export interface GuardrailInput {
  dailyLogs: DailyLog[];           // ordered by date desc (most recent first)
  todayPlans: TodayPlan[];         // ordered by date desc
  todayPlanItems: TodayPlanItem[]; // all plan items for the plans provided
  currentDate: string;             // ISO date (YYYY-MM-DD) - typically today
}

export interface GuardrailCheck {
  shouldSuggestDoctor: boolean;    // 3+ consecutive days mood≤3 or energy≤3
  shouldSuggestSupport: boolean;   // 5+ days <50% plan completion + avg mood/energy ≤4
  messages: string[];              // Human-readable messages to display
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
 * Group daily logs by date
 */
function groupLogsByDate(logs: DailyLog[]): Map<string, DailyLog> {
  const grouped = new Map<string, DailyLog>();
  
  for (const log of logs) {
    grouped.set(log.date, log);
  }
  
  return grouped;
}

/**
 * Group plan items by plan ID
 */
function groupItemsByPlanId(items: TodayPlanItem[]): Map<number, TodayPlanItem[]> {
  const grouped = new Map<number, TodayPlanItem[]>();
  
  for (const item of items) {
    if (!grouped.has(item.planId)) {
      grouped.set(item.planId, []);
    }
    grouped.get(item.planId)!.push(item);
  }
  
  return grouped;
}

/**
 * Calculate completion rate for a plan
 */
function calculateCompletionRate(items: TodayPlanItem[]): number {
  if (items.length === 0) {
    return 0;
  }
  
  const completedCount = items.filter(item => item.completed).length;
  return completedCount / items.length;
}

// ============================================================================
// Guardrail Check Functions
// ============================================================================

/**
 * Check for doctor suggestion trigger
 * 
 * Trigger: 3+ consecutive days with mood ≤ 3 OR energy ≤ 3
 * 
 * @returns true if trigger condition is met
 */
function checkDoctorSuggestion(
  logsByDate: Map<string, DailyLog>,
  currentDate: string
): boolean {
  let consecutiveLowDays = 0;
  const dates = generateDateSequence(currentDate, 30); // Check up to 30 days back
  
  for (const date of dates) {
    const log = logsByDate.get(date);
    
    // If no log exists for this date, break the streak
    if (!log) {
      break;
    }
    
    // Check if mood ≤ 3 OR energy ≤ 3
    if (log.mood <= 3 || log.energy <= 3) {
      consecutiveLowDays++;
      
      // If we've hit 3 consecutive days, trigger
      if (consecutiveLowDays >= 3) {
        return true;
      }
    } else {
      // Streak broken
      break;
    }
  }
  
  return false;
}

/**
 * Check for support suggestion trigger
 * 
 * Trigger: 5+ consecutive days with <50% plan completion AND avg mood/energy ≤ 4
 * 
 * @returns true if trigger condition is met
 */
function checkSupportSuggestion(
  logsByDate: Map<string, DailyLog>,
  plansByDate: Map<string, TodayPlan>,
  itemsByPlanId: Map<number, TodayPlanItem[]>,
  currentDate: string
): boolean {
  let consecutiveConcerningDays = 0;
  const dates = generateDateSequence(currentDate, 30); // Check up to 30 days back
  
  for (const date of dates) {
    const log = logsByDate.get(date);
    const plan = plansByDate.get(date);
    
    // If no log or no plan exists for this date, break the streak
    if (!log || !plan) {
      break;
    }
    
    // Get plan items for this plan
    const items = itemsByPlanId.get(plan.id) || [];
    
    // Calculate completion rate
    const completionRate = calculateCompletionRate(items);
    
    // Calculate average of mood and energy
    const avgMoodEnergy = (log.mood + log.energy) / 2;
    
    // Check if completion rate < 50% AND avg mood/energy ≤ 4
    if (completionRate < 0.5 && avgMoodEnergy <= 4) {
      consecutiveConcerningDays++;
      
      // If we've hit 5 consecutive days, trigger
      if (consecutiveConcerningDays >= 5) {
        return true;
      }
    } else {
      // Streak broken
      break;
    }
  }
  
  return false;
}

// ============================================================================
// Main Guardrail Check Function
// ============================================================================

/**
 * Check all guardrails and return suggestions
 * 
 * This is a pure function with no side effects. It analyzes patterns
 * and returns recommendations, but never provides medical advice.
 * 
 * @param input - Daily logs, today plans, plan items, and current date
 * @returns Object with trigger flags and human-readable messages
 */
export function checkGuardrails(input: GuardrailInput): GuardrailCheck {
  // Group data by date/ID for efficient lookup
  const logsByDate = groupLogsByDate(input.dailyLogs);
  const itemsByPlanId = groupItemsByPlanId(input.todayPlanItems);
  
  // Create a map of plans by date
  const plansByDate = new Map<string, TodayPlan>();
  for (const plan of input.todayPlans) {
    plansByDate.set(plan.date, plan);
  }
  
  // Check each guardrail
  const shouldSuggestDoctor = checkDoctorSuggestion(logsByDate, input.currentDate);
  const shouldSuggestSupport = checkSupportSuggestion(
    logsByDate,
    plansByDate,
    itemsByPlanId,
    input.currentDate
  );
  
  // Build messages
  const messages: string[] = [];
  
  if (shouldSuggestDoctor) {
    messages.push(
      "You've had low mood or energy for several days in a row. " +
      "This might be a good time to reach out to your doctor or care team. " +
      "They can help you figure out what's going on and what might help."
    );
  }
  
  if (shouldSuggestSupport) {
    messages.push(
      "It looks like things have been tough lately — you've been completing fewer tasks " +
      "and your mood and energy have been lower than usual. " +
      "Consider reaching out to someone in your support network. " +
      "A conversation with a friend, family member, or therapist might help."
    );
  }
  
  return {
    shouldSuggestDoctor,
    shouldSuggestSupport,
    messages,
  };
}
