import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { GoogleTasksClient } from '../google-tasks-client.js';
import { google } from 'googleapis';

/**
 * Google Tasks Client Property Tests
 * 
 * Property-based tests for Google Tasks synchronization:
 * - Property 9: Task Completion Sync
 * 
 * Validates Requirements: 4.1, 4.2
 */

// Mock googleapis
vi.mock('googleapis', () => {
  const mockTasks = {
    tasklists: {
      list: vi.fn(),
    },
    tasks: {
      list: vi.fn(),
      insert: vi.fn(),
      patch: vi.fn(),
      get: vi.fn(),
    },
  };

  const mockOAuth2 = vi.fn(() => ({
    setCredentials: vi.fn(),
  }));

  return {
    google: {
      tasks: vi.fn(() => mockTasks),
      auth: {
        OAuth2: mockOAuth2,
      },
    },
  };
});

describe('Google Tasks Client - Property Tests', () => {
  let client: GoogleTasksClient;
  let mockTasks: any;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    client = new GoogleTasksClient();
    mockTasks = google.tasks('v1');
  });

  // ============================================================================
  // Arbitraries (generators) for property-based testing
  // ============================================================================

  // Generate valid access tokens (base64-like strings)
  const accessTokenArb = fc.string({
    minLength: 20,
    maxLength: 200,
    unit: fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('')
    ),
  });

  // Generate Google Task IDs (alphanumeric strings)
  const taskIdArb = fc.string({
    minLength: 10,
    maxLength: 50,
    unit: fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('')
    ),
  });

  // Generate task list IDs
  const taskListIdArb = fc.string({
    minLength: 10,
    maxLength: 50,
    unit: fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('')
    ),
  });

  // Generate task titles
  // const taskTitleArb = fc.string({ minLength: 1, maxLength: 100 });

  // Generate task notes
  // const taskNotesArb = fc.option(fc.string({ minLength: 0, maxLength: 500 }), { nil: undefined });

  // Generate task due dates
  /*  */

  // Generate complete Google Task objects
  // (Currently unused - kept for future tests)
  /*
  const googleTaskArb = fc.record({
    id: taskIdArb,
    title: taskTitleArb,
    notes: taskNotesArb,
    due: taskDueArb,
    status: fc.constantFrom('needsAction' as const, 'completed' as const),
    parent: fc.option(taskIdArb, { nil: undefined }),
  });
  */

  // ============================================================================
  // Property 9: Task Completion Sync
  // ============================================================================

  /**
   * Property 9: Task Completion Sync
   * 
   * **Validates: Requirements 4.1, 4.2**
   * 
   * For any task marked complete in Life Manager that has a corresponding 
   * Google Task, the system should mark the Google Task as complete 
   * (status = 'completed') without deleting it.
   * 
   * This property ensures that:
   * 1. The task is marked as 'completed' (not deleted)
   * 2. The completion timestamp is set
   * 3. The task remains in Google Tasks (preserved)
   * 4. The API is called with correct parameters
   * 5. The operation succeeds for any valid task ID
   */
  it('Property 9: Task Completion Sync', async () => {
    await fc.assert(
      fc.asyncProperty(
        accessTokenArb,
        taskIdArb,
        taskListIdArb,
        async (accessToken, taskId, taskListId) => {
          // Clear mocks for each property test iteration
          vi.clearAllMocks();
          
          // Mock the Google Tasks API responses
          mockTasks.tasklists.list.mockResolvedValue({
            data: {
              items: [{ id: taskListId }],
            },
          });

          mockTasks.tasks.get.mockResolvedValue({
            data: {
              id: taskId,
              title: 'Test Task',
              status: 'needsAction',
            },
          });

          mockTasks.tasks.patch.mockResolvedValue({
            data: {
              id: taskId,
              status: 'completed',
              completed: new Date().toISOString(),
            },
          });

          // Call completeTask
          await client.completeTask(accessToken, taskId);

          // Verify the task list was found
          expect(mockTasks.tasklists.list).toHaveBeenCalled();

          // Verify the task was located in the task list
          expect(mockTasks.tasks.get).toHaveBeenCalled();

          // Verify the task was marked as completed (NOT deleted)
          expect(mockTasks.tasks.patch).toHaveBeenCalled();

          // Verify patch was called exactly once (task is updated, not deleted)
          expect(mockTasks.tasks.patch).toHaveBeenCalledTimes(1);

          // Verify the status was set to 'completed'
          const patchCalls = mockTasks.tasks.patch.mock.calls;
          expect(patchCalls.length).toBeGreaterThan(0);
          const patchCall = patchCalls[0][0];
          expect(patchCall.requestBody.status).toBe('completed');
          expect(patchCall.requestBody.completed).toBeDefined();
          
          // Verify the completion timestamp is a valid ISO string
          const completedTimestamp = patchCall.requestBody.completed;
          expect(() => new Date(completedTimestamp)).not.toThrow();
          expect(new Date(completedTimestamp).toISOString()).toBe(completedTimestamp);
        }
      ),
      { numRuns: 100 }
    );
  }, 10000); // Increase timeout for property-based tests

  /**
   * Property 9 (Preservation): Completed tasks are preserved, not deleted
   * 
   * This test verifies that the completeTask method uses PATCH (update)
   * rather than DELETE, ensuring the task remains in Google Tasks.
   */
  it('Property 9 (Preservation): Completed tasks are preserved, not deleted', async () => {
    await fc.assert(
      fc.asyncProperty(
        accessTokenArb,
        taskIdArb,
        taskListIdArb,
        async (accessToken, taskId, taskListId) => {
          // Mock the Google Tasks API with both patch and delete methods
          mockTasks.tasklists.list.mockResolvedValue({
            data: {
              items: [{ id: taskListId }],
            },
          });

          mockTasks.tasks.get.mockResolvedValue({
            data: {
              id: taskId,
              title: 'Test Task',
              status: 'needsAction',
            },
          });

          mockTasks.tasks.patch.mockResolvedValue({
            data: {
              id: taskId,
              status: 'completed',
              completed: new Date().toISOString(),
            },
          });

          // Add a delete mock that should NOT be called
          const deleteMock = vi.fn().mockResolvedValue({});
          mockTasks.tasks.delete = deleteMock;

          // Call completeTask
          await client.completeTask(accessToken, taskId);

          // Verify patch was called (update operation)
          expect(mockTasks.tasks.patch).toHaveBeenCalled();

          // Verify delete was NEVER called (preservation requirement)
          expect(deleteMock).not.toHaveBeenCalled();

          // Verify the status was set to 'completed'
          const patchCalls = mockTasks.tasks.patch.mock.calls;
          expect(patchCalls.length).toBeGreaterThan(0);
          const patchCall = patchCalls[0][0];
          expect(patchCall.requestBody.status).toBe('completed');
        }
      ),
      { numRuns: 100 }
    );
  }, 10000);

  /**
   * Property 9 (Idempotence): Completing an already completed task succeeds
   * 
   * Marking a task as complete multiple times should succeed without error,
   * ensuring idempotent behavior for retry scenarios.
   */
  it('Property 9 (Idempotence): Completing an already completed task succeeds', async () => {
    await fc.assert(
      fc.asyncProperty(
        accessTokenArb,
        taskIdArb,
        taskListIdArb,
        async (accessToken, taskId, taskListId) => {
          // Mock the Google Tasks API with a task that's already completed
          mockTasks.tasklists.list.mockResolvedValue({
            data: {
              items: [{ id: taskListId }],
            },
          });

          mockTasks.tasks.get.mockResolvedValue({
            data: {
              id: taskId,
              title: 'Test Task',
              status: 'completed', // Already completed
              completed: new Date(Date.now() - 3600000).toISOString(), // Completed 1 hour ago
            },
          });

          mockTasks.tasks.patch.mockResolvedValue({
            data: {
              id: taskId,
              status: 'completed',
              completed: new Date().toISOString(),
            },
          });

          // Call completeTask on an already completed task
          await expect(client.completeTask(accessToken, taskId)).resolves.not.toThrow();

          // Verify the operation succeeded (idempotent)
          expect(mockTasks.tasks.patch).toHaveBeenCalled();

          // Verify status is still 'completed'
          const patchCalls = mockTasks.tasks.patch.mock.calls;
          expect(patchCalls.length).toBeGreaterThan(0);
          const patchCall = patchCalls[0][0];
          expect(patchCall.requestBody.status).toBe('completed');
        }
      ),
      { numRuns: 100 }
    );
  }, 10000);

  /**
   * Property 9 (Error Handling): Task not found throws descriptive error
   * 
   * When a task ID doesn't exist in any task list, the operation should
   * fail with a clear error message.
   */
  it('Property 9 (Error Handling): Task not found throws descriptive error', async () => {
    await fc.assert(
      fc.asyncProperty(
        accessTokenArb,
        taskIdArb,
        async (accessToken, taskId) => {
          // Mock the Google Tasks API with no matching task
          mockTasks.tasklists.list.mockResolvedValue({
            data: {
              items: [
                { id: 'list1' },
                { id: 'list2' },
                { id: 'list3' },
              ],
            },
          });

          mockTasks.tasks.get.mockRejectedValue(new Error('Task not found'));

          // Call completeTask with non-existent task ID
          await expect(client.completeTask(accessToken, taskId)).rejects.toThrow(
            /Task .* not found in any task list/
          );

          // Verify patch was never called (task wasn't found)
          expect(mockTasks.tasks.patch).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  }, 10000);

  /**
   * Property 9 (Timestamp): Completion timestamp is current
   * 
   * The completion timestamp should be set to the current time
   * (within a reasonable tolerance).
   */
  it('Property 9 (Timestamp): Completion timestamp is current', async () => {
    await fc.assert(
      fc.asyncProperty(
        accessTokenArb,
        taskIdArb,
        taskListIdArb,
        async (accessToken, taskId, taskListId) => {
          const beforeCompletion = Date.now();

          // Mock the Google Tasks API
          mockTasks.tasklists.list.mockResolvedValue({
            data: {
              items: [{ id: taskListId }],
            },
          });

          mockTasks.tasks.get.mockResolvedValue({
            data: {
              id: taskId,
              title: 'Test Task',
              status: 'needsAction',
            },
          });

          mockTasks.tasks.patch.mockResolvedValue({
            data: {
              id: taskId,
              status: 'completed',
              completed: new Date().toISOString(),
            },
          });

          // Call completeTask
          await client.completeTask(accessToken, taskId);

          const afterCompletion = Date.now();

          // Extract the completion timestamp
          const patchCalls = mockTasks.tasks.patch.mock.calls;
          expect(patchCalls.length).toBeGreaterThan(0);
          const patchCall = patchCalls[0][0];
          const completedTimestamp = patchCall.requestBody.completed;
          const completedTime = new Date(completedTimestamp).getTime();

          // Verify timestamp is within reasonable range (within 5 seconds)
          expect(completedTime).toBeGreaterThanOrEqual(beforeCompletion - 5000);
          expect(completedTime).toBeLessThanOrEqual(afterCompletion + 5000);
        }
      ),
      { numRuns: 100 }
    );
  }, 10000);
});

