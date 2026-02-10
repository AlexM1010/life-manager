import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Domains
export const domains = sqliteTable('domains', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description').notNull().default(''),
  whyItMatters: text('why_it_matters').notNull().default(''),
  boringButImportant: integer('boring_but_important', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(), // ISO string
  updatedAt: text('updated_at').notNull(), // ISO string
});

// Tasks
export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  description: text('description'),
  domainId: integer('domain_id').notNull().references(() => domains.id),
  priority: text('priority', { enum: ['must-do', 'should-do', 'nice-to-have'] }).notNull(),
  estimatedMinutes: integer('estimated_minutes').notNull(),
  dueDate: text('due_date'),           // ISO date string or null
  status: text('status', { enum: ['todo', 'in-progress', 'done', 'dropped'] }).notNull().default('todo'),
  rrule: text('rrule'),                // rrule.js string or null
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Task completions (log of every completion event)
export const taskCompletions = sqliteTable('task_completions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id').notNull().references(() => tasks.id),
  domainId: integer('domain_id').notNull().references(() => domains.id),
  completedAt: text('completed_at').notNull(), // ISO datetime
  completedDate: text('completed_date').notNull(), // ISO date (for grouping)
  source: text('source', { enum: ['web', 'launcher'] }).notNull().default('web'), // Where completion came from
});

// Task skips (log of every skip event from launcher)
export const taskSkips = sqliteTable('task_skips', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id').notNull().references(() => tasks.id),
  domainId: integer('domain_id').notNull().references(() => domains.id),
  skippedAt: text('skipped_at').notNull(), // ISO datetime
  skippedDate: text('skipped_date').notNull(), // ISO date (for grouping)
});

// Snooze log
export const snoozeLogs = sqliteTable('snooze_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id').notNull().references(() => tasks.id),
  snoozedAt: text('snoozed_at').notNull(),
  snoozedFrom: text('snoozed_from').notNull(), // original plan date
  snoozedTo: text('snoozed_to').notNull(),     // new date
});

// Daily health logs
export const dailyLogs = sqliteTable('daily_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull().unique(),  // ISO date, one per day
  hoursSlept: real('hours_slept').notNull(),
  energy: integer('energy').notNull(),     // 0-10
  mood: integer('mood').notNull(),         // 0-10
  medicationTaken: text('medication_taken').notNull(), // "yes" or "no"
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Today plans
export const todayPlans = sqliteTable('today_plans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull().unique(),
  energyLevel: integer('energy_level').notNull(),
  createdAt: text('created_at').notNull(),
});

// Today plan items (join table)
export const todayPlanItems = sqliteTable('today_plan_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  planId: integer('plan_id').notNull().references(() => todayPlans.id),
  taskId: integer('task_id').notNull().references(() => tasks.id),
  category: text('category', { enum: ['must-do', 'want-to', 'health'] }).notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  snoozed: integer('snoozed', { mode: 'boolean' }).notNull().default(false),
});

// Plan exports (track when plans are exported to Google Calendar)
export const planExports = sqliteTable('plan_exports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  planId: integer('plan_id').notNull().references(() => todayPlans.id),
  calendarId: text('calendar_id').notNull(), // Google Calendar ID
  exportedAt: text('exported_at').notNull(), // ISO datetime
  taskCount: integer('task_count').notNull(), // Number of tasks exported
  status: text('status', { enum: ['success', 'partial', 'failed'] }).notNull(),
  error: text('error'), // Error message if failed
}, (table) => ({
  userIdx: index('idx_plan_exports_user').on(table.userId),
  planIdx: index('idx_plan_exports_plan').on(table.planId),
  exportedAtIdx: index('idx_plan_exports_exported_at').on(table.exportedAt),
}));

// OAuth tokens (for Google Calendar/Tasks sync)
export const oauthTokens = sqliteTable('oauth_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  provider: text('provider').notNull(), // 'google'
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: text('expires_at').notNull(), // ISO datetime
  scope: text('scope').notNull(), // JSON array of scopes
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  userProviderUnique: uniqueIndex('oauth_tokens_user_provider_unique').on(table.userId, table.provider),
  userIdx: index('idx_oauth_tokens_user').on(table.userId),
}));

// Task sync metadata (extends tasks with Google sync info)
export const taskSyncMetadata = sqliteTable('task_sync_metadata', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }).unique(),
  googleTaskId: text('google_task_id'),
  googleEventId: text('google_event_id'),
  isFixed: integer('is_fixed', { mode: 'boolean' }).notNull().default(false),
  lastSyncTime: text('last_sync_time'), // ISO datetime
  syncStatus: text('sync_status', { enum: ['synced', 'pending', 'failed'] }).notNull(),
  syncError: text('sync_error'),
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  taskIdx: index('idx_task_sync_metadata_task').on(table.taskId),
  googleTaskIdx: index('idx_task_sync_metadata_google_task').on(table.googleTaskId),
  googleEventIdx: index('idx_task_sync_metadata_google_event').on(table.googleEventId),
}));

// Sync operation queue (for retry logic)
export const syncQueue = sqliteTable('sync_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  operation: text('operation', { enum: ['create', 'update', 'complete', 'delete'] }).notNull(),
  entityType: text('entity_type', { enum: ['task', 'event'] }).notNull(),
  entityId: integer('entity_id').notNull(),
  payload: text('payload').notNull(), // JSON payload
  status: text('status', { enum: ['pending', 'processing', 'failed', 'completed'] }).notNull(),
  error: text('error'),
  retryCount: integer('retry_count').notNull().default(0),
  nextRetryAt: text('next_retry_at'), // ISO datetime
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  userStatusIdx: index('idx_sync_queue_user_status').on(table.userId, table.status),
  nextRetryIdx: index('idx_sync_queue_next_retry').on(table.nextRetryAt),
}));

// Sync log (for debugging and audit trail)
export const syncLog = sqliteTable('sync_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  operation: text('operation').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  status: text('status', { enum: ['success', 'failure'] }).notNull(),
  details: text('details'), // JSON details
  timestamp: text('timestamp').notNull(), // ISO datetime
}, (table) => ({
  userTimestampIdx: index('idx_sync_log_user_timestamp').on(table.userId, table.timestamp),
}));
