# Database Migrations

This directory contains database migrations for the Life Manager application.

## Migrations

### 0000_burly_timeslip.sql
Initial database schema with core tables:
- `domains` - Life domains (Health, Uni/Research, Admin, etc.)
- `tasks` - Task management with priorities and recurring tasks
- `task_completions` - Log of task completion events
- `snooze_logs` - History of task snoozing
- `daily_logs` - Daily health tracking (sleep, energy, mood, medication)
- `today_plans` - Daily plan generation
- `today_plan_items` - Tasks included in today's plan

### 0001_outstanding_mockingbird.sql
Google Calendar Sync feature tables:
- `oauth_tokens` - OAuth 2.0 tokens for Google API authentication
- `task_sync_metadata` - Sync metadata linking tasks to Google Tasks/Calendar
- `sync_queue` - Operation queue for retry logic
- `sync_log` - Audit trail of sync operations

**Indexes added for performance:**
- `oauth_tokens`: user_id, (user_id, provider) unique
- `task_sync_metadata`: task_id unique, google_task_id, google_event_id
- `sync_queue`: (user_id, status), next_retry_at
- `sync_log`: (user_id, timestamp)

## Running Migrations

```bash
# Generate a new migration after schema changes
npm run db:generate

# Apply pending migrations to the database
npm run db:migrate

# Open Drizzle Studio to view/edit data
npm run db:studio
```

## Seeding Data

```bash
# Seed default domains
npm run db:seed

# Seed test data for Google Calendar Sync (development only)
tsx src/server/db/seed-sync-test-data.ts
```

## Schema Location

The TypeScript schema definitions are in:
- `src/server/db/schema.ts` - Main schema file

## Notes

- All timestamps are stored as ISO 8601 strings in TEXT columns
- SQLite doesn't have native boolean type - we use INTEGER with mode: 'boolean'
- Foreign keys are enforced with ON DELETE CASCADE where appropriate
- Indexes are optimized for common query patterns (user lookups, sync status checks)
