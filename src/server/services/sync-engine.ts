import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, lte } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { tasks, taskSyncMetadata, syncLog, syncQueue } from '../db/schema.js';
import { OAuthManager } from './oauth-manager.js';
import { GoogleCalendarClient, CalendarEvent } from './google-calendar-client.js';
import { GoogleTasksClient, GoogleTask } from './google-tasks-client.js';
import pRetry, { AbortError } from 'p-retry';

/**
 * Sync Engine
 * 
 * Orchestrates synchronization between Life Manager and Google Calendar/Tasks.
 * 
 * Design Principles:
 * 1. RELIABILITY: Operations should be atomic where possible
 * 2. IDEMPOTENCY: Same operation twice = same result
 * 3. GRACEFUL DEGRADATION: Partial failures don't corrupt state
 * 4. AUDITABILITY: All operations are logged
 * 
 * Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.4, 3.5, 3.6, 4.1, 4.4, 5.1, 5.2, 5.5, 6.1, 6.2, 6.3, 6.5
 */

// ============================================================================
// Types
// ============================================================================

export interface ImportResult {
  calendarEventsImported: number;
  tasksImported: number;
  conflicts: Conflict[];
  errors: SyncError[];
}

export interface SyncStatus {
  lastSyncTime: Date | null;
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

interface TaskData {
  id: number;
  title: string;
  description: string | null;
  domainId: number;
  priority: string;
  estimatedMinutes: number;
  dueDate: string | null;
  status: string;
}

// ============================================================================
// Sync Engine Class
// ============================================================================

export class SyncEngine {
  private calendarClient: GoogleCalendarClient;
  private tasksClient: GoogleTasksClient;
  private isProcessingQueuedOperation = false; // Track if we're in a retry

  /**
   * Retry configuration for p-retry
   * 
   * Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 60s
   * Max 5 retries (6 total attempts)
   * Can be overridden for testing
   */
  private retryOptions = {
    retries: 5,
    factor: 2,
    minTimeout: 1000,
    maxTimeout: 60000,
    randomize: false,
    onFailedAttempt: (error: any) => {
      console.log(
        `Attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`
      );
    },
  };

  constructor(
    private db: ReturnType<typeof drizzle<typeof schema>>,
    private oauthManager: OAuthManager,
    private userId: number,
    private defaultDomainId: number = 1,
    retryOptions?: Partial<typeof SyncEngine.prototype.retryOptions>
  ) {
    this.calendarClient = new GoogleCalendarClient();
    this.tasksClient = new GoogleTasksClient();
    
    // Allow overriding retry options (useful for testing)
    if (retryOptions) {
      this.retryOptions = { ...this.retryOptions, ...retryOptions };
    }
  }

  // ==========================================================================
  // Import Operations (Google → Life Manager)
  // ==========================================================================

  /**
   * Import from Google (Morning Import)
   * 
   * Orchestrates the one-way sync from Google to Life Manager.
   * Each item is imported independently - one failure doesn't stop others.
   */
  async importFromGoogle(): Promise<ImportResult> {
    const result: ImportResult = {
      calendarEventsImported: 0,
      tasksImported: 0,
      conflicts: [],
      errors: [],
    };

    let oauth2Client: any;
    try {
      console.log('[SyncEngine] Getting OAuth2 client for userId:', this.userId);
      oauth2Client = await this.oauthManager.getOAuth2Client(this.userId);
      console.log('[SyncEngine] OAuth2 client obtained successfully');
    } catch (error) {
      console.error('[SyncEngine] Failed to get OAuth2 client:', error);
      result.errors.push(this.createSyncError('import', 'task', 'auth', error));
      return result;
    }

    // Ensure default domain exists before importing
    await this.ensureDefaultDomain();

    // Import calendar events
    await this.importCalendarEvents(oauth2Client, result);
    
    // Import Google Tasks
    await this.importGoogleTasks(oauth2Client, result);

    return result;
  }

  private async importCalendarEvents(oauth2Client: any, result: ImportResult): Promise<void> {
    try {
      // Wrap API call with retry logic
      console.log('[SyncEngine] Fetching calendar events...');
      const events = await this.withRetry(
        () => this.calendarClient.getTodayEvents(oauth2Client),
        'importCalendarEvents - getTodayEvents'
      );
      console.log(`[SyncEngine] Got ${events.length} calendar events`);
      
      // Detect conflicts before importing
      const conflicts = await this.detectConflicts(events);
      result.conflicts.push(...conflicts);
      
      // Resolve conflicts (logs them)
      if (conflicts.length > 0) {
        await this.resolveConflicts(conflicts);
      }
      
      // Import all events (even if conflicts exist)
      for (const event of events) {
        try {
          await this.importCalendarEvent(event);
          result.calendarEventsImported++;
        } catch (error) {
          console.error(`[SyncEngine] Failed to import calendar event "${event.summary}" (${event.id}):`, error instanceof Error ? error.message : error);
          result.errors.push(this.createSyncError('import', 'event', event.id, error));
        }
      }

      await this.logSync('import', 'event', null, 'success', {
        count: result.calendarEventsImported,
        conflicts: conflicts.length,
        errors: result.errors.filter(e => e.entityType === 'event').length,
      });
    } catch (error) {
      result.errors.push(this.createSyncError('import', 'event', 'all', error));
      await this.logSync('import', 'event', null, 'failure', {
        error: this.getErrorMessage(error),
      });
    }
  }

  private async importGoogleTasks(oauth2Client: any, result: ImportResult): Promise<void> {
    try {
      // Wrap API call with retry logic
      console.log('[SyncEngine] Fetching Google Tasks...');
      const googleTasks = await this.withRetry(
        () => this.tasksClient.getTodayTasks(oauth2Client),
        'importGoogleTasks - getTodayTasks'
      );
      console.log(`[SyncEngine] Got ${googleTasks.length} Google Tasks`);
      
      for (const task of googleTasks) {
        try {
          await this.importGoogleTask(task);
          result.tasksImported++;
        } catch (error) {
          console.error(`[SyncEngine] Failed to import Google Task "${task.title}" (${task.id}):`, error instanceof Error ? error.message : error);
          result.errors.push(this.createSyncError('import', 'task', task.id, error));
        }
      }

      await this.logSync('import', 'task', null, 'success', {
        count: result.tasksImported,
        errors: result.errors.filter(e => e.entityType === 'task').length,
      });
    } catch (error) {
      result.errors.push(this.createSyncError('import', 'task', 'all', error));
      await this.logSync('import', 'task', null, 'failure', {
        error: this.getErrorMessage(error),
      });
    }
  }

  /**
   * Import calendar event as Fixed Task
   * 
   * IDEMPOTENT: Same event imported twice = same result (update, not duplicate)
   */
  async importCalendarEvent(event: CalendarEvent): Promise<void> {
    const now = new Date().toISOString();

    // Check for existing by Google Event ID (idempotency)
    const existing = await this.db
      .select()
      .from(taskSyncMetadata)
      .where(eq(taskSyncMetadata.googleEventId, event.id))
      .limit(1);

    if (existing.length > 0) {
      // Update existing task
      await this.updateExistingCalendarTask(existing[0], event, now);
    } else {
      // Create new Fixed Task
      await this.createNewCalendarTask(event, now);
    }
  }

  private async updateExistingCalendarTask(
    metadata: typeof taskSyncMetadata.$inferSelect,
    event: CalendarEvent,
    now: string
  ): Promise<void> {
    const description = this.buildEventDescription(event);

    await this.db
      .update(tasks)
      .set({
        title: event.summary,
        description,
        updatedAt: now,
      })
      .where(eq(tasks.id, metadata.taskId));

    await this.db
      .update(taskSyncMetadata)
      .set({
        lastSyncTime: now,
        syncStatus: 'synced',
        syncError: null,
        updatedAt: now,
      })
      .where(eq(taskSyncMetadata.id, metadata.id));
  }

  private async createNewCalendarTask(event: CalendarEvent, now: string): Promise<void> {
    const durationMinutes = Math.round(
      (event.end.getTime() - event.start.getTime()) / (1000 * 60)
    );
    const description = this.buildEventDescription(event);

    const [createdTask] = await this.db
      .insert(tasks)
      .values({
        title: event.summary,
        description,
        domainId: this.defaultDomainId,
        priority: 'must-do',
        estimatedMinutes: durationMinutes,
        dueDate: event.start.toISOString().split('T')[0],
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await this.db
      .insert(taskSyncMetadata)
      .values({
        taskId: createdTask.id,
        googleEventId: event.id,
        isFixed: true,
        lastSyncTime: now,
        syncStatus: 'synced',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });
  }

  /**
   * Import Google Task as Flexible Task
   * 
   * IDEMPOTENT: Same task imported twice = same result (update, not duplicate)
   */
  async importGoogleTask(googleTask: GoogleTask): Promise<void> {
    const now = new Date().toISOString();

    // Check for existing by Google Task ID (idempotency)
    const existing = await this.db
      .select()
      .from(taskSyncMetadata)
      .where(eq(taskSyncMetadata.googleTaskId, googleTask.id))
      .limit(1);

    if (existing.length > 0) {
      await this.updateExistingGoogleTask(existing[0], googleTask, now);
    } else {
      await this.createNewGoogleTask(googleTask, now);
    }
  }

  private async updateExistingGoogleTask(
    metadata: typeof taskSyncMetadata.$inferSelect,
    googleTask: GoogleTask,
    now: string
  ): Promise<void> {
    await this.db
      .update(tasks)
      .set({
        title: googleTask.title,
        description: googleTask.notes || null,
        dueDate: googleTask.due ? googleTask.due.toISOString().split('T')[0] : null,
        status: googleTask.status === 'completed' ? 'done' : 'todo',
        updatedAt: now,
      })
      .where(eq(tasks.id, metadata.taskId));

    await this.db
      .update(taskSyncMetadata)
      .set({
        lastSyncTime: now,
        syncStatus: 'synced',
        syncError: null,
        updatedAt: now,
      })
      .where(eq(taskSyncMetadata.id, metadata.id));
  }

  private async createNewGoogleTask(googleTask: GoogleTask, now: string): Promise<void> {
    const [createdTask] = await this.db
      .insert(tasks)
      .values({
        title: googleTask.title,
        description: googleTask.notes || null,
        domainId: this.defaultDomainId,
        priority: 'should-do',
        estimatedMinutes: 30,
        dueDate: googleTask.due ? googleTask.due.toISOString().split('T')[0] : null,
        status: googleTask.status === 'completed' ? 'done' : 'todo',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await this.db
      .insert(taskSyncMetadata)
      .values({
        taskId: createdTask.id,
        googleTaskId: googleTask.id,
        isFixed: false,
        lastSyncTime: now,
        syncStatus: 'synced',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });
  }

  // ==========================================================================
  // Export Operations (Life Manager → Google)
  // ==========================================================================

  /**
   * Export task completion to Google
   * 
   * GRACEFUL: Returns early if task has no sync metadata (never synced)
   * IDEMPOTENT: Completing an already-completed task is safe
   * RETRY: Automatically retries with exponential backoff on failures
   */
  async exportTaskCompletion(taskId: number): Promise<void> {
    const metadata = await this.getSyncMetadata(taskId);
    
    if (!metadata) {
      console.warn(`No sync metadata for task ${taskId}, skipping completion export`);
      return;
    }

    if (!metadata.googleTaskId) {
      console.warn(`No Google Task ID for task ${taskId}, skipping completion export`);
      return;
    }

    const now = new Date().toISOString();

    try {
      const oauth2Client = await this.oauthManager.getOAuth2Client(this.userId);
      
      // Wrap API call with retry logic
      await this.withRetry(
        () => this.tasksClient.completeTask(oauth2Client, metadata.googleTaskId!),
        `exportTaskCompletion(${taskId})`
      );
      
      await this.markSyncSuccess(metadata.id, now);
      await this.logSync('export', 'task', taskId.toString(), 'success', {
        operation: 'complete',
        googleTaskId: metadata.googleTaskId,
      });
    } catch (error) {
      await this.markSyncFailure(taskId, error, now);
      
      // Check if this is a non-retryable error (AbortError from p-retry)
      const isNonRetryable = this.isAbortError(error);
      
      // Only queue if not already processing a queued operation (avoid double-queueing)
      if (!isNonRetryable && !this.isProcessingQueuedOperation) {
        await this.queueOperation('complete', 'task', taskId, {}, error);
      }
      
      await this.logSync('export', 'task', taskId.toString(), 'failure', {
        operation: 'complete',
        error: this.getErrorMessage(error),
        queued: !isNonRetryable && !this.isProcessingQueuedOperation,
      });
      throw error;
    }
  }

  /**
   * Export new task to Google
   * 
   * ATOMIC: If Google Task creation fails, no Calendar Event is created
   * IDEMPOTENT: If sync metadata already exists, this is a no-op
   * ROLLBACK: If Calendar Event fails after Task succeeds, we still save the Task ID
   * RETRY: Automatically retries with exponential backoff on failures
   */
  async exportNewTask(taskId: number): Promise<void> {
    // Check if already synced (idempotency)
    const existingMetadata = await this.getSyncMetadata(taskId);
    if (existingMetadata?.googleTaskId || existingMetadata?.googleEventId) {
      console.warn(`Task ${taskId} already has sync metadata, skipping export`);
      return;
    }

    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const now = new Date().toISOString();
    let googleTaskId: string | null = null;
    let googleEventId: string | null = null;

    try {
      const oauth2Client = await this.oauthManager.getOAuth2Client(this.userId);

      // Step 1: Create Google Task with retry
      googleTaskId = await this.withRetry(
        () => this.tasksClient.createTask(oauth2Client, {
          title: task.title,
          notes: task.description || undefined,
          due: task.dueDate ? new Date(task.dueDate) : undefined,
        }),
        `exportNewTask(${taskId}) - createTask`
      );

      // Step 2: Create Calendar Event with retry
      const { start, end } = this.calculateTimeBlock(task);
      googleEventId = await this.withRetry(
        () => this.calendarClient.createEvent(oauth2Client, {
          summary: task.title,
          description: task.description || undefined,
          start,
          end,
        }),
        `exportNewTask(${taskId}) - createEvent`
      );

      // Step 3: Save sync metadata (both succeeded)
      await this.createSyncMetadata(taskId, googleTaskId, googleEventId, now);
      
      await this.logSync('export', 'task', taskId.toString(), 'success', {
        operation: 'create',
        googleTaskId,
        googleEventId,
      });
    } catch (error) {
      // Partial success handling: save whatever we created
      await this.createOrUpdateSyncMetadataOnFailure(
        taskId, 
        googleTaskId, 
        googleEventId, 
        error, 
        now
      );
      
      // Queue for retry if not a non-retryable error
      const isNonRetryable = this.isAbortError(error);
      if (!isNonRetryable) {
        await this.queueOperation('create', 'task', taskId, {
          title: task.title,
          description: task.description,
          dueDate: task.dueDate,
        }, error);
      }
      
      await this.logSync('export', 'task', taskId.toString(), 'failure', {
        operation: 'create',
        googleTaskId,
        googleEventId,
        error: this.getErrorMessage(error),
        queued: !isNonRetryable,
      });
      
      throw error;
    }
  }

  /**
   * Export task modification to Google
   * 
   * GRACEFUL: Returns early if task has no sync metadata
   * PARTIAL SUCCESS: Updates whichever service has an ID, logs failures
   * RETRY: Automatically retries with exponential backoff on failures
   */
  async exportTaskModification(taskId: number): Promise<void> {
    const metadata = await this.getSyncMetadata(taskId);
    
    if (!metadata) {
      console.warn(`No sync metadata for task ${taskId}, skipping modification export`);
      return;
    }

    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const now = new Date().toISOString();
    const errors: Error[] = [];

    try {
      const oauth2Client = await this.oauthManager.getOAuth2Client(this.userId);

      // Update Google Task (if we have an ID) with retry
      if (metadata.googleTaskId) {
        try {
          await this.withRetry(
            () => this.tasksClient.updateTask(oauth2Client, metadata.googleTaskId!, {
              title: task.title,
              notes: task.description || undefined,
              due: task.dueDate ? new Date(task.dueDate) : undefined,
            }),
            `exportTaskModification(${taskId}) - updateTask`
          );
        } catch (error) {
          errors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }

      // Update Calendar Event (if we have an ID) with retry
      if (metadata.googleEventId) {
        try {
          const { start, end } = this.calculateTimeBlock(task);
          await this.withRetry(
            () => this.calendarClient.updateEvent(oauth2Client, metadata.googleEventId!, {
              summary: task.title,
              description: task.description || undefined,
              start,
              end,
            }),
            `exportTaskModification(${taskId}) - updateEvent`
          );
        } catch (error) {
          errors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }

      // If any errors occurred, mark as failed
      if (errors.length > 0) {
        const combinedError = new Error(errors.map(e => e.message).join('; '));
        await this.markSyncFailure(taskId, combinedError, now);
        
        // Queue for retry if not all errors are non-retryable
        const hasRetryableError = errors.some(e => !this.isAbortError(e));
        if (hasRetryableError) {
          await this.queueOperation('update', 'task', taskId, {
            title: task.title,
            description: task.description,
            dueDate: task.dueDate,
          }, combinedError);
        }
        
        await this.logSync('export', 'task', taskId.toString(), 'failure', {
          operation: 'update',
          errors: errors.map(e => e.message),
          queued: hasRetryableError,
        });
        throw combinedError;
      }

      // All succeeded
      await this.markSyncSuccess(metadata.id, now);
      await this.logSync('export', 'task', taskId.toString(), 'success', {
        operation: 'update',
        googleTaskId: metadata.googleTaskId,
        googleEventId: metadata.googleEventId,
      });
    } catch (error) {
      if (errors.length === 0) {
        // OAuth or other pre-operation error
        await this.markSyncFailure(taskId, error, now);
        
        // Queue for retry if not a non-retryable error
        const isNonRetryable = this.isAbortError(error);
        if (!isNonRetryable) {
          await this.queueOperation('update', 'task', taskId, {
            title: task.title,
            description: task.description,
            dueDate: task.dueDate,
          }, error);
        }
        
        await this.logSync('export', 'task', taskId.toString(), 'failure', {
          operation: 'update',
          error: this.getErrorMessage(error),
          queued: !isNonRetryable,
        });
      }
      throw error;
    }
  }

  // ==========================================================================
  // Status & Query Methods
  // ==========================================================================

  async getSyncStatus(): Promise<SyncStatus & { hasTokens?: boolean; connectionError?: string }> {
    const lastSync = await this.db
      .select()
      .from(syncLog)
      .where(eq(syncLog.userId, this.userId))
      .orderBy(syncLog.timestamp)
      .limit(1);

    const failedMetadata = await this.db
      .select()
      .from(taskSyncMetadata)
      .where(eq(taskSyncMetadata.syncStatus, 'failed'));

    const failedOperations: SyncError[] = failedMetadata.map((m) => ({
      operation: 'export' as const,
      entityType: 'task' as const,
      entityId: m.taskId.toString(),
      error: m.syncError || 'Unknown error',
      timestamp: new Date(m.updatedAt),
      retryCount: m.retryCount,
    }));

    let isConnected = false;
    let hasTokens = false;
    let connectionError: string | undefined;
    
    try {
      // First check if tokens exist at all
      const tokens = await this.oauthManager.getTokens(this.userId, 'google');
      hasTokens = tokens !== null;
      
      if (hasTokens) {
        // Tokens exist, try to get a working OAuth client
        await this.oauthManager.getOAuth2Client(this.userId);
        isConnected = true;
      }
    } catch (error) {
      // Tokens exist but something went wrong (refresh failed, etc.)
      connectionError = this.getErrorMessage(error);
      console.error('[SyncEngine] OAuth connection check failed:', connectionError);
    }

    const pendingOperations = await this.getPendingOperationsCount();

    return {
      lastSyncTime: lastSync.length > 0 ? new Date(lastSync[0].timestamp) : null,
      pendingOperations,
      failedOperations,
      isConnected,
      hasTokens,
      connectionError,
    };
  }

  // ==========================================================================
  // Conflict Detection and Resolution
  // ==========================================================================

  /**
   * Detect overlapping calendar events
   * 
   * Checks if two time ranges overlap
   * Two events overlap if one starts before the other ends
   * 
   * Requirements: 8.1
   */
  private detectOverlap(
    start1: Date,
    end1: Date,
    start2: Date,
    end2: Date
  ): boolean {
    // Events overlap if:
    // - Event 1 starts before Event 2 ends AND
    // - Event 2 starts before Event 1 ends
    return start1 < end2 && start2 < end1;
  }

  /**
   * Detect all conflicts in a set of calendar events
   * 
   * Returns array of conflicts where events have overlapping time ranges
   * 
   * Requirements: 8.1
   */
  async detectConflicts(events: CalendarEvent[]): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];
    const seen = new Set<string>();

    // Check each pair of events for overlap
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const event1 = events[i];
        const event2 = events[j];

        if (this.detectOverlap(event1.start, event1.end, event2.start, event2.end)) {
          // Create a unique key for this conflict pair
          const conflictKey = [event1.id, event2.id].sort().join('-');
          
          if (!seen.has(conflictKey)) {
            seen.add(conflictKey);
            conflicts.push({
              type: 'overlap',
              entities: [event1.id, event2.id],
              description: `"${event1.summary}" (${this.formatTime(event1.start)}-${this.formatTime(event1.end)}) overlaps with "${event2.summary}" (${this.formatTime(event2.start)}-${this.formatTime(event2.end)})`,
            });
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * Resolve conflicts using "Life Manager wins" strategy
   * 
   * When conflicts occur between Life Manager and Google:
   * - During Morning Import: Detect and log conflicts, but import all events
   * - During Real-Time Sync: Life Manager data always overwrites Google data
   * 
   * Requirements: 8.5, 10.1, 10.2, 10.4
   */
  async resolveConflicts(conflicts: Conflict[]): Promise<void> {
    // Log all conflicts
    for (const conflict of conflicts) {
      await this.logConflict(conflict);
    }

    // During Morning Import, we just log conflicts
    // Life Manager wins strategy is enforced during Real-Time Sync
    // by always exporting Life Manager's data to Google
  }

  /**
   * Log a conflict for debugging and user notification
   * 
   * Requirements: 8.5, 10.5
   */
  private async logConflict(conflict: Conflict): Promise<void> {
    const now = new Date().toISOString();

    await this.db.insert(syncLog).values({
      userId: this.userId,
      operation: 'conflict',
      entityType: 'event',
      entityId: conflict.entities.join(','),
      status: 'failure',
      details: JSON.stringify({
        type: conflict.type,
        description: conflict.description,
        entities: conflict.entities,
      }),
      timestamp: now,
    });
  }

  /**
   * Format time for display in conflict messages
   */
  private formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Ensure the default domain exists for imported tasks
   * Creates a "Google" domain if the defaultDomainId doesn't exist
   */
  private async ensureDefaultDomain(): Promise<void> {
    const existing = await this.db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.id, this.defaultDomainId))
      .limit(1);

    if (existing.length === 0) {
      const now = new Date().toISOString();
      // Check if any domain exists at all
      const anyDomain = await this.db.select().from(schema.domains).limit(1);
      
      if (anyDomain.length > 0) {
        // Use the first existing domain instead
        this.defaultDomainId = anyDomain[0].id;
        console.log(`[SyncEngine] Using existing domain ${anyDomain[0].name} (id: ${this.defaultDomainId})`);
      } else {
        // Create a default domain
        const [created] = await this.db
          .insert(schema.domains)
          .values({
            name: 'Google Import',
            description: 'Tasks and events imported from Google',
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        this.defaultDomainId = created.id;
        console.log(`[SyncEngine] Created default domain "Google Import" (id: ${this.defaultDomainId})`);
      }
    }
  }

  private async getTask(taskId: number): Promise<TaskData | null> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    return rows[0] || null;
  }

  private async getSyncMetadata(taskId: number) {
    const rows = await this.db
      .select()
      .from(taskSyncMetadata)
      .where(eq(taskSyncMetadata.taskId, taskId))
      .limit(1);
    return rows[0] || null;
  }

  private async markSyncSuccess(metadataId: number, now: string): Promise<void> {
    await this.db
      .update(taskSyncMetadata)
      .set({
        lastSyncTime: now,
        syncStatus: 'synced',
        syncError: null,
        retryCount: 0,
        updatedAt: now,
      })
      .where(eq(taskSyncMetadata.id, metadataId));
  }

  private async markSyncFailure(taskId: number, error: unknown, now: string): Promise<void> {
    const existing = await this.getSyncMetadata(taskId);
    if (!existing) return;

    const newRetryCount = (existing.retryCount || 0) + 1;
    
    await this.db
      .update(taskSyncMetadata)
      .set({
        syncStatus: 'failed',
        syncError: this.getErrorMessage(error),
        retryCount: newRetryCount,
        updatedAt: now,
      })
      .where(eq(taskSyncMetadata.taskId, taskId));
  }

  private async createSyncMetadata(
    taskId: number,
    googleTaskId: string,
    googleEventId: string,
    now: string
  ): Promise<void> {
    await this.db
      .insert(taskSyncMetadata)
      .values({
        taskId,
        googleTaskId,
        googleEventId,
        isFixed: false,
        lastSyncTime: now,
        syncStatus: 'synced',
        syncError: null,
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });
  }

  private async createOrUpdateSyncMetadataOnFailure(
    taskId: number,
    googleTaskId: string | null,
    googleEventId: string | null,
    error: unknown,
    now: string
  ): Promise<void> {
    const existing = await this.getSyncMetadata(taskId);
    const errorMessage = this.getErrorMessage(error);

    if (existing) {
      // Update existing metadata with partial success
      await this.db
        .update(taskSyncMetadata)
        .set({
          googleTaskId: googleTaskId || existing.googleTaskId,
          googleEventId: googleEventId || existing.googleEventId,
          syncStatus: 'failed',
          syncError: errorMessage,
          retryCount: (existing.retryCount || 0) + 1,
          updatedAt: now,
        })
        .where(eq(taskSyncMetadata.taskId, taskId));
    } else {
      // Create new metadata with partial success
      await this.db
        .insert(taskSyncMetadata)
        .values({
          taskId,
          googleTaskId,
          googleEventId,
          isFixed: false,
          lastSyncTime: null,
          syncStatus: 'failed',
          syncError: errorMessage,
          retryCount: 1,
          createdAt: now,
          updatedAt: now,
        });
    }
  }

  private calculateTimeBlock(task: TaskData): { start: Date; end: Date } {
    const dueDate = task.dueDate ? new Date(task.dueDate) : new Date();
    const start = new Date(dueDate);
    start.setHours(9, 0, 0, 0); // Default to 9 AM
    
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + task.estimatedMinutes);
    
    return { start, end };
  }

  private buildEventDescription(event: CalendarEvent): string {
    const parts: string[] = [];

    if (event.description) {
      parts.push(event.description);
    }

    if (event.location) {
      parts.push(`📍 Location: ${event.location}`);
    }

    if (event.attendees && event.attendees.length > 0) {
      parts.push(`👥 Attendees: ${event.attendees.join(', ')}`);
    }

    const startTime = event.start.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const endTime = event.end.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    parts.push(`🕐 Time: ${startTime} - ${endTime}`);

    return parts.join('\n\n');
  }

  private async logSync(
    operation: string,
    entityType: string,
    entityId: string | null,
    status: 'success' | 'failure',
    details?: unknown
  ): Promise<void> {
    const now = new Date().toISOString();

    await this.db.insert(syncLog).values({
      userId: this.userId,
      operation,
      entityType,
      entityId,
      status,
      details: details ? JSON.stringify(details) : null,
      timestamp: now,
    });
  }

  private createSyncError(
    operation: 'import' | 'export',
    entityType: 'task' | 'event',
    entityId: string,
    error: unknown
  ): SyncError {
    return {
      operation,
      entityType,
      entityId,
      error: this.getErrorMessage(error),
      timestamp: new Date(),
      retryCount: 0,
    };
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Unknown error';
  }

  // ==========================================================================
  // Retry Queue and Error Handling
  // ==========================================================================

  /**
   * Wrap API call with retry logic
   * 
   * Automatically retries on network errors and 5xx server errors
   * Marks error as non-retryable for 404, 401, 403, 400
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    try {
      return await pRetry(async () => {
        try {
          return await operation();
        } catch (error: any) {
          // Check for non-retryable errors
          if (this.isNonRetryableError(error)) {
            // Mark error as non-retryable so we can detect it later
            (error as any).__isNonRetryable = true;
            // Throw AbortError to stop retrying
            const abortError = new AbortError(this.getErrorMessage(error));
            // Preserve original error for reference
            (abortError as any).originalError = error;
            throw abortError;
          }

          // Check for rate limiting
          if (this.isRateLimitError(error)) {
            console.warn(`Rate limit hit for ${context}, will retry with backoff`);
            throw error; // Will be retried with exponential backoff
          }

          // Check for offline/network errors
          if (this.isNetworkError(error)) {
            console.warn(`Network error for ${context}, will retry`);
            throw error; // Will be retried
          }

          // Other errors - retry
          throw error;
        }
      }, this.retryOptions);
    } catch (error) {
      // p-retry throws the original error (not AbortError) when aborted
      // Check if the error was marked as non-retryable
      if ((error as any)?.__isNonRetryable) {
        (error as any).__wasAborted = true;
      }
      throw error;
    }
  }

  /**
   * Check if error is non-retryable (404, 401, 403, 400)
   */
  private isNonRetryableError(error: any): boolean {
    const statusCode = error?.response?.status || error?.code;
    return [400, 401, 403, 404].includes(statusCode);
  }

  /**
   * Check if error is an AbortError from p-retry
   * 
   * p-retry throws the original error (not AbortError) when aborted,
   * so we check for our custom marker that we added in withRetry
   */
  private isAbortError(error: any): boolean {
    return (
      error instanceof AbortError ||
      error?.name === 'AbortError' ||
      error?.constructor?.name === 'AbortError' ||
      error?.originalError !== undefined ||
      error?.__wasAborted === true ||
      error?.__isNonRetryable === true
    );
  }

  /**
   * Check if error is rate limiting (429)
   */
  private isRateLimitError(error: any): boolean {
    const statusCode = error?.response?.status || error?.code;
    return statusCode === 429;
  }

  /**
   * Check if error is network-related
   */
  private isNetworkError(error: any): boolean {
    const code = error?.code;
    const message = this.getErrorMessage(error).toLowerCase();
    
    return (
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('connection')
    );
  }

  /**
   * Queue operation for retry
   * 
   * Adds operation to sync_queue table for later retry
   */
  private async queueOperation(
    operation: 'create' | 'update' | 'complete' | 'delete',
    entityType: 'task' | 'event',
    entityId: number,
    payload: any,
    error: unknown
  ): Promise<void> {
    const now = new Date().toISOString();
    const nextRetryAt = this.calculateNextRetry(0);

    await this.db.insert(syncQueue).values({
      userId: this.userId,
      operation,
      entityType,
      entityId,
      payload: JSON.stringify(payload),
      status: 'pending',
      error: this.getErrorMessage(error),
      retryCount: 0,
      nextRetryAt,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Calculate next retry time with exponential backoff
   */
  private calculateNextRetry(retryCount: number): string {
    const baseDelay = 1000; // 1 second
    const maxDelay = 60000; // 60 seconds
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    
    const nextRetry = new Date(Date.now() + delay);
    return nextRetry.toISOString();
  }

  /**
   * Retry failed operations from queue
   * 
   * Processes all pending operations that are ready for retry
   */
  async retryFailedOperations(): Promise<void> {
    const now = new Date().toISOString();

    // Get all pending operations ready for retry
    const pendingOps = await this.db
      .select()
      .from(syncQueue)
      .where(
        and(
          eq(syncQueue.userId, this.userId),
          eq(syncQueue.status, 'pending'),
          lte(syncQueue.nextRetryAt, now)
        )
      );

    for (const op of pendingOps) {
      await this.processQueuedOperation(op);
    }
  }

  /**
   * Process a single queued operation
   */
  private async processQueuedOperation(
    op: typeof syncQueue.$inferSelect
  ): Promise<void> {
    const now = new Date().toISOString();

    // Mark as processing
    await this.db
      .update(syncQueue)
      .set({ status: 'processing', updatedAt: now })
      .where(eq(syncQueue.id, op.id));

    try {
      const payload = JSON.parse(op.payload);

      // Set flag to prevent double-queueing
      this.isProcessingQueuedOperation = true;

      // Execute the operation based on type
      switch (op.operation) {
        case 'create':
          await this.exportNewTask(op.entityId);
          break;
        case 'update':
          await this.exportTaskModification(op.entityId);
          break;
        case 'complete':
          await this.exportTaskCompletion(op.entityId);
          break;
        case 'delete':
          // TODO: Implement delete operation
          break;
      }

      // Clear flag
      this.isProcessingQueuedOperation = false;

      // Mark as completed
      await this.db
        .update(syncQueue)
        .set({ status: 'completed', updatedAt: now })
        .where(eq(syncQueue.id, op.id));

      await this.logSync('retry', op.entityType, op.entityId.toString(), 'success', {
        operation: op.operation,
        retryCount: op.retryCount,
      });
    } catch (error) {
      // Clear flag
      this.isProcessingQueuedOperation = false;

      const newRetryCount = op.retryCount + 1;
      const maxRetries = this.retryOptions.retries; // Use configured max retries

      if (newRetryCount >= maxRetries) {
        // Max retries reached, mark as failed
        await this.db
          .update(syncQueue)
          .set({
            status: 'failed',
            error: this.getErrorMessage(error),
            retryCount: newRetryCount,
            updatedAt: now,
          })
          .where(eq(syncQueue.id, op.id));
      } else {
        // Schedule next retry
        const nextRetryAt = this.calculateNextRetry(newRetryCount);
        await this.db
          .update(syncQueue)
          .set({
            status: 'pending',
            error: this.getErrorMessage(error),
            retryCount: newRetryCount,
            nextRetryAt,
            updatedAt: now,
          })
          .where(eq(syncQueue.id, op.id));
      }

      await this.logSync('retry', op.entityType, op.entityId.toString(), 'failure', {
        operation: op.operation,
        retryCount: newRetryCount,
        error: this.getErrorMessage(error),
      });
    }
  }

  /**
   * Get count of pending operations in queue
   */
  private async getPendingOperationsCount(): Promise<number> {
    const result = await this.db
      .select()
      .from(syncQueue)
      .where(
        and(
          eq(syncQueue.userId, this.userId),
          eq(syncQueue.status, 'pending')
        )
      );
    
    return result.length;
  }
}
