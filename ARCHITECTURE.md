# Life Manager Architecture

> **Note**: For the overall system architecture including how Life Manager and Life Launcher work together, see [../ARCHITECTURE.md](../ARCHITECTURE.md)

## Overview

Life Manager is the intelligence hub of the Open-Closed system. It aggregates data from multiple sources, runs the planning algorithm, stores analytics, and exports a simplified daily plan for Life Launcher to display.

**Role**: Data aggregator, analytics engine, planning brain

**Not responsible for**: Mobile UI, direct user task completion (that's Life Launcher's job)

## Task Encoding Convention

For both clients to understand tasks identically:

```
Task Title Format:
[!!!] Call Mom (15m)
 │     │        │
 │     │        └── Duration in minutes
 │     └── Task title
 └── Priority: [!!!]=must-do, [!!]=should-do, [!]=nice-to-have (default: should-do)

Task List = Domain:
- "Health" list
- "Admin" list  
- "Relationships" list
- "University" list
- "Creative" list
```

## Widget States

| State | When | Display |
|-------|------|---------|
| NextTask | Tasks available | Task title, duration, domain |
| EnergyCheckIn | No tasks for current energy | Energy slider (0-10) |
| BalanceWarning | Domain neglected (0 tasks/week) | Domain name, warning |
| AllCaughtUp | No tasks, energy logged | Celebration message |
| Loading | Fetching from Google | Loading indicator |
| Error | API failure | Error + cached state |

## Planner Algorithm

The algorithm is deterministic — given the same inputs, it produces the same output. This ensures Life Launcher (reading from Google Calendar) sees the same plan that Life Manager computed.

**Inputs:**
- Tasks from all sources (Google Tasks, Todoist, etc.)
- Completions in last 7 days (from SQLite)
- Energy level (0-10, from latest check-in)
- Activity data (from Google Fit, planned)
- Current date and time

**Algorithm:**
1. Aggregate tasks from all sources
2. Filter by energy-based duration cap (low energy = short tasks only)
3. Score each task: `priority_weight + domain_neglect_bonus + overdue_bonus`
4. Select top N tasks (N depends on energy level)
5. Export to Google Calendar as "Today's Plan"

**Energy Configuration:**
| Energy | Tasks | Duration Cap |
|--------|-------|--------------|
| 0-3    | 2-3   | 15 min max   |
| 4-6    | 3-5   | No cap       |
| 7-10   | 5-6   | No cap       |

**Output**: List of tasks exported to Google Calendar for Life Launcher to display

## Data Flow

### Import Cycle (Pull from Sources)
```
1. Scheduled job triggers (every 5-15 min)
2. Fetch from all sources:
   - Google Tasks API (tasks by list/domain)
   - Google Calendar API (events, completions)
   - Todoist API (planned)
   - Google Fit API (planned)
3. Parse and normalize data
4. Store in SQLite with source metadata
5. Update sync timestamps
```

### Planning Cycle (Generate Daily Plan)
```
1. Aggregate tasks from all sources
2. Get latest energy level from database
3. Get completion history (last 7 days)
4. Run planner algorithm:
   - Filter by energy-based duration cap
   - Score by priority + domain balance + overdue
   - Select top N tasks
5. Export to Google Calendar as "Today's Plan"
6. Life Launcher reads from Google Calendar
```

### Analytics Cycle (Store History)
```
1. Pull completed tasks from Google
2. Store completions in SQLite
3. Calculate streaks per domain
4. Update domain balance metrics
5. Check guardrail conditions
6. Generate weekly summaries
```

## File Structure

```
src/
├── server/              # Backend (Node.js + tRPC)
│   ├── db/
│   │   ├── schema.ts    # Drizzle schema (single source of truth)
│   │   ├── index.ts     # DB connection + migration runner
│   │   └── seed.ts      # Default data seeder
│   ├── routers/         # tRPC API endpoints (one per domain)
│   │   ├── task.ts      # Task CRUD + sync
│   │   ├── domain.ts    # Domain management
│   │   ├── planner.ts   # Planning algorithm endpoint
│   │   ├── sync.ts      # Manual sync triggers
│   │   └── stats.ts     # Analytics endpoints
│   ├── services/        # Business logic (pure functions)
│   │   ├── planner.ts              # Planning algorithm
│   │   ├── sync-engine.ts          # Multi-source sync orchestration
│   │   ├── google-tasks-client.ts  # Google Tasks API
│   │   ├── google-calendar-client.ts # Google Calendar API
│   │   ├── oauth-manager.ts        # OAuth token management
│   │   ├── balance.ts              # Domain balance calculations
│   │   ├── streaks.ts              # Streak tracking
│   │   └── guardrails.ts           # Safety checks
│   ├── trpc.ts          # tRPC context + router initialization
│   └── index.ts         # Express server + tRPC adapter
├── client/              # Frontend (React + Vite)
│   ├── components/      # React components
│   │   ├── TaskList.tsx
│   │   ├── DomainList.tsx
│   │   ├── TodayPlan.tsx
│   │   ├── BalanceChart.tsx
│   │   ├── StreakDisplay.tsx
│   │   ├── GuardrailBanner.tsx
│   │   └── GoogleSyncSettings.tsx
│   ├── hooks/           # Custom React hooks
│   │   └── useBackgroundSync.ts
│   ├── lib/
│   │   └── trpc.ts      # tRPC client setup
│   ├── App.tsx          # Main app component + navigation
│   └── main.tsx         # React entry point
└── shared/
    ├── types.ts         # Shared Zod schemas + TypeScript types
    └── types/
        └── sync.ts      # Sync-specific types
```

## Dependencies

- **@trpc/server** & **@trpc/client**: Type-safe API layer
- **@tanstack/react-query**: Data fetching and caching (used by tRPC)
- **drizzle-orm**: Type-safe SQL query builder
- **better-sqlite3**: SQLite driver
- **googleapis**: Google Calendar and Tasks API integration
- **p-retry**: Retry logic for sync operations
- **fast-check**: Property-based testing library
- **zod**: Runtime validation and type inference
- **express**: HTTP server
- **vite**: Frontend build tool
- **react**: UI framework
- **tailwind**: CSS framework

## Security

- OAuth tokens stored in environment variables (`.env`)
- Database contains only aggregated analytics (no sensitive task content from other users)
- Each user authenticates with their own Google account
- No central user database (privacy-first design)
- All data stays in user's Google account + local SQLite

## Deployment

Life Manager can be deployed in several ways:

**Local Development:**
```bash
npm run dev  # Starts both client (5173) and server (4000)
```

**Production (Self-Hosted):**
```bash
npm run build
npm start
```

**Environment Variables Required:**
- `GOOGLE_CLIENT_ID`: OAuth client ID
- `GOOGLE_CLIENT_SECRET`: OAuth client secret
- `GOOGLE_REDIRECT_URI`: OAuth callback URL

See `.env.example` for template.

## Future Integrations

### Todoist
```typescript
// services/todoist-client.ts
export class TodoistClient {
  async fetchTasks(): Promise<TodoistTask[]>
  async completeTask(id: string): Promise<void>
}
```

### Google Fit
```typescript
// services/google-fit-client.ts
export class GoogleFitClient {
  async getStepCount(date: Date): Promise<number>
  async getWorkouts(start: Date, end: Date): Promise<Workout[]>
}
```

### Custom Fitness Plans
```typescript
// db/schema.ts
export const fitnessPlans = sqliteTable('fitness_plans', {
  dayOfWeek: integer('day_of_week'), // 0-6
  exerciseType: text('exercise_type'),
  targetDuration: integer('target_duration'),
  adaptiveIntensity: integer('adaptive_intensity'),
});
```

All new integrations follow the same pattern:
1. Create client service
2. Add sync metadata table
3. Extend sync engine
4. Update planner algorithm
5. Export to Google Calendar for launcher

## Testing

```bash
npm test                    # Run all tests
npm run test:ui             # Visual test UI
npm test -- --watch         # Watch mode
```

Test coverage includes:
- Unit tests for services (pure functions)
- Property-based tests (fast-check)
- Integration tests for sync engine
- Router tests for tRPC endpoints

## Related Documentation

- [Overall System Architecture](../ARCHITECTURE.md) - How Life Manager and Life Launcher work together
- [Google Tasks Integration](./GOOGLE-TASKS-INTEGRATION.md) - Google API setup
- [Widget Design](./WIDGET-DESIGN.md) - UI/UX considerations
