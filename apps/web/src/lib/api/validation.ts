import { z } from 'zod';

// ─── Task Status Transition Map ──────────────────────────────
// Valid transitions between task statuses.
// Key is current status, value is array of allowed next statuses.

const _VALID_STATUSES = [
  'draft',
  'open',
  'assigned',
  'in_progress',
  'blocked',
  'on_hold',
  'under_review',
  'completed',
  'closed',
  'reopened',
  'cancelled',
  'archived',
] as const;

export type TaskStatus = (typeof _VALID_STATUSES)[number];

export const TASK_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['open', 'cancelled', 'archived'],
  open: ['assigned', 'in_progress', 'cancelled', 'archived'],
  assigned: ['in_progress', 'blocked', 'on_hold', 'cancelled', 'archived'],
  in_progress: ['blocked', 'on_hold', 'under_review', 'cancelled', 'archived'],
  blocked: ['in_progress', 'on_hold', 'cancelled', 'archived'],
  on_hold: ['in_progress', 'cancelled', 'archived'],
  under_review: ['completed', 'in_progress', 'blocked', 'cancelled', 'archived'],
  completed: ['closed', 'reopened', 'cancelled', 'archived'],
  closed: ['reopened', 'archived'],
  reopened: ['assigned', 'in_progress', 'cancelled', 'archived'],
  cancelled: ['reopened', 'archived'],
  archived: [],
};

// Completed/Closed statuses that make a task read-only for most edits
export const READONLY_STATUSES = new Set(['closed', 'archived']);
export const COMPLETED_STATUSES = new Set(['completed', 'closed']);

// ─── Allowed Priorities ──────────────────────────────────────

export const VALID_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent', 'critical'] as const;

// ─── Allowed File Types ──────────────────────────────────────

export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.js',
  '.sh',
  '.bat',
  '.cmd',
  '.php',
  '.html',
  '.htm',
  '.svg',
  '.msi',
  '.dll',
  '.ps1',
  '.jar',
  '.vbs',
  '.scr',
]);

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// ─── Validate status transition ──────────────────────────────

export function isValidTransition(from: string, to: string): boolean {
  const allowed = TASK_STATUS_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

// ─── Zod Schemas ─────────────────────────────────────────────

// Task schemas
export const TaskCreateSchema = z
  .object({
    title: z
      .string()
      .min(1, 'Title is required')
      .max(500, 'Title must be under 500 characters')
      .transform((s) => s.trim()),
    description: z
      .string()
      .max(10000, 'Description too long')
      .optional()
      .nullable()
      .transform((s) => s?.trim() ?? null),
    projectId: z.string().uuid('Invalid project ID').optional().nullable(),
    milestoneId: z.string().uuid('Invalid milestone ID').optional().nullable(),
    priority: z.enum(VALID_PRIORITIES).optional().default('medium'),
    assignedTo: z.string().optional().nullable(),
    dueDate: z.string().optional().nullable(),
  })
  .strict('Unexpected fields in task creation');

export const TaskUpdateSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .max(500)
      .transform((s) => s.trim())
      .optional(),
    description: z
      .string()
      .max(10000)
      .transform((s) => s.trim())
      .optional()
      .nullable(),
    status: z.string().optional(),
    priority: z.enum(VALID_PRIORITIES).optional(),
    assignedTo: z.string().optional().nullable(),
    dueDate: z.string().optional().nullable(),
    projectId: z.string().uuid().optional().nullable(),
    // Cannot be set by client
  })
  .strict('Unexpected fields in task update');

export const CommentCreateSchema = z
  .object({
    content: z
      .string()
      .min(1, 'Comment is required')
      .max(10000, 'Comment too long')
      .transform((s) => s.trim()),
  })
  .strict('Unexpected fields in comment');

export const AttachmentCreateSchema = z
  .object({
    fileName: z.string().min(1, 'File name is required').max(500),
    fileSize: z.number().int().positive().max(MAX_FILE_SIZE).optional().nullable(),
    mimeType: z.string().max(100).optional().nullable(),
    storageKey: z.string().min(1, 'storageKey is required'),
  })
  .strict('Unexpected fields in attachment');

// Project schemas
export const ProjectCreateSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Name is required')
      .max(300)
      .transform((s) => s.trim()),
    code: z
      .string()
      .max(20)
      .transform((s) => s.trim())
      .optional()
      .nullable(),
    description: z
      .string()
      .max(10000)
      .transform((s) => s.trim())
      .optional()
      .nullable(),
    ownerId: z.string().min(1, 'ownerId is required').optional(),
    departmentId: z.string().uuid().optional().nullable(),
    teamId: z.string().uuid().optional().nullable(),
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
  })
  .strict('Unexpected fields in project creation');

// Project update schema
export const ProjectUpdateSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(300)
      .transform((s) => s.trim())
      .optional(),
    code: z
      .string()
      .max(20)
      .transform((s) => s.trim())
      .optional()
      .nullable(),
    description: z
      .string()
      .max(10000)
      .transform((s) => s.trim())
      .optional()
      .nullable(),
    ownerId: z.string().min(1).optional(),
    departmentId: z.string().uuid().optional().nullable(),
    teamId: z.string().uuid().optional().nullable(),
    status: z.string().max(50).optional(),
    priority: z.string().max(20).optional(),
    progress: z.number().int().min(0).max(100).optional(),
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
    tags: z.array(z.string().max(100)).optional(),
  })
  .strict('Unexpected fields in project update');

// Team schemas
export const TeamCreateSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Name is required')
      .max(200)
      .transform((s) => s.trim()),
    code: z
      .string()
      .max(50)
      .transform((s) => s.trim())
      .optional()
      .nullable(),
    description: z
      .string()
      .max(10000)
      .transform((s) => s.trim())
      .optional()
      .nullable(),
    departmentId: z.string().uuid().optional().nullable(),
    leadUserId: z.string().optional().nullable(),
  })
  .strict('Unexpected fields in team creation');

export const TeamUpdateSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(200)
      .transform((s) => s.trim())
      .optional(),
    description: z
      .string()
      .max(10000)
      .transform((s) => s.trim())
      .optional()
      .nullable(),
    departmentId: z.string().uuid().optional().nullable(),
    leadUserId: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .strict('Unexpected fields in team update');

export const TeamMemberAddSchema = z
  .object({
    userId: z.string().min(1, 'userId is required'),
    role: z.string().max(50).optional().default('member'),
  })
  .strict('Unexpected fields in team member add');

// Department schemas
export const DepartmentCreateSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Name is required')
      .max(200)
      .transform((s) => s.trim()),
    code: z
      .string()
      .max(50)
      .transform((s) => s.trim())
      .optional()
      .nullable(),
    description: z
      .string()
      .max(10000)
      .transform((s) => s.trim())
      .optional()
      .nullable(),
    headUserId: z.string().optional().nullable(),
    parentId: z.string().uuid().optional().nullable(),
  })
  .strict('Unexpected fields in department creation');

export const DepartmentUpdateSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(200)
      .transform((s) => s.trim())
      .optional(),
    description: z
      .string()
      .max(10000)
      .transform((s) => s.trim())
      .optional()
      .nullable(),
    headUserId: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .strict('Unexpected fields in department update');

// Time Entry schemas
export const TimeEntryCreateSchema = z
  .object({
    entryType: z.enum(['timer', 'manual']).optional().default('manual'),
    durationMinutes: z.number().int().positive('Duration must be positive').optional().nullable(),
    description: z.string().max(1000, 'Description too long').optional().nullable(),
    // Manual entries may supply an explicit window. Timer entries ignore these
    // (server now() is authoritative). Coerced to Date; end must be >= start.
    startTime: z.coerce.date().optional(),
    endTime: z.coerce.date().optional(),
  })
  .strict('Unexpected fields in time entry')
  .refine((d) => !(d.startTime && d.endTime) || d.endTime >= d.startTime, {
    message: 'endTime must be on or after startTime',
    path: ['endTime'],
  });

// ─── Time Correction Schemas ────────────────────────────────

export const TimeCorrectionCreateSchema = z
  .object({
    timeEntryId: z.string().uuid('Invalid time entry ID'),
    requestedMinutes: z
      .number()
      .int('Must be a whole number')
      .positive('Duration must be positive')
      .max(1440, 'Duration cannot exceed 24 hours'),
    reason: z
      .string()
      .min(1, 'Reason is required')
      .max(1000, 'Reason too long')
      .transform((s) => s.trim()),
  })
  .strict('Unexpected fields in time correction');



export const TimeCorrectionReviewSchema = z
  .object({
    status: z.enum(['approved', 'rejected']),
    reviewNote: z
      .string()
      .max(1000)
      .transform((s) => s.trim())
      .optional()
      .nullable(),
  })
  .strict('Unexpected fields in time correction review');

// Role schemas
export const RoleCreateSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Name is required')
      .max(100)
      .transform((s) => s.trim()),
    slug: z
      .string()
      .min(1, 'Slug is required')
      .max(100)
      .transform((s) => s.trim()),
    description: z
      .string()
      .max(500)
      .transform((s) => s.trim())
      .optional()
      .nullable(),
    permissionIds: z.array(z.string().uuid()).optional(),
  })
  .strict('Unexpected fields in role creation');



// Validation response helper
export function validationError(errors: z.ZodError) {
  const details: Record<string, string[]> = {};
  for (const issue of errors.issues) {
    const path = issue.path.join('.');
    if (!details[path]) details[path] = [];
    details[path]!.push(issue.message);
  }
  return {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details,
    },
    status: 400 as const,
  };
}
