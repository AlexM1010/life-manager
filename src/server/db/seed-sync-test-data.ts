/**
 * Test seed data for Google Calendar Sync feature
 * 
 * This file provides test data for development and testing of the sync functionality.
 * It creates sample OAuth tokens, tasks with sync metadata, and sync queue items.
 */

import { db } from './index.js';
import { oauthTokens, taskSyncMetadata, syncQueue, syncLog } from './schema.js';

/**
 * Seed test OAuth tokens
 * 
 * Creates a sample OAuth token for testing. In production, these would be
 * created through the actual OAuth flow.
 */
export async function seedTestOAuthTokens(): Promise<number> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString(); // 1 hour from now
  
  try {
    // Check if test token already exists
    const existing = await db.query.oauthTokens.findFirst({
      where: (tokens, { eq, and }) => 
        and(eq(tokens.userId, 1), eq(tokens.provider, 'google')),
    });

    if (!existing) {
      await db.insert(oauthTokens).values({
        userId: 1,
        provider: 'google',
        accessToken: 'test_access_token_' + Date.now(),
        refreshToken: 'test_refresh_token_' + Date.now(),
        expiresAt,
        scope: JSON.stringify([
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/tasks',
        ]),
        createdAt: now,
        updatedAt: now,
      });
      console.log('✅ Seeded test OAuth token');
      return 1;
    } else {
      console.log('⏭️  Test OAuth token already exists');
      return 0;
    }
  } catch (error) {
    console.error('❌ Failed to seed OAuth token:', error);
    throw error;
  }
}

/**
 * Seed test task sync metadata
 * 
 * Creates sample sync metadata for existing tasks. This assumes tasks already exist
 * in the database (from the main seed or manual creation).
 */
export async function seedTestTaskSyncMetadata(): Promise<number> {
  const now = new Date().toISOString();
  let insertedCount = 0;

  try {
    // Get first 3 tasks from database
    const existingTasks = await db.query.tasks.findMany({
      limit: 3,
    });

    if (existingTasks.length === 0) {
      console.log('⚠️  No tasks found to add sync metadata. Create some tasks first.');
      return 0;
    }

    for (let i = 0; i < existingTasks.length; i++) {
      const task = existingTasks[i];
      
      // Check if sync metadata already exists
      const existing = await db.query.taskSyncMetadata.findFirst({
        where: (metadata, { eq }) => eq(metadata.taskId, task.id),
      });

      if (!existing) {
        const isFixed = i === 0; // Make first task a fixed calendar event
        
        await db.insert(taskSyncMetadata).values({
          taskId: task.id,
          googleTaskId: isFixed ? null : `google_task_${task.id}_${Date.now()}`,
          googleEventId: `google_event_${task.id}_${Date.now()}`,
          isFixed,
          lastSyncTime: now,
          syncStatus: 'synced',
          syncError: null,
          retryCount: 0,
          createdAt: now,
          updatedAt: now,
        });
        
        insertedCount++;
        console.log(`✅ Seeded sync metadata for task ${task.id} (${isFixed ? 'fixed' : 'flexible'})`);
      } else {
        console.log(`⏭️  Sync metadata already exists for task ${task.id}`);
      }
    }

    return insertedCount;
  } catch (error) {
    console.error('❌ Failed to seed task sync metadata:', error);
    throw error;
  }
}

/**
 * Seed test sync queue items
 * 
 * Creates sample sync queue items for testing retry logic.
 */
export async function seedTestSyncQueue(): Promise<number> {
  const now = new Date().toISOString();
  const nextRetry = new Date(Date.now() + 60 * 1000).toISOString(); // 1 minute from now
  
  try {
    // Check if test queue items already exist
    const existing = await db.query.syncQueue.findMany({
      where: (queue, { eq }) => eq(queue.userId, 1),
    });

    if (existing.length > 0) {
      console.log('⏭️  Test sync queue items already exist');
      return 0;
    }

    // Create a pending operation
    await db.insert(syncQueue).values({
      userId: 1,
      operation: 'create',
      entityType: 'task',
      entityId: 999, // Fake task ID for testing
      payload: JSON.stringify({
        taskId: 999,
        data: { title: 'Test Task', description: 'Test sync operation' },
      }),
      status: 'pending',
      error: null,
      retryCount: 0,
      nextRetryAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // Create a failed operation with retry scheduled
    await db.insert(syncQueue).values({
      userId: 1,
      operation: 'update',
      entityType: 'event',
      entityId: 998,
      payload: JSON.stringify({
        taskId: 998,
        data: { title: 'Updated Task' },
      }),
      status: 'failed',
      error: 'Network timeout',
      retryCount: 2,
      nextRetryAt: nextRetry,
      createdAt: now,
      updatedAt: now,
    });

    console.log('✅ Seeded 2 test sync queue items');
    return 2;
  } catch (error) {
    console.error('❌ Failed to seed sync queue:', error);
    throw error;
  }
}

/**
 * Seed test sync log entries
 * 
 * Creates sample sync log entries for testing and debugging.
 */
export async function seedTestSyncLog(): Promise<number> {
  const now = new Date().toISOString();
  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  
  try {
    // Check if test log entries already exist
    const existing = await db.query.syncLog.findMany({
      where: (log, { eq }) => eq(log.userId, 1),
    });

    if (existing.length > 0) {
      console.log('⏭️  Test sync log entries already exist');
      return 0;
    }

    // Create a successful import log
    await db.insert(syncLog).values({
      userId: 1,
      operation: 'import',
      entityType: 'event',
      entityId: 'google_event_123',
      status: 'success',
      details: JSON.stringify({
        message: 'Imported calendar event successfully',
        googleEventId: 'google_event_123',
        taskId: 1,
      }),
      timestamp: oneHourAgo,
    });

    // Create a failed export log
    await db.insert(syncLog).values({
      userId: 1,
      operation: 'export',
      entityType: 'task',
      entityId: '2',
      status: 'failure',
      details: JSON.stringify({
        error: 'Rate limit exceeded',
        retryCount: 1,
      }),
      timestamp: now,
    });

    console.log('✅ Seeded 2 test sync log entries');
    return 2;
  } catch (error) {
    console.error('❌ Failed to seed sync log:', error);
    throw error;
  }
}

/**
 * Main seed function for sync test data
 * 
 * Call this to seed all sync-related test data.
 * This is separate from the main seed to avoid cluttering production databases.
 */
export async function seedSyncTestData() {
  console.log('🌱 Starting sync test data seed...');
  
  const tokensInserted = await seedTestOAuthTokens();
  const metadataInserted = await seedTestTaskSyncMetadata();
  const queueInserted = await seedTestSyncQueue();
  const logInserted = await seedTestSyncLog();
  
  const total = tokensInserted + metadataInserted + queueInserted + logInserted;
  
  console.log(`\n✅ Sync test data seed complete! Inserted ${total} new records.`);
  console.log(`   - OAuth tokens: ${tokensInserted}`);
  console.log(`   - Task sync metadata: ${metadataInserted}`);
  console.log(`   - Sync queue items: ${queueInserted}`);
  console.log(`   - Sync log entries: ${logInserted}`);
}

// Allow running this file directly for manual seeding
if (import.meta.url === `file://${process.argv[1]}`) {
  seedSyncTestData()
    .then(() => {
      console.log('Sync test data seed completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Sync test data seed failed:', error);
      process.exit(1);
    });
}
