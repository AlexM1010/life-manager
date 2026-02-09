import { useState } from 'react';
import { trpc } from '../lib/trpc';

/**
 * TaskList Component
 * 
 * Displays and manages tasks with:
 * - List view with filtering by domain, status, and priority
 * - Create new task form
 * - Edit existing task
 * - Complete task (marks as done)
 * - Delete task
 * 
 * Features:
 * - Real-time updates via tRPC
 * - Domain filter dropdown
 * - Status and priority filters
 * - Visual indicators for overdue tasks
 * - Recurring task support (rrule)
 * 
 * Requirements: 2.1, 2.2, 2.3, 10.3
 */

interface TaskListProps {
  className?: string;
}

export function TaskList({ className = '' }: TaskListProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [filterDomainId, setFilterDomainId] = useState<number | undefined>(undefined);
  const [filterStatus, setFilterStatus] = useState<string | undefined>('todo');
  const [filterPriority, setFilterPriority] = useState<string | undefined>(undefined);

  const utils = trpc.useUtils();

  // Fetch tasks with filters
  const { data: tasks, isLoading, error } = trpc.task.list.useQuery({
    domainId: filterDomainId,
    status: filterStatus as any,
    priority: filterPriority as any,
  });

  // Fetch domains for dropdown
  const { data: domains } = trpc.domain.list.useQuery();

  // Create task mutation
  const createTask = trpc.task.create.useMutation({
    onSuccess: () => {
      utils.task.list.invalidate();
      setShowCreateForm(false);
    },
  });

  // Update task mutation
  const updateTask = trpc.task.update.useMutation({
    onSuccess: () => {
      utils.task.list.invalidate();
      setEditingTaskId(null);
    },
  });

  // Complete task mutation
  const completeTask = trpc.task.complete.useMutation({
    onSuccess: () => {
      utils.task.list.invalidate();
    },
  });

  // Delete task mutation
  const deleteTask = trpc.task.delete.useMutation({
    onSuccess: () => {
      utils.task.list.invalidate();
    },
  });

  // Helper to get domain name by ID
  const getDomainName = (domainId: number): string => {
    const domain = domains?.find(d => d.id === domainId);
    return domain?.name || 'Unknown';
  };

  // Loading state
  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold">Tasks</h2>
        <div className="p-6 bg-card rounded-lg border">
          <p className="text-muted-foreground">Loading tasks...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold">Tasks</h2>
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800">Failed to load tasks</p>
          <p className="text-sm text-red-600 mt-2">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Tasks</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your tasks across all life domains
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium
                   hover:bg-primary/90 transition-colors"
        >
          + New Task
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        {/* Domain Filter */}
        <select
          value={filterDomainId || ''}
          onChange={(e) => setFilterDomainId(e.target.value ? parseInt(e.target.value) : undefined)}
          className="px-3 py-2 border border-input rounded-lg bg-background
                   focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Domains</option>
          {domains?.map((domain) => (
            <option key={domain.id} value={domain.id}>
              {domain.name}
            </option>
          ))}
        </select>

        {/* Status Filter */}
        <select
          value={filterStatus || ''}
          onChange={(e) => setFilterStatus(e.target.value || undefined)}
          className="px-3 py-2 border border-input rounded-lg bg-background
                   focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Statuses</option>
          <option value="todo">To Do</option>
          <option value="in-progress">In Progress</option>
          <option value="done">Done</option>
          <option value="dropped">Dropped</option>
        </select>

        {/* Priority Filter */}
        <select
          value={filterPriority || ''}
          onChange={(e) => setFilterPriority(e.target.value || undefined)}
          className="px-3 py-2 border border-input rounded-lg bg-background
                   focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Priorities</option>
          <option value="must-do">Must Do</option>
          <option value="should-do">Should Do</option>
          <option value="nice-to-have">Nice to Have</option>
        </select>

        {/* Clear Filters */}
        {(filterDomainId || filterStatus !== 'todo' || filterPriority) && (
          <button
            onClick={() => {
              setFilterDomainId(undefined);
              setFilterStatus('todo');
              setFilterPriority(undefined);
            }}
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground
                     border border-input rounded-lg transition-colors"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <TaskForm
          domains={domains || []}
          onSubmit={(data) => createTask.mutate(data)}
          onCancel={() => setShowCreateForm(false)}
          isSubmitting={createTask.isPending}
          error={createTask.error?.message}
        />
      )}

      {/* Task List */}
      <div className="space-y-3">
        {tasks && tasks.length === 0 ? (
          <div className="p-8 bg-card rounded-lg border text-center">
            <p className="text-muted-foreground">
              {filterDomainId || filterStatus || filterPriority
                ? 'No tasks match your filters'
                : 'No tasks yet. Create your first task to get started!'}
            </p>
          </div>
        ) : (
          tasks?.map((task) => (
            <div key={task.id}>
              {editingTaskId === task.id ? (
                <TaskForm
                  domains={domains || []}
                  initialData={task}
                  onSubmit={(data) =>
                    updateTask.mutate({ id: task.id, ...data })
                  }
                  onCancel={() => setEditingTaskId(null)}
                  isSubmitting={updateTask.isPending}
                  error={updateTask.error?.message}
                />
              ) : (
                <TaskCard
                  task={task}
                  domainName={getDomainName(task.domainId)}
                  onEdit={() => setEditingTaskId(task.id)}
                  onComplete={() => completeTask.mutate({ id: task.id })}
                  onDelete={() => {
                    if (
                      confirm(
                        `Delete "${task.title}"? This cannot be undone.`
                      )
                    ) {
                      deleteTask.mutate({ id: task.id });
                    }
                  }}
                  isCompleting={completeTask.isPending}
                  isDeleting={deleteTask.isPending}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * TaskCard Component
 * 
 * Displays a single task with its metadata and action buttons
 */

interface TaskCardProps {
  task: {
    id: number;
    title: string;
    description: string | null;
    domainId: number;
    priority: string;
    estimatedMinutes: number;
    dueDate: string | null;
    status: string;
    rrule: string | null;
    syncMetadata?: {
      googleTaskId: string | null;
      googleEventId: string | null;
      isFixed: boolean;
      lastSyncTime: string | null;
      syncStatus: 'synced' | 'pending' | 'failed';
      syncError: string | null;
    } | null;
  };
  domainName: string;
  onEdit: () => void;
  onComplete: () => void;
  onDelete: () => void;
  isCompleting: boolean;
  isDeleting: boolean;
}

function TaskCard({
  task,
  domainName,
  onEdit,
  onComplete,
  onDelete,
  isCompleting,
  isDeleting,
}: TaskCardProps) {
  const isDone = task.status === 'done';
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !isDone;
  const dueToday = task.dueDate && task.dueDate.split('T')[0] === new Date().toISOString().split('T')[0];
  
  // Sync metadata
  const isFixed = task.syncMetadata?.isFixed ?? false;
  const syncStatus = task.syncMetadata?.syncStatus;
  const hasSyncError = syncStatus === 'failed';

  // Priority colors
  const priorityColors = {
    'must-do': 'bg-red-100 text-red-800',
    'should-do': 'bg-yellow-100 text-yellow-800',
    'nice-to-have': 'bg-blue-100 text-blue-800',
  };

  // Status colors
  const statusColors = {
    'todo': 'bg-gray-100 text-gray-800',
    'in-progress': 'bg-blue-100 text-blue-800',
    'done': 'bg-green-100 text-green-800',
    'dropped': 'bg-gray-100 text-gray-600',
  };

  return (
    <div
      className={`p-4 bg-card rounded-lg border transition-all ${
        isDone ? 'opacity-60' : 'hover:border-primary/50'
      } ${isFixed ? 'border-l-4 border-l-orange-500' : ''}`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        {!isDone && (
          <button
            onClick={onComplete}
            disabled={isCompleting}
            className="mt-1 w-5 h-5 rounded border-2 border-muted-foreground
                     hover:border-primary transition-colors
                     disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Mark as complete"
          />
        )}
        {isDone && (
          <div className="mt-1 w-5 h-5 rounded border-2 bg-primary border-primary
                        flex items-center justify-center">
            <svg
              className="w-3 h-3 text-primary-foreground"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
        )}

        {/* Task Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h4
                  className={`font-medium ${
                    isDone ? 'line-through text-muted-foreground' : ''
                  }`}
                >
                  {task.title}
                </h4>
                
                {/* Fixed Task Indicator */}
                {isFixed && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-800 rounded"
                    title="Fixed Task - Cannot be rescheduled (from Google Calendar)"
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                    Fixed
                  </span>
                )}
                
                {/* Sync Status Indicator */}
                {syncStatus && (
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${
                      syncStatus === 'synced'
                        ? 'bg-green-100 text-green-800'
                        : syncStatus === 'pending'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                    title={
                      syncStatus === 'synced'
                        ? 'Synced with Google'
                        : syncStatus === 'pending'
                        ? 'Sync pending...'
                        : `Sync failed: ${task.syncMetadata?.syncError || 'Unknown error'}`
                    }
                  >
                    {syncStatus === 'synced' && (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    {syncStatus === 'pending' && (
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    )}
                    {syncStatus === 'failed' && (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    )}
                    {syncStatus}
                  </span>
                )}
              </div>
              
              {task.description && (
                <p className="text-sm text-muted-foreground mt-1">
                  {task.description}
                </p>
              )}
            </div>

            {/* Action Buttons */}
            {!isDone && (
              <div className="flex gap-2">
                <button
                  onClick={onEdit}
                  disabled={isFixed}
                  className="px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground
                           border border-muted hover:border-foreground rounded transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
                  title={isFixed ? 'Fixed tasks cannot be edited' : 'Edit task'}
                >
                  Edit
                </button>
                <button
                  onClick={onDelete}
                  disabled={isDeleting || isFixed}
                  className="px-3 py-1 text-xs font-medium text-red-600 hover:text-red-700
                           border border-red-200 hover:border-red-300 rounded transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
                  title={isFixed ? 'Fixed tasks cannot be deleted' : 'Delete task'}
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className={`px-2 py-1 text-xs font-medium rounded ${priorityColors[task.priority as keyof typeof priorityColors]}`}>
              {task.priority.replace('-', ' ')}
            </span>

            <span className={`px-2 py-1 text-xs font-medium rounded ${statusColors[task.status as keyof typeof statusColors]}`}>
              {task.status.replace('-', ' ')}
            </span>

            <span className="px-2 py-1 text-xs font-medium bg-muted text-muted-foreground rounded">
              {domainName}
            </span>

            <span className="px-2 py-1 text-xs font-medium bg-muted text-muted-foreground rounded">
              {formatMinutes(task.estimatedMinutes)}
            </span>

            {task.rrule && (
              <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded">
                Recurring
              </span>
            )}

            {task.dueDate && (
              <span
                className={`px-2 py-1 text-xs font-medium rounded ${
                  isOverdue
                    ? 'bg-red-100 text-red-800'
                    : dueToday
                    ? 'bg-orange-100 text-orange-800'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {isOverdue ? 'Overdue: ' : dueToday ? 'Due today' : 'Due: '}
                {!dueToday && formatDate(task.dueDate)}
              </span>
            )}
          </div>
          
          {/* Sync Error Message */}
          {hasSyncError && task.syncMetadata?.syncError && (
            <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              Sync error: {task.syncMetadata.syncError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * TaskForm Component
 * 
 * Form for creating or editing a task
 */

interface TaskFormProps {
  domains: Array<{ id: number; name: string }>;
  initialData?: {
    title: string;
    description: string | null;
    domainId: number;
    priority: 'must-do' | 'should-do' | 'nice-to-have';
    estimatedMinutes: number;
    dueDate: string | null;
    rrule: string | null;
  };
  onSubmit: (data: {
    title: string;
    description?: string;
    domainId: number;
    priority: 'must-do' | 'should-do' | 'nice-to-have';
    estimatedMinutes: number;
    dueDate?: string;
    rrule?: string;
  }) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error?: string;
}

function TaskForm({
  domains,
  initialData,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
}: TaskFormProps) {
  const [title, setTitle] = useState(initialData?.title || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [domainId, setDomainId] = useState<number>(initialData?.domainId || domains[0]?.id || 0);
  const [priority, setPriority] = useState<'must-do' | 'should-do' | 'nice-to-have'>(
    (initialData?.priority as 'must-do' | 'should-do' | 'nice-to-have') || 'should-do'
  );
  const [estimatedMinutes, setEstimatedMinutes] = useState(initialData?.estimatedMinutes || 30);
  const [dueDate, setDueDate] = useState(initialData?.dueDate?.split('T')[0] || '');
  const [rrule, setRrule] = useState(initialData?.rrule || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const data: {
      title: string;
      domainId: number;
      priority: 'must-do' | 'should-do' | 'nice-to-have';
      estimatedMinutes: number;
      description?: string;
      dueDate?: string;
      rrule?: string;
    } = {
      title: title.trim(),
      domainId,
      priority,
      estimatedMinutes,
    };

    if (description.trim()) {
      data.description = description.trim();
    }

    if (dueDate) {
      // Convert to ISO datetime string
      data.dueDate = new Date(dueDate).toISOString();
    }

    if (rrule.trim()) {
      data.rrule = rrule.trim();
    }

    onSubmit(data);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-6 bg-card rounded-lg border border-primary"
    >
      <h3 className="text-lg font-semibold mb-4">
        {initialData ? 'Edit Task' : 'New Task'}
      </h3>

      <div className="space-y-4">
        {/* Title */}
        <div>
          <label htmlFor="task-title" className="block text-sm font-medium mb-1">
            Title *
          </label>
          <input
            id="task-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full px-3 py-2 border border-input rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="e.g., Review lecture notes, Call dentist"
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="task-description" className="block text-sm font-medium mb-1">
            Description
          </label>
          <textarea
            id="task-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-input rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Additional details (optional)"
          />
        </div>

        {/* Domain and Priority */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="task-domain" className="block text-sm font-medium mb-1">
              Domain *
            </label>
            <select
              id="task-domain"
              value={domainId}
              onChange={(e) => setDomainId(parseInt(e.target.value))}
              required
              className="w-full px-3 py-2 border border-input rounded-lg bg-background
                       focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {domains.map((domain) => (
                <option key={domain.id} value={domain.id}>
                  {domain.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="task-priority" className="block text-sm font-medium mb-1">
              Priority *
            </label>
            <select
              id="task-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as 'must-do' | 'should-do' | 'nice-to-have')}
              required
              className="w-full px-3 py-2 border border-input rounded-lg bg-background
                       focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="must-do">Must Do</option>
              <option value="should-do">Should Do</option>
              <option value="nice-to-have">Nice to Have</option>
            </select>
          </div>
        </div>

        {/* Estimated Minutes and Due Date */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="task-minutes" className="block text-sm font-medium mb-1">
              Estimated Minutes * (1-480)
            </label>
            <input
              id="task-minutes"
              type="number"
              value={estimatedMinutes}
              onChange={(e) => setEstimatedMinutes(parseInt(e.target.value))}
              required
              min={1}
              max={480}
              className="w-full px-3 py-2 border border-input rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label htmlFor="task-due" className="block text-sm font-medium mb-1">
              Due Date
            </label>
            <input
              id="task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Recurrence Rule (Advanced) */}
        <div>
          <label htmlFor="task-rrule" className="block text-sm font-medium mb-1">
            Recurrence Rule (rrule format)
          </label>
          <input
            id="task-rrule"
            type="text"
            value={rrule}
            onChange={(e) => setRrule(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="e.g., FREQ=DAILY;INTERVAL=1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Advanced: Use rrule.js format for recurring tasks
          </p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 mt-6">
        <button
          type="submit"
          disabled={isSubmitting || !title.trim() || !domainId}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium
                   hover:bg-primary/90 transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Saving...' : initialData ? 'Save Changes' : 'Create Task'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-2 border border-input rounded-lg font-medium
                   hover:bg-muted transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Helper Functions
 */

function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
