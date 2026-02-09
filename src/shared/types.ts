import { z } from 'zod';

// ============================================================================
// Enums and Constants
// ============================================================================

export const TaskPriority = {
  MUST_DO: 'must-do',
  SHOULD_DO: 'should-do',
  NICE_TO_HAVE: 'nice-to-have',
} as const;

export const TaskStatus = {
  TODO: 'todo',
  IN_PROGRESS: 'in-progress',
  DONE: 'done',
  DROPPED: 'dropped',
} as const;

export const PlanCategory = {
  MUST_DO: 'must-do',
  WANT_TO: 'want-to',
  HEALTH: 'health',
} as const;

// ============================================================================
// Domain Validation Schemas
// ============================================================================

export const createDomainSchema = z.object({
  name: z.string().min(1, 'Domain name is required').max(100),
  description: z.string().default(''),
  whyItMatters: z.string().default(''),
  boringButImportant: z.boolean().default(false),
});

export const updateDomainSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  whyItMatters: z.string().optional(),
  boringButImportant: z.boolean().optional(),
});

export const deleteDomainSchema = z.object({
  id: z.number().int().positive(),
});

// ============================================================================
// Task Validation Schemas
// ============================================================================

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Task title is required').max(200),
  description: z.string().optional(),
  domainId: z.number().int().positive('Domain is required'),
  priority: z.enum([
    TaskPriority.MUST_DO,
    TaskPriority.SHOULD_DO,
    TaskPriority.NICE_TO_HAVE,
  ]),
  estimatedMinutes: z
    .number()
    .int()
    .min(1, 'Estimated duration must be between 1 and 480 minutes')
    .max(480, 'Estimated duration must be between 1 and 480 minutes'),
  dueDate: z.string().datetime().optional(), // ISO date string
  rrule: z.string().optional(), // rrule.js format
});

export const updateTaskSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  domainId: z.number().int().positive().optional(),
  priority: z
    .enum([TaskPriority.MUST_DO, TaskPriority.SHOULD_DO, TaskPriority.NICE_TO_HAVE])
    .optional(),
  estimatedMinutes: z.number().int().min(1).max(480).optional(),
  dueDate: z.string().datetime().optional(),
  status: z
    .enum([TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.DONE, TaskStatus.DROPPED])
    .optional(),
  rrule: z.string().optional(),
});

export const completeTaskSchema = z.object({
  id: z.number().int().positive(),
});

export const deleteTaskSchema = z.object({
  id: z.number().int().positive(),
});

export const listTasksSchema = z.object({
  domainId: z.number().int().positive().optional(),
  status: z
    .enum([TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.DONE, TaskStatus.DROPPED])
    .optional(),
  priority: z
    .enum([TaskPriority.MUST_DO, TaskPriority.SHOULD_DO, TaskPriority.NICE_TO_HAVE])
    .optional(),
});

export const snoozeTaskSchema = z.object({
  id: z.number().int().positive(),
  newDate: z.string().datetime(), // ISO date string
});

// ============================================================================
// Daily Log Validation Schemas
// ============================================================================

export const submitDailyLogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  hoursSlept: z
    .number()
    .min(0, 'Hours slept must be between 0 and 24')
    .max(24, 'Hours slept must be between 0 and 24'),
  energy: z
    .number()
    .int()
    .min(0, 'Energy must be between 0 and 10')
    .max(10, 'Energy must be between 0 and 10'),
  mood: z
    .number()
    .int()
    .min(0, 'Mood must be between 0 and 10')
    .max(10, 'Mood must be between 0 and 10'),
  medicationTaken: z.enum(['yes', 'no'], {
    errorMap: () => ({ message: "Medication taken must be 'yes' or 'no'" }),
  }),
});

export const getDailyLogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const getDailyLogRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// ============================================================================
// Planner Validation Schemas
// ============================================================================

export const generatePlanSchema = z.object({
  energyLevel: z
    .number()
    .int()
    .min(0, 'Energy level must be between 0 and 10')
    .max(10, 'Energy level must be between 0 and 10'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // defaults to today
});

export const getTodayPlanSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// ============================================================================
// Stats Validation Schemas
// ============================================================================

export const getBalanceSchema = z.object({
  days: z.number().int().positive().default(7),
});

// ============================================================================
// Summary Validation Schemas
// ============================================================================

export const generateSummarySchema = z.object({
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // defaults to today
});

// ============================================================================
// Type Exports (inferred from schemas)
// ============================================================================

export type CreateDomainInput = z.infer<typeof createDomainSchema>;
export type UpdateDomainInput = z.infer<typeof updateDomainSchema>;
export type DeleteDomainInput = z.infer<typeof deleteDomainSchema>;

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;
export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;
export type ListTasksInput = z.infer<typeof listTasksSchema>;
export type SnoozeTaskInput = z.infer<typeof snoozeTaskSchema>;

export type SubmitDailyLogInput = z.infer<typeof submitDailyLogSchema>;
export type GetDailyLogInput = z.infer<typeof getDailyLogSchema>;
export type GetDailyLogRangeInput = z.infer<typeof getDailyLogRangeSchema>;

export type GeneratePlanInput = z.infer<typeof generatePlanSchema>;
export type GetTodayPlanInput = z.infer<typeof getTodayPlanSchema>;

export type GetBalanceInput = z.infer<typeof getBalanceSchema>;

export type GenerateSummaryInput = z.infer<typeof generateSummarySchema>;
