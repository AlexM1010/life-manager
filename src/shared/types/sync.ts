/**
 * Google Calendar Sync Types
 * 
 * These types define the data structures for Google Calendar and Tasks integration.
 */

// OAuth Token Types
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string[];
}

export interface OAuthTokenRow {
  id: number;
  userId: number;
  provider: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO datetime
  scope: string; // JSON array
  createdAt: string;
  updatedAt: string;
}

// Task Sync Metadata Types
export type SyncStatus = 'synced' | 'pending' | 'failed';

export interface TaskSyncMetadata {
  id: number;
  taskId: number;
  googleTaskId?: string;
  googleEventId?: string;
  isFixed: boolean;
  lastSyncTime?: string; // ISO datetime
  syncStatus: SyncStatus;
  syncError?: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

// Sync Queue Types
export type SyncOperation = 'create' | 'update' | 'complete' | 'delete';
export type SyncEntityType = 'task' | 'event';
export type SyncQueueStatus = 'pending' | 'processing' | 'failed' | 'completed';

export interface SyncQueueItem {
  id: number;
  userId: number;
  operation: SyncOperation;
  entityType: SyncEntityType;
  entityId: number;
  payload: string; // JSON payload
  status: SyncQueueStatus;
  error?: string;
  retryCount: number;
  nextRetryAt?: string; // ISO datetime
  createdAt: string;
  updatedAt: string;
}

export interface SyncQueuePayload {
  taskId: number;
  data?: Record<string, any>;
}

// Sync Log Types
export type SyncLogStatus = 'success' | 'failure';

export interface SyncLogEntry {
  id: number;
  userId: number;
  operation: string;
  entityType: string;
  entityId?: string;
  status: SyncLogStatus;
  details?: string; // JSON details
  timestamp: string; // ISO datetime
}

export interface SyncLogDetails {
  message?: string;
  error?: string;
  googleTaskId?: string;
  googleEventId?: string;
  [key: string]: any;
}

// Google Calendar Types
export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  attendees?: string[];
  recurringEventId?: string;
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
}

// Google Tasks Types
export interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  due?: Date;
  status: 'needsAction' | 'completed';
  parent?: string;
}

export interface GoogleTaskInput {
  title: string;
  notes?: string;
  due?: Date;
}

// Sync Engine Types
export interface ImportResult {
  calendarEventsImported: number;
  tasksImported: number;
  conflicts: Conflict[];
  errors: SyncError[];
}

export interface SyncStatusInfo {
  lastSyncTime?: Date;
  pendingOperations: number;
  failedOperations: SyncError[];
  isConnected: boolean;
}

export interface SyncError {
  operation: 'import' | 'export';
  entityType: 'task' | 'event';
  entityId: string;
  error: string;
  timestamp: Date;
  retryCount: number;
}

export interface Conflict {
  type: 'overlap' | 'duplicate';
  entities: string[];
  description: string;
}

// Time-Blocking Types
export interface TimeBlock {
  taskId: string;
  start: Date;
  end: Date;
  isFixed: boolean;
}

export interface Schedule {
  timeBlocks: TimeBlock[];
  unscheduledTasks: number[];
  conflicts: Conflict[];
}

export interface EnergyProfile {
  peakHours: number[]; // Hours of day (0-23)
  lowHours: number[];
  preferredTaskDuration: number; // minutes
}
