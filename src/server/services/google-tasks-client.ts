import { google, tasks_v1 } from 'googleapis';

/**
 * Google Tasks Client
 * 
 * Interfaces with Google Tasks API for task management and synchronization.
 * 
 * Requirements: 3.1, 3.2, 3.3, 4.1, 5.1
 */

export interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  due?: Date;
  status: 'needsAction' | 'completed';
  parent?: string; // For subtasks
}

export interface GoogleTaskInput {
  title: string;
  notes?: string;
  due?: Date;
}

export class GoogleTasksClient {
  private tasks: tasks_v1.Tasks;

  constructor() {
    this.tasks = google.tasks('v1');
  }

  /**
   * Fetch today's tasks (due date = today)
   * 
   * Note: The Google Tasks API doesn't support server-side date filtering,
   * so we fetch all tasks and filter client-side by due date.
   * 
   * Validates: Requirements 3.1, 3.2, 3.3
   * 
   * @param oauth2Client - Configured OAuth2 client (auto-refreshes tokens)
   * @returns Array of tasks due today
   */
  async getTodayTasks(oauth2Client: any): Promise<GoogleTask[]> {
    try {

      // Calculate today's date range (start of day to end of day in local timezone)
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

      // Fetch all task lists
      const taskListsResponse = await this.tasks.tasklists.list({
        auth: oauth2Client,
      });

      const taskLists = taskListsResponse.data.items || [];

      // Fetch tasks from all task lists
      const allTasks: GoogleTask[] = [];

      for (const taskList of taskLists) {
        if (!taskList.id) continue;

        const tasksResponse = await this.tasks.tasks.list({
          auth: oauth2Client,
          tasklist: taskList.id,
          showCompleted: false, // Only fetch incomplete tasks
          showHidden: false,
        });

        const tasks = tasksResponse.data.items || [];

        // Transform and filter tasks
        for (const task of tasks) {
          // Skip tasks with missing id or title (deleted/invalid tasks)
          if (!task.id || !task.title) {
            console.log(`[GoogleTasksClient] Skipping task with missing id or title: ${JSON.stringify({ id: task.id, title: task.title, status: task.status })}`);
            continue;
          }

          const transformed = this.transformTask(task);
          
          // Include tasks due today OR overdue (due before end of today)
          // This ensures overdue tasks are picked up so users can get back on track
          // Tasks with no due date are excluded (no way to determine relevance)
          if (transformed.due) {
            const dueDate = new Date(transformed.due);
            if (dueDate <= endOfDay) {
              allTasks.push(transformed);
            }
          }
        }
      }

      return allTasks;
    } catch (error) {
      throw new Error(
        `Failed to fetch Google Tasks: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Create a new task
   * 
   * Validates: Requirements 5.1
   * 
   * @param oauth2Client - Configured OAuth2 client (auto-refreshes tokens)
   * @param task - Task data to create
   * @returns Created task ID
   */
  async createTask(oauth2Client: any, task: GoogleTaskInput): Promise<string> {
    try {
      // Get the default task list (we'll use the first one, typically "My Tasks")
      const taskListsResponse = await this.tasks.tasklists.list({
        auth: oauth2Client,
      });

      const taskLists = taskListsResponse.data.items || [];
      if (taskLists.length === 0) {
        throw new Error('No task lists found in Google Tasks');
      }

      const defaultTaskListId = taskLists[0].id;
      if (!defaultTaskListId) {
        throw new Error('Invalid task list ID');
      }

      // Create task in Google Tasks
      const response = await this.tasks.tasks.insert({
        auth: oauth2Client,
        tasklist: defaultTaskListId,
        requestBody: {
          title: task.title,
          notes: task.notes,
          due: task.due ? task.due.toISOString() : undefined,
          status: 'needsAction',
        },
      });

      if (!response.data.id) {
        throw new Error('No task ID returned from Google Tasks');
      }

      return response.data.id;
    } catch (error) {
      throw new Error(
        `Failed to create Google Task: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Update an existing task
   * 
   * Validates: Requirements 3.3
   * 
   * @param oauth2Client - Configured OAuth2 client (auto-refreshes tokens)
   * @param taskId - Google Task ID
   * @param updates - Partial task data to update
   */
  async updateTask(
    oauth2Client: any,
    taskId: string,
    updates: Partial<GoogleTaskInput>
  ): Promise<void> {
    try {
      // Get the task list ID for this task
      const taskListId = await this.findTaskListForTask(oauth2Client, taskId);

      // Build update payload
      const updatePayload: tasks_v1.Schema$Task = {};

      if (updates.title !== undefined) {
        updatePayload.title = updates.title;
      }

      if (updates.notes !== undefined) {
        updatePayload.notes = updates.notes;
      }

      if (updates.due !== undefined) {
        updatePayload.due = updates.due.toISOString();
      }

      // Update task in Google Tasks
      await this.tasks.tasks.patch({
        auth: oauth2Client,
        tasklist: taskListId,
        task: taskId,
        requestBody: updatePayload,
      });
    } catch (error) {
      throw new Error(
        `Failed to update Google Task: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Mark task as complete (not delete)
   * 
   * Validates: Requirements 4.1
   * 
   * @param oauth2Client - Configured OAuth2 client (auto-refreshes tokens)
   * @param taskId - Google Task ID
   */
  async completeTask(oauth2Client: any, taskId: string): Promise<void> {
    try {
      // Get the task list ID for this task
      const taskListId = await this.findTaskListForTask(oauth2Client, taskId);

      // Mark task as completed (preserves the task, doesn't delete it)
      await this.tasks.tasks.patch({
        auth: oauth2Client,
        tasklist: taskListId,
        task: taskId,
        requestBody: {
          status: 'completed',
          completed: new Date().toISOString(),
        },
      });
    } catch (error) {
      throw new Error(
        `Failed to complete Google Task: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Find the task list ID for a given task
   * 
   * Helper method to locate which task list contains a specific task.
   * 
   * @param oauth2Client - Configured OAuth2 client
   * @param taskId - Google Task ID
   * @returns Task list ID
   */
  private async findTaskListForTask(
    oauth2Client: any,
    taskId: string
  ): Promise<string> {
    try {
      // Fetch all task lists
      const taskListsResponse = await this.tasks.tasklists.list({
        auth: oauth2Client,
      });

      const taskLists = taskListsResponse.data.items || [];

      // Search for the task in each task list
      for (const taskList of taskLists) {
        if (!taskList.id) continue;

        try {
          // Try to get the task from this list
          const taskResponse = await this.tasks.tasks.get({
            auth: oauth2Client,
            tasklist: taskList.id,
            task: taskId,
          });

          // If we found it, return this task list ID
          if (taskResponse.data.id === taskId) {
            return taskList.id;
          }
        } catch {
          // Task not in this list, continue searching
          continue;
        }
      }

      throw new Error(`Task ${taskId} not found in any task list`);
    } catch (error) {
      throw new Error(
        `Failed to find task list for task: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Transform Google Task to our format
   * 
   * @param task - Google Task
   * @returns Transformed task
   */
  private transformTask(task: tasks_v1.Schema$Task): GoogleTask {
    if (!task.id || !task.title) {
      throw new Error('Invalid task data from Google Tasks');
    }

    return {
      id: task.id,
      title: task.title,
      notes: task.notes || undefined,
      due: task.due ? new Date(task.due) : undefined,
      status: (task.status as 'needsAction' | 'completed') || 'needsAction',
      parent: task.parent || undefined,
    };
  }
}

