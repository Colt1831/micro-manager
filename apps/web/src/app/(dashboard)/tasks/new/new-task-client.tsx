'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2,
  ArrowLeft,
  Send,
  AlertCircle,
  Calendar,
  User,
  Flag,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TaskTemplatePicker } from '@/components/tasks/task-template-picker';

// ─── Types ──────────────────────────────────────────────────

export type User = {
  id: string;
  name: string | null;
  email: string;
};

export type Project = {
  id: string;
  name: string;
  code: string | null;
};

// ─── Constants ──────────────────────────────────────────────

const priorityOptions = [
  { value: 'none', label: 'None', color: 'bg-surface-100 text-surface-600' },
  {
    value: 'low',
    label: 'Low',
    color: 'bg-green-100 text-green-700 ',
  },
  {
    value: 'medium',
    label: 'Medium',
    color: 'bg-amber-100 text-amber-700 ',
  },
  {
    value: 'high',
    label: 'High',
    color: 'bg-orange-100 text-orange-700 ',
  },
  {
    value: 'urgent',
    label: 'Urgent',
    color: 'bg-red-100 text-red-700 ',
  },
  {
    value: 'critical',
    label: 'Critical',
    color: 'bg-red-200 text-red-800 ',
  },
];

// ─── Page Component ─────────────────────────────────────────

interface NewTaskClientProps {
  /** Server-rendered assignee options; null means the server load failed and the client should fetch. */
  initialUsers: User[] | null;
  /** Server-rendered project options; null means the server load failed and the client should fetch. */
  initialProjects: Project[] | null;
}

export function NewTaskClient({ initialUsers, initialProjects }: NewTaskClientProps) {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [assignedTo, setAssignedTo] = useState('');
  const [projectId, setProjectId] = useState('');
  const [dueDate, setDueDate] = useState('');

  // When the server provided both option lists, first paint already has real content.
  const [hadInitialData] = useState(() => initialUsers !== null && initialProjects !== null);
  const [users, setUsers] = useState<User[]>(initialUsers ?? []);
  const [projects, setProjects] = useState<Project[]>(initialProjects ?? []);
  const [loading, setLoading] = useState(!hadInitialData);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [focusedField, setFocusedField] = useState<string | null>(null);

  // ── Template handler ────────────────────────────────────

  const handleApplyTemplate = useCallback(
    (templateData: { title?: string; description?: string; priority?: string }) => {
      if (templateData.title) setTitle(templateData.title);
      if (templateData.description) setDescription(templateData.description);
      if (templateData.priority) setPriority(templateData.priority);
    },
    [],
  );

  // ── Fetch form data ────────────────────────────────────

  // Only fetch on mount when the server did not provide data (fallback path).
  useEffect(() => {
    if (hadInitialData) return;
    async function fetchFormData() {
      try {
        const [usersRes, projectsRes] = await Promise.all([
          fetch('/api/users?limit=100'),
          fetch('/api/projects?limit=100'),
        ]);
        if (usersRes.ok) {
          const data = await usersRes.json();
          setUsers(data.users ?? []);
        }
        if (projectsRes.ok) {
          const data = await projectsRes.json();
          setProjects(data.projects ?? []);
        }
      } catch {
        // Non-critical
      } finally {
        setLoading(false);
      }
    }
    fetchFormData();
  }, [hadInitialData]);

  // ── Validation ─────────────────────────────────────────

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!title.trim()) {
      errors.title = 'Title is required';
    } else if (title.trim().length > 500) {
      errors.title = 'Title must be 500 characters or less';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ── Submit ─────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
      };

      if (assignedTo) body.assignedTo = assignedTo;
      if (projectId) body.projectId = projectId;
      if (dueDate) body.dueDate = new Date(dueDate).toISOString();

      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message ?? 'Failed to create task');
      }

      const data = await res.json();
      router.push(`/tasks/${data.task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  const getInputClasses = (fieldName: string, hasError = false) =>
    cn(
      'h-10 w-full rounded-lg border bg-surface-300 text-surface-800 px-3 py-2 text-sm shadow-sm transition-all duration-200',
      focusedField === fieldName
        ? 'border-brand-500 ring-2 ring-brand-500/20'
        : hasError
          ? 'border-red-300 ring-1 ring-red-500/20'
          : 'border-surface-300 hover:border-surface-400 ',
      'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
    );

  // ── Render ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="animate-fade-in max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="shimmer h-9 w-9 rounded-lg" />
          <div className="space-y-2">
            <div className="shimmer h-6 w-36 rounded-md" />
            <div className="shimmer h-4 w-56 rounded-md" />
          </div>
        </div>
        <div className="border-surface-500/20 rounded-xl border bg-surface-200 p-6">
          <div className="space-y-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="shimmer h-10 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          aria-label="Go back"
          className="border-surface-300/20 bg-surface-100/80 text-surface-500 hover:bg-surface-200/70 hover:text-surface-600 flex h-9 w-9 items-center justify-center rounded-xl border transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-surface-900 text-xl font-bold tracking-tight">
            New Task
          </h1>
          <p className="text-surface-500 mt-0.5 text-sm">Create a new task for your team</p>
        </div>
      </div>

      {/* Template Picker */}
      <TaskTemplatePicker onApplyTemplate={handleApplyTemplate} />

      <form onSubmit={handleSubmit}>
        <Card className="overflow-hidden">
          <CardHeader className="border-surface-300/10 border-b pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="text-surface-400 h-4 w-4" />
              Task Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            {/* Title */}
            <div>
              <label className="text-surface-500 mb-1.5 block text-xs font-semibold uppercase tracking-wider">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, title: '' }));
                }}
                onFocus={() => setFocusedField('title')}
                onBlur={() => setFocusedField(null)}
                placeholder="Enter task title"
                className={getInputClasses('title', !!fieldErrors.title)}
                autoFocus
              />
              {fieldErrors.title && (
                <p className="animate-slide-up mt-1 text-xs font-medium text-red-500">
                  {fieldErrors.title}
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="text-surface-500 mb-1.5 block text-xs font-semibold uppercase tracking-wider">
                Description
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what needs to be done..."
                className="border-surface-300/30 focus:border-brand-500 focus:ring-brand-500/20 min-h-[120px] rounded-xl transition-all duration-200 focus:ring-2"
              />
            </div>

            {/* Two-column row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-surface-500 mb-1.5 block text-xs font-semibold uppercase tracking-wider">
                  <Flag className="text-surface-400 -mt-0.5 mr-1 inline h-3.5 w-3.5" />
                  Priority
                </label>
                <select
                  aria-label="Priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="border-surface-300/20 bg-surface-100/80 hover:border-surface-400/40 focus:border-brand-500 focus:ring-brand-500/25 h-10 w-full rounded-xl border px-3 text-sm shadow-sm transition-all duration-200 focus:outline-none focus:ring-2"
                >
                  {priorityOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-surface-500 mb-1.5 block text-xs font-semibold uppercase tracking-wider">
                  <Calendar className="text-surface-400 -mt-0.5 mr-1 inline h-3.5 w-3.5" />
                  Due Date
                </label>
                <input
                  type="date"
                  aria-label="Due date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="border-surface-300/20 bg-surface-100/80 hover:border-surface-400/40 focus:border-brand-500 focus:ring-brand-500/25 h-10 w-full rounded-xl border px-3 text-sm shadow-sm transition-all duration-200 focus:outline-none focus:ring-2"
                />
              </div>
            </div>

            {/* Two-column row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-surface-500 mb-1.5 block text-xs font-semibold uppercase tracking-wider">
                  <User className="text-surface-400 -mt-0.5 mr-1 inline h-3.5 w-3.5" />
                  Assignee
                </label>
                <select
                  aria-label="Assignee"
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  className="border-surface-300/20 bg-surface-100/80 hover:border-surface-400/40 focus:border-brand-500 focus:ring-brand-500/25 h-10 w-full rounded-xl border px-3 text-sm shadow-sm transition-all duration-200 focus:outline-none focus:ring-2"
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name ?? u.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-surface-500 mb-1.5 block text-xs font-semibold uppercase tracking-wider">
                  <FileText className="text-surface-400 -mt-0.5 mr-1 inline h-3.5 w-3.5" />
                  Project
                </label>
                <select
                  aria-label="Project"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="border-surface-300/20 bg-surface-100/80 hover:border-surface-400/40 focus:border-brand-500 focus:ring-brand-500/25 h-10 w-full rounded-xl border px-3 text-sm shadow-sm transition-all duration-200 focus:outline-none focus:ring-2"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code ? `${p.code} — ${p.name}` : p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="border-error/20 bg-error/5 text-error animate-slide-up flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="border-surface-300/20 flex items-center justify-end gap-3 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-4 w-4" />
                )}
                Create Task
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
