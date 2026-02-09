import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleTasksClient, GoogleTaskInput } from '../google-tasks-client.js';
import { google } from 'googleapis';

/**
 * Unit tests for Google Tasks Client
 * 
 * Tests task fetching, creation, updating, and completion with mocked API responses.
 * 
 * Requirements: 3.1, 3.2, 4.1, 4.2
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
      update: vi.fn(),
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

describe('GoogleTasksClient', () => {
  let client: GoogleTasksClient;
  let mockTasks: any;
  let mockOAuth2Client: any;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GoogleTasksClient();
    mockTasks = google.tasks('v1');
    
    // Create mock OAuth2 client
    mockOAuth2Client = {
      setCredentials: vi.fn(),
      credentials: {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
      },
    };
  });

  describe('getTodayTasks', () => {
    it('should fetch and transform today\'s tasks', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Mock task lists response
      mockTasks.tasklists.list.mockResolvedValue({
        data: {
          items: [
            { id: 'list1', title: 'My Tasks' },
            { id: 'list2', title: 'Work Tasks' },
          ],
        },
      });

      // Mock tasks response for each list
      const mockTasksForList1 = [
        {
          id: 'task1',
          title: 'Review PR',
          notes: 'Check the new feature',
          due: today.toISOString(),
          status: 'needsAction',
        },
        {
          id: 'task2',
          title: 'Write tests',
          due: today.toISOString(),
          status: 'needsAction',
        },
      ];

      const mockTasksForList2 = [
        {
          id: 'task3',
          title: 'Team meeting prep',
          due: today.toISOString(),
          status: 'needsAction',
        },
      ];

      mockTasks.tasks.list
        .mockResolvedValueOnce({ data: { items: mockTasksForList1 } })
        .mockResolvedValueOnce({ data: { items: mockTasksForList2 } });

      const tasks = await client.getTodayTasks(mockOAuth2Client);

      // Verify API was called correctly
      expect(mockTasks.tasklists.list).toHaveBeenCalledWith({
        auth: mockOAuth2Client,
      });
      expect(mockTasks.tasks.list).toHaveBeenCalledTimes(2);

      // Verify tasks were transformed correctly
      expect(tasks).toHaveLength(3);
      expect(tasks[0]).toEqual({
        id: 'task1',
        title: 'Review PR',
        notes: 'Check the new feature',
        due: new Date(today.toISOString()),
        status: 'needsAction',
        parent: undefined,
      });
      expect(tasks[1]).toEqual({
        id: 'task2',
        title: 'Write tests',
        notes: undefined,
        due: new Date(today.toISOString()),
        status: 'needsAction',
        parent: undefined,
      });
      expect(tasks[2]).toEqual({
        id: 'task3',
        title: 'Team meeting prep',
        notes: undefined,
        due: new Date(today.toISOString()),
        status: 'needsAction',
        parent: undefined,
      });
    });

    it('should include overdue tasks and filter out future tasks', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Mock task lists response
      mockTasks.tasklists.list.mockResolvedValue({
        data: {
          items: [{ id: 'list1', title: 'My Tasks' }],
        },
      });

      // Mock tasks with different due dates
      const mockTasksResponse = [
        {
          id: 'task1',
          title: 'Today Task',
          due: today.toISOString(),
          status: 'needsAction',
        },
        {
          id: 'task2',
          title: 'Yesterday Task',
          due: yesterday.toISOString(),
          status: 'needsAction',
        },
        {
          id: 'task3',
          title: 'Tomorrow Task',
          due: tomorrow.toISOString(),
          status: 'needsAction',
        },
        {
          id: 'task4',
          title: 'No Due Date',
          status: 'needsAction',
        },
      ];

      mockTasks.tasks.list.mockResolvedValue({
        data: { items: mockTasksResponse },
      });

      const tasks = await client.getTodayTasks(mockOAuth2Client);

      // Should include today's task AND overdue (yesterday) task
      // Should exclude future tasks and tasks with no due date
      expect(tasks).toHaveLength(2);
      expect(tasks.map(t => t.id).sort()).toEqual(['task1', 'task2']);
    });

    it('should filter out completed tasks', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Mock task lists response
      mockTasks.tasklists.list.mockResolvedValue({
        data: {
          items: [{ id: 'list1', title: 'My Tasks' }],
        },
      });

      // Mock tasks - API already filters completed tasks via showCompleted: false
      // So we only return active tasks
      const mockTasksResponse = [
        {
          id: 'task1',
          title: 'Active Task',
          due: today.toISOString(),
          status: 'needsAction',
        },
      ];

      mockTasks.tasks.list.mockResolvedValue({
        data: { items: mockTasksResponse },
      });

      const tasks = await client.getTodayTasks(mockOAuth2Client);

      // Verify API was called with showCompleted: false
      expect(mockTasks.tasks.list).toHaveBeenCalledWith(
        expect.objectContaining({
          showCompleted: false,
        })
      );

      // Should only include active task
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('task1');
    });

    it('should handle empty task lists', async () => {
      mockTasks.tasklists.list.mockResolvedValue({
        data: { items: [] },
      });

      const tasks = await client.getTodayTasks(mockOAuth2Client);

      expect(tasks).toEqual([]);
    });

    it('should handle task lists with no tasks', async () => {
      mockTasks.tasklists.list.mockResolvedValue({
        data: {
          items: [{ id: 'list1', title: 'Empty List' }],
        },
      });

      mockTasks.tasks.list.mockResolvedValue({
        data: { items: [] },
      });

      const tasks = await client.getTodayTasks(mockOAuth2Client);

      expect(tasks).toEqual([]);
    });

    it('should handle API errors', async () => {
      mockTasks.tasklists.list.mockRejectedValue(new Error('API rate limit exceeded'));

      await expect(client.getTodayTasks(mockOAuth2Client)).rejects.toThrow(
        'Failed to fetch Google Tasks: API rate limit exceeded'
      );
    });
  });

  describe('createTask', () => {
    it('should create a task with all fields', async () => {
      const mockTaskId = 'created-task-123';
      
      // Mock task lists response (createTask uses first list)
      mockTasks.tasklists.list.mockResolvedValue({
        data: {
          items: [{ id: 'default-list', title: 'My Tasks' }],
        },
      });
      
      mockTasks.tasks.insert.mockResolvedValue({
        data: { id: mockTaskId },
      });

      const taskInput: GoogleTaskInput = {
        title: 'New Task',
        notes: 'Task description',
        due: new Date('2024-01-15T10:00:00Z'),
      };

      const taskId = await client.createTask(mockOAuth2Client, taskInput);

      // Verify API was called correctly
      expect(mockTasks.tasks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: mockOAuth2Client,
          tasklist: 'default-list',
          requestBody: expect.objectContaining({
            title: 'New Task',
            notes: 'Task description',
            due: '2024-01-15T10:00:00.000Z',
            status: 'needsAction',
          }),
        })
      );

      expect(taskId).toBe(mockTaskId);
    });

    it('should create a task with minimal fields', async () => {
      const mockTaskId = 'created-task-456';
      
      // Mock task lists response
      mockTasks.tasklists.list.mockResolvedValue({
        data: {
          items: [{ id: 'default-list', title: 'My Tasks' }],
        },
      });
      
      mockTasks.tasks.insert.mockResolvedValue({
        data: { id: mockTaskId },
      });

      const taskInput: GoogleTaskInput = {
        title: 'Quick Task',
      };

      const taskId = await client.createTask(mockOAuth2Client, taskInput);

      // Verify API was called with only required fields
      expect(mockTasks.tasks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            title: 'Quick Task',
            notes: undefined,
            due: undefined,
            status: 'needsAction',
          }),
        })
      );

      expect(taskId).toBe(mockTaskId);
    });

    it('should handle API errors during creation', async () => {
      mockTasks.tasklists.list.mockRejectedValue(new Error('Insufficient permissions'));

      const taskInput: GoogleTaskInput = {
        title: 'Test Task',
      };

      await expect(client.createTask(mockOAuth2Client, taskInput)).rejects.toThrow(
        'Failed to create Google Task: Insufficient permissions'
      );
    });

    it('should handle missing task ID in response', async () => {
      // Mock task lists response
      mockTasks.tasklists.list.mockResolvedValue({
        data: {
          items: [{ id: 'default-list', title: 'My Tasks' }],
        },
      });
      
      mockTasks.tasks.insert.mockResolvedValue({
        data: {}, // No ID
      });

      const taskInput: GoogleTaskInput = {
        title: 'Test Task',
      };

      await expect(client.createTask(mockOAuth2Client, taskInput)).rejects.toThrow(
        'No task ID returned from Google Tasks'
      );
    });
  });

  describe('updateTask', () => {
    it('should update all task fields', async () => {
      // Mock finding the task list
      mockTasks.tasklists.list.mockResolvedValue({
        data: {
          items: [{ id: 'list1', title: 'My Tasks' }],
        },
      });
      
      mockTasks.tasks.get = vi.fn().mockResolvedValue({
        data: { id: 'task-123' },
      });
      
      mockTasks.tasks.patch.mockResolvedValue({ data: {} });

      const taskId = 'task-123';
      const updates: Partial<GoogleTaskInput> = {
        title: 'Updated Task',
        notes: 'New description',
        due: new Date('2024-01-16T10:00:00Z'),
      };

      await client.updateTask(mockOAuth2Client, taskId, updates);

      // Verify API was called correctly
      expect(mockTasks.tasks.patch).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: mockOAuth2Client,
          tasklist: 'list1',
          task: 'task-123',
          requestBody: expect.objectContaining({
            title: 'Updated Task',
            notes: 'New description',
            due: '2024-01-16T10:00:00.000Z',
          }),
        })
      );
    });

    it('should update only specified fields', async () => {
      // Mock finding the task list
      mockTasks.tasklists.list.mockResolvedValue({
        data: {
          items: [{ id: 'list1', title: 'My Tasks' }],
        },
      });
      
      mockTasks.tasks.get = vi.fn().mockResolvedValue({
        data: { id: 'task-123' },
      });
      
      mockTasks.tasks.patch.mockResolvedValue({ data: {} });

      const taskId = 'task-123';
      const updates: Partial<GoogleTaskInput> = {
        title: 'New Title',
      };

      await client.updateTask(mockOAuth2Client, taskId, updates);

      // Verify only title was included in update
      expect(mockTasks.tasks.patch).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: {
            title: 'New Title',
          },
        })
      );
    });

    it('should handle API errors during update', async () => {
      mockTasks.tasklists.list.mockRejectedValue(new Error('Task not found'));

      const taskId = 'nonexistent-task';
      const updates: Partial<GoogleTaskInput> = {
        title: 'Updated Title',
      };

      await expect(
        client.updateTask(mockOAuth2Client, taskId, updates)
      ).rejects.toThrow('Failed to update Google Task: Failed to find task list for task: Task not found');
    });
  });

  describe('completeTask', () => {
    it('should mark a task as completed (not delete)', async () => {
      // Mock finding the task list
      mockTasks.tasklists.list.mockResolvedValue({
        data: {
          items: [{ id: 'list1', title: 'My Tasks' }],
        },
      });
      
      mockTasks.tasks.get = vi.fn().mockResolvedValue({
        data: { id: 'task-to-complete' },
      });
      
      mockTasks.tasks.patch.mockResolvedValue({ data: {} });

      const taskId = 'task-to-complete';

      await client.completeTask(mockOAuth2Client, taskId);

      // Verify API was called with status: completed
      expect(mockTasks.tasks.patch).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: mockOAuth2Client,
          tasklist: 'list1',
          task: 'task-to-complete',
          requestBody: expect.objectContaining({
            status: 'completed',
            completed: expect.any(String),
          }),
        })
      );
    });

    it('should handle API errors during completion', async () => {
      mockTasks.tasklists.list.mockRejectedValue(new Error('Task not found'));

      const taskId = 'nonexistent-task';

      await expect(
        client.completeTask(mockOAuth2Client, taskId)
      ).rejects.toThrow('Failed to complete Google Task: Failed to find task list for task: Task not found');
    });
  });
});
