# Life Manager Architecture

> **Note**: For the overall system architecture including how Life Manager and Life Launcher work together, see [../ARCHITECTURE.md](../ARCHITECTURE.md)

## Overview

Life Manager is the intelligence hub of the Open-Closed system. It aggregates data from multiple sources, runs the planning algorithm with smart time-blocking, stores analytics, and exports a daily plan for Life Launcher to display.

**Role**: Data aggregator, analytics engine, planning brain, time-blocker

**Not responsible for**: Mobile UI, direct user task completion (that's Life Launcher's job)

## Key Responsibilities

1. **Energy Input** - User sets energy level (0-10) at start of day
2. **Smart Time-Blocking** - Read user's calendar, slot tasks into gaps
3. **Plan Export** - Write plan to "Life Manager - Today's Plan" calendar
4. **Completion Tracking** - Read status updates from calendar events
5. **Analytics** - Track completions, skips, snoozes, domain balance

## Task Encoding Convention

For both clients to understand tasks identically:

```
Event Title Format:
[!!!] Call Mom (15m)
 │     │        │
 │     │        └── Duration in minutes
 │     └── Task title
 └── Priority: [!!!]=must-do, [!!]=should-do, [!]=nice-to-have

Event Description Format:
Domain: Relationships
Task ID: 42
Category: must-do
Status: pending|completed|skipped|snoozed
CompletedAt: 2026-02-09T09:12:00Z (if completed)
SkippedAt: 2026-02-09T09:12:00Z (if skipped)
SnoozedAt: 2026-02-09T09:12:00Z (if snoozed)
SnoozedTo: 2026-02-10 (if snoozed)
```

## Smart Time-Blocking Algorithm

Life Manager reads the user's primary calendar and slots tasks into gaps between meetings:

```
User's calendar:                    Life Manager exports:
─────────────────────────────────────────────────────────────
09:00-10:00  Team standup           
                                    10:00-10:15  [!!!] Call Mom (15m)
                                    10:15-10:45  [!!] Pay bills (30m)
                                    10:50-10:55  Buffer
11:00-12:00  Client call            
                                    12:00-12:30  [!] Go for walk (30m)
12:30-13:30  Lunch with Sarah       
                                    13:30-14:00  [!!] Review docs (30m)
```

**Rules:**
- Minimum gap: 10 minutes (shorter gaps ignored)
- Buffer before meetings: 5 minutes
- All-day events: Ignored (don't block time)
- Tasks that don't fit: Scheduled at end of day

## Planner Algorithm

The algorithm is deterministic — given the same inputs, it produces the same output.

**Inputs:**
- Tasks from all sources (Google Tasks, etc.)
- User's calendar events (for time-blocking)
- Completions/skips/snoozes in last 7 days (from SQLite)
- Energy level (0-10, from web app input)
- Current date and time

**Algorithm:**
1. Read user's primary calendar, find gaps
2. Aggregate tasks from all sources
3. Filter by energy-based duration cap
4. Score each task: `priority_weight + domain_neglect_bonus + overdue_bonus`
5. Slot top N tasks into calendar gaps
6. Export to "Life Manager - Today's Plan" calendar with Status: pending

**Energy Configuration:**
| Energy | Tasks | Duration Cap |
|--------|-------|--------------|
| 0-3    | 2-3   | 15 min max   |
| 4-6    | 3-5   | No cap       |
| 7-10   | 5-6   | No cap       |

## Data Flow

### Plan Generation Flow
```
1. User opens Life Manager, sets energy level
   ↓
2. Fetch user's primary calendar (meetings)
   ↓
3. Find gaps between meetings
   ↓
4. Fetch tasks from Google Tasks
   ↓
5. Score and select tasks
   ↓
6. Slot tasks into gaps (smart time-blocking)
   ↓
7. Export to "Life Manager - Today's Plan" calendar
   ↓
8. Life Launcher reads plan from calendar
```

### Completion Sync Flow
```
1. Life Launcher updates event status in calendar
   ↓
2. Life Manager reads status on next sync:
   - Status: completed → task_completions table
   - Status: skipped → task_skips table
   - Status: snoozed → reschedule for SnoozedTo date
   ↓
3. Update domain balance calculations
   ↓
4. Recalculate for next plan generation
```

### Snooze Handling
```
1. Life Launcher sets Status: snoozed, SnoozedTo: 2026-02-10
   ↓
2. Life Manager reads snooze on next sync
   ↓
3. Task rescheduled for snoozed date
   ↓
4. Appears in next day's plan generation
```

## New Services (To Be Implemented)

### plan-exporter.ts
```typescript
export class PlanExporter {
  // Get or create "Life Manager - Today's Plan" calendar
  async getOrCreatePlanCalendar(userId: number): Promise<string>
  
  // Clear today's events before exporting new plan
  async clearTodaysPlanEvents(calendarId: string, date: string): Promise<void>
  
  // Create calendar event for a planned task
  async createPlanEvent(calendarId: string, item: TodayPlanItem, date: string): Promise<void>
  
  // Encode task title: [!!!] Title (15m)
  encodeTaskTitle(task: Task): string
  
  // Encode description with metadata
  encodeTaskDescription(item: TodayPlanItem): string
}
```

### completion-reader.ts
```typescript
export class CompletionReader {
  // Read completion/skip/snooze status from plan calendar
  async getCompletions(userId: number, date: string): Promise<TaskCompletion[]>
  
  // Parse status from event description
  parseStatus(description: string): 'pending' | 'completed' | 'skipped' | 'snoozed'
  
  // Parse task ID from description
  parseTaskId(description: string): number | null
  
  // Parse timestamps
  parseTimestamp(description: string, status: string): Date | null
}
```

## File Structure

```
src/
├── server/
│   ├── db/
│   │   ├── schema.ts         # Drizzle schema
│   │   ├── index.ts          # DB connection
│   │   └── seed.ts           # Default data
│   ├── routers/
│   │   ├── task.ts           # Task CRUD
│   │   ├── domain.ts         # Domain management
│   │   ├── planner.ts        # Plan generation + export
│   │   ├── sync.ts           # Manual sync triggers
│   │   └── stats.ts          # Analytics
│   ├── services/
│   │   ├── planner.ts        # Planning algorithm
│   │   ├── plan-exporter.ts  # NEW: Export to calendar
│   │   ├── completion-reader.ts # NEW: Read status
│   │   ├── sync-engine.ts    # Multi-source sync
│   │   ├── google-tasks-client.ts
│   │   ├── google-calendar-client.ts
│   │   ├── oauth-manager.ts
│   │   ├── balance.ts
│   │   ├── streaks.ts
│   │   └── guardrails.ts
│   ├── trpc.ts
│   └── index.ts
├── client/
│   ├── components/
│   │   ├── TaskList.tsx
│   │   ├── DomainList.tsx
│   │   ├── TodayPlan.tsx
│   │   ├── EnergySlider.tsx  # Energy input
│   │   ├── BalanceChart.tsx  # Domain balance radar
│   │   ├── StreakDisplay.tsx
│   │   └── GuardrailBanner.tsx
│   ├── hooks/
│   │   └── useBackgroundSync.ts
│   ├── lib/
│   │   └── trpc.ts
│   ├── App.tsx
│   └── main.tsx
└── shared/
    ├── types.ts
    └── types/
        └── sync.ts
```

## Database Schema Updates

```typescript
// New table: task_skips
export const taskSkips = sqliteTable('task_skips', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id').notNull().references(() => tasks.id),
  domainId: integer('domain_id').notNull().references(() => domains.id),
  skippedAt: text('skipped_at').notNull(),
  skippedDate: text('skipped_date').notNull(),
});

// New table: plan_exports
export const planExports = sqliteTable('plan_exports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  energyLevel: integer('energy_level').notNull(),
  taskCount: integer('task_count').notNull(),
  exportedAt: text('exported_at').notNull(),
});
```

## Security

- OAuth tokens stored in environment variables (`.env`)
- Each user authenticates with their own Google account
- No central user database (privacy-first design)
- All data stays in user's Google account + local SQLite

## Deployment

**Local Development:**
```bash
npm run dev  # Starts both client (5173) and server (4000)
```

**Production (Self-Hosted):**
```bash
npm run build
npm start
```

**Environment Variables:**
- `GOOGLE_CLIENT_ID`: OAuth client ID
- `GOOGLE_CLIENT_SECRET`: OAuth client secret
- `GOOGLE_REDIRECT_URI`: OAuth callback URL

## Testing

```bash
npm test                    # Run all tests
npm run test:ui             # Visual test UI
npm test -- --watch         # Watch mode
```

## Related Documentation

- [Overall System Architecture](../ARCHITECTURE.md)
- [Alignment Spec](../.kiro/specs/open-closed-alignment/)
- [Google Tasks Integration](./GOOGLE-TASKS-INTEGRATION.md)
