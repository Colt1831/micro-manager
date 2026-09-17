'use client';

import { useEffect, useState, useCallback, startTransition } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Loader2,
  Plus,
  X,
  AlertCircle,
  Edit3,
  Trash2,
  FileText,
  Star,
  Clock,
  Tag,
  List,
  Sparkles,
  Save,
  Layers,
  ArrowRight,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────

export interface TaskTemplate {
  id: string;
  name: string;
  description: string | null;
  taskTitle: string | null;
  taskDescription: string | null;
  priority: string | null;
  category: string | null;
  labels: string[] | null;
  tags: string[] | null;
  estimatedHours: string | null;
  isDefault: boolean;
  createdAt: string;
}

// ─── Constants ──────────────────────────────────────────────

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  none: { label: 'None', color: 'text-surface-400 bg-surface-500/10' },
  low: { label: 'Low', color: 'text-blue-500 bg-blue-500/10' },
  medium: { label: 'Medium', color: 'text-amber-500 bg-amber-500/10' },
  high: { label: 'High', color: 'text-orange-500 bg-orange-500/10' },
  urgent: { label: 'Urgent', color: 'text-error bg-error/10' },
  critical: { label: 'Critical', color: 'text-rose-500 bg-rose-500/10' },
};

function getPriorityConfig(priority: string | null): { label: string; color: string } {
  return (PRIORITY_CONFIG[priority ?? 'none'] ?? PRIORITY_CONFIG.none)!;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const EMPTY_FORM = {
  name: '',
  description: '',
  taskTitle: '',
  taskDescription: '',
  priority: 'medium' as string,
  category: '',
  labels: '',
  tags: '',
  estimatedHours: '',
  isDefault: false,
};

// ─── Animation Variants ─────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.03 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } },
} as const;

// ═══════════════════════════════════════════════════════════════
//  TASK TEMPLATES PAGE
// ═══════════════════════════════════════════════════════════════

interface TaskTemplatesClientProps {
  /** Server-rendered templates; null means the server load failed and the client should fetch. */
  initialTemplates: TaskTemplate[] | null;
}

export function TaskTemplatesClient({ initialTemplates }: TaskTemplatesClientProps) {
  // When the server provided data, first paint already has real content — skip
  // the loading skeleton and the entrance fade. Computed once (prop is stable).
  const [hadInitialData] = useState(() => initialTemplates !== null);
  const [templates, setTemplates] = useState<TaskTemplate[]>(initialTemplates ?? []);
  const [loading, setLoading] = useState(initialTemplates === null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  // ── Fetch templates ────────────────────────────────────

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/task-templates');
      if (!res.ok) throw new Error('Failed to load templates');
      const data = await res.json();
      setTemplates(data.templates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  // Only fetch on mount when the server did not provide data (fallback path).
  useEffect(() => {
    if (hadInitialData) return;
    startTransition(() => {
      fetchTemplates();
    });
  }, [hadInitialData, fetchTemplates]);

  // ── Form ────────────────────────────────────────────────

  const openCreateForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (t: TaskTemplate) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      description: t.description ?? '',
      taskTitle: t.taskTitle ?? '',
      taskDescription: t.taskDescription ?? '',
      priority: t.priority ?? 'medium',
      category: t.category ?? '',
      labels: (t.labels ?? []).join(', '),
      tags: (t.tags ?? []).join(', '),
      estimatedHours: t.estimatedHours ?? '',
      isDefault: t.isDefault,
    });
    setFormError(null);
    setShowForm(true);
  };

  const saveTemplate = async () => {
    if (!form.name.trim()) { setFormError('Name is required'); return; }

    setSaving(true);
    setFormError(null);

    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        taskTitle: form.taskTitle.trim() || null,
        taskDescription: form.taskDescription.trim() || null,
        priority: form.priority,
        category: form.category.trim() || null,
        labels: form.labels.trim() ? form.labels.split(',').map((s) => s.trim()).filter(Boolean) : null,
        tags: form.tags.trim() ? form.tags.split(',').map((s) => s.trim()).filter(Boolean) : null,
        estimatedHours: form.estimatedHours ? Number(form.estimatedHours) : null,
        isDefault: form.isDefault,
      };

      const url = editingId ? `/api/task-templates?id=${editingId}` : '/api/task-templates';
      const method = editingId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message ?? data.error?.details ?? 'Failed to save');
      }

      setShowForm(false);
      fetchTemplates();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────

  const deleteTemplate = async () => {
    if (!showDeleteConfirm) return;
    setDeletingId(showDeleteConfirm);
    try {
      const res = await fetch(`/api/task-templates?id=${showDeleteConfirm}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      setShowDeleteConfirm(null);
      fetchTemplates();
    } catch {
      setShowDeleteConfirm(null);
    } finally {
      setDeletingId(null);
    }
  };

  // ── Toggle default ──────────────────────────────────────

  const toggleDefault = async (t: TaskTemplate) => {
    try {
      const res = await fetch(`/api/task-templates?id=${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: !t.isDefault }),
      });
      if (res.ok) fetchTemplates();
    } catch { /* */ }
  };

  // ── Render ──────────────────────────────────────────────

  const defaultTemplate = templates.find((t) => t.isDefault);
  const sortedTemplates = [...templates].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return 0;
  });

  return (
    <motion.div
      variants={containerVariants}
      initial={hadInitialData ? false : 'hidden'}
      animate="visible"
      className="mx-auto max-w-4xl space-y-6"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <PageHeader
          className="mb-0"
          icon={
            <div className="bg-brand-500/15 flex h-8 w-8 items-center justify-center rounded-lg">
              <Layers className="h-4 w-4 text-white" />
            </div>
          }
          title="Task Templates"
          subtitle={
            <>
              {templates.length} template{templates.length !== 1 ? 's' : ''}
              {defaultTemplate && (
                <>
                  {' · '}
                  <span className="text-amber-500 font-medium">{defaultTemplate.name}</span> is default
                </>
              )}
            </>
          }
          actions={
            <Button size="sm" onClick={openCreateForm} className="h-8 rounded-lg px-3 text-xs">
              <Plus className="mr-1 h-3.5 w-3.5" />
              New Template
            </Button>
          }
        />
      </motion.div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="shimmer h-32 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center py-12">
          <AlertCircle className="text-error mb-2 h-8 w-8" />
          <p className="text-error text-sm">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={fetchTemplates}>Retry</Button>
        </div>
      ) : templates.length === 0 ? (
        <motion.div variants={itemVariants} className="flex flex-col items-center py-16">
          <div className="border-surface-300/20 bg-surface-100/50 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border">
            <FileText className="text-surface-400 h-7 w-7" />
          </div>
          <h3 className="text-surface-900 text-base font-semibold">No templates yet</h3>
          <p className="text-surface-500 mt-1.5 max-w-md text-center text-sm">
            Create templates to quickly generate tasks with predefined titles, descriptions, priorities, labels, and more.
          </p>
          <Button onClick={openCreateForm} className="mt-5 h-8 rounded-xl px-3 text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" />
            Create Your First Template
          </Button>
        </motion.div>
      ) : (
        <motion.div variants={itemVariants} className="space-y-3">
          {sortedTemplates.map((t, idx) => {
            const priorityConfig = getPriorityConfig(t.priority);
            const labels = t.labels ?? [];
            const tags = t.tags ?? [];

            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className={cn(
                  'neon-card relative overflow-hidden rounded-2xl transition-all duration-200',
                  t.isDefault && 'ring-1 ring-amber-500/30',
                )}
              >
                {/* Default indicator bar */}
                {t.isDefault && (
                  <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-amber-400 to-amber-600" />
                )}
                {!t.isDefault && (
                  <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-400 to-brand-600 opacity-40" />
                )}

                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div
                        className={cn(
                          'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                          t.isDefault ? 'bg-amber-500/10 text-amber-500' : 'bg-brand-500/10 text-brand-500',
                        )}
                      >
                        <FileText className="h-4.5 w-4.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-surface-900 text-sm font-semibold">{t.name}</h3>
                          {t.isDefault && (
                            <Badge variant="warning" size="sm" className="px-1.5 py-0 text-[9px]">
                              <Star className="mr-0.5 h-2.5 w-2.5" />
                              Default
                            </Badge>
                          )}
                        </div>

                        {/* Description */}
                        {t.description && (
                          <p className="text-surface-500 mt-0.5 line-clamp-1 text-xs">{t.description}</p>
                        )}

                        {/* Template fields */}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {/* Priority */}
                          <span className={cn('inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[9px] font-medium', priorityConfig.color)}>
                            {t.priority ?? 'none'}
                          </span>

                          {/* Task title preview */}
                          {t.taskTitle && (
                            <span className="text-surface-400 inline-flex items-center gap-1 text-[9px]">
                              <ArrowRight className="h-2.5 w-2.5" />
                              &quot;{t.taskTitle.length > 40 ? t.taskTitle.slice(0, 40) + '...' : t.taskTitle}&quot;
                            </span>
                          )}

                          {/* Category */}
                          {t.category && (
                            <span className="text-surface-400 inline-flex items-center gap-1 rounded-lg bg-surface-200/40 px-1.5 py-0.5 text-[9px]">
                              <List className="h-2.5 w-2.5" />
                              {t.category}
                            </span>
                          )}

                          {/* Estimated hours */}
                          {t.estimatedHours && (
                            <span className="text-surface-400 inline-flex items-center gap-1 text-[9px]">
                              <Clock className="h-2.5 w-2.5" />
                              {t.estimatedHours}h
                            </span>
                          )}

                          {/* Labels */}
                          {labels.slice(0, 3).map((label) => (
                            <span
                              key={label}
                              className="inline-flex items-center gap-1 rounded-lg bg-surface-200/40 px-1.5 py-0.5 text-[9px] text-surface-500"
                            >
                              <Tag className="h-2.5 w-2.5" />
                              {label}
                            </span>
                          ))}
                          {labels.length > 3 && (
                            <span className="text-surface-400 text-[9px]">+{labels.length - 3}</span>
                          )}

                          {/* Tags */}
                          {tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="bg-surface-200/30 text-surface-500 rounded px-1 py-0.5 text-[9px] font-mono"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => toggleDefault(t)}
                        className={cn(
                          'rounded-lg p-1.5 transition-all',
                          t.isDefault
                            ? 'text-amber-500 hover:bg-amber-500/10'
                            : 'text-surface-400 hover:text-amber-500 hover:bg-amber-500/10',
                        )}
                        title={t.isDefault ? 'Remove default' : 'Set as default'}
                      >
                        <Star className={cn('h-3.5 w-3.5', t.isDefault && 'fill-amber-500')} />
                      </button>
                      <button
                        onClick={() => openEditForm(t)}
                        title="Edit template"
                        className="text-surface-400 hover:text-brand-500 hover:bg-brand-500/10 rounded-lg p-1.5 transition-all"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setShowDeleteConfirm(t.id)}
                        title="Delete template"
                        className="text-surface-400 hover:text-error hover:bg-error/10 rounded-lg p-1.5 transition-all"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Bottom info */}
                  <div className="text-surface-400 mt-3 flex items-center gap-3 border-t border-surface-300/10 pt-2 text-[10px]">
                    <span>Created {formatDate(t.createdAt)}</span>
                    {t.taskDescription && (
                      <>
                        <span>·</span>
                        <span className="line-clamp-1">{t.taskDescription.slice(0, 80)}{t.taskDescription.length > 80 ? '...' : ''}</span>
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}

          {/* Hint */}
          <div className="flex items-center justify-center gap-2 pt-2 text-[10px] text-surface-400">
            <Sparkles className="h-3 w-3" />
            <span>
              Templates are available when creating tasks. Click{' '}
              <kbd className="bg-surface-200/50 rounded px-1 font-mono">From Template</kbd>{' '}
              on the task creation form to apply one.
            </span>
          </div>
        </motion.div>
      )}

      {/* Create/Edit Form Dialog */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm py-10"
            onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="border-surface-300/30 bg-surface-50/95 w-full max-w-xl rounded-2xl border p-6 shadow-lg backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-surface-900 text-lg font-semibold">
                  {editingId ? 'Edit Template' : 'New Task Template'}
                </h3>
                <button onClick={() => setShowForm(false)} className="text-surface-500 hover:bg-surface-200/70 hover:text-surface-600 rounded-lg p-1.5 transition-all">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Name */}
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g., Bug Report"
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">Description</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                    placeholder="Template description (optional)"
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>

                {/* Task Title Template */}
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Task Title Template <span className="font-normal normal-case">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={form.taskTitle}
                    onChange={(e) => setForm((p) => ({ ...p, taskTitle: e.target.value }))}
                    placeholder="e.g., Fix: [summary] — will be prefilled when creating a task"
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>

                {/* Task Description Template */}
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Task Description <span className="font-normal normal-case">(optional)</span>
                  </label>
                  <textarea
                    value={form.taskDescription}
                    onChange={(e) => setForm((p) => ({ ...p, taskDescription: e.target.value }))}
                    placeholder="Default description for the task"
                    rows={3}
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>

                {/* Priority + Category Row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">Priority</label>
                    <select
                      value={form.priority}
                      onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
                      className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                    >
                      <option value="none">None</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">Category</label>
                    <input
                      type="text"
                      value={form.category}
                      onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                      placeholder="e.g., Bug, Feature"
                      className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                    />
                  </div>
                </div>

                {/* Labels + Tags Row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                      Labels <span className="font-normal normal-case">(comma separated)</span>
                    </label>
                    <input
                      type="text"
                      value={form.labels}
                      onChange={(e) => setForm((p) => ({ ...p, labels: e.target.value }))}
                      placeholder="bug, frontend, urgent"
                      className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                    />
                  </div>
                  <div>
                    <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                      Tags <span className="font-normal normal-case">(comma separated)</span>
                    </label>
                    <input
                      type="text"
                      value={form.tags}
                      onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))}
                      placeholder="sprint-24, q4"
                      className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                    />
                  </div>
                </div>

                {/* Estimated Hours */}
                <div className="w-32">
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Est. Hours
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={form.estimatedHours}
                    onChange={(e) => setForm((p) => ({ ...p, estimatedHours: e.target.value }))}
                    placeholder="0"
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>

                {/* Default toggle */}
                <label className="border-surface-300/20 hover:border-brand-500/20 flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-all hover:bg-surface-200/40 ">
                  <input
                    type="checkbox"
                    checked={form.isDefault}
                    onChange={(e) => setForm((p) => ({ ...p, isDefault: e.target.checked }))}
                    className="border-surface-400 text-brand-500 focus:ring-brand-500 rounded"
                  />
                  <div>
                    <p className="text-surface-700 text-sm font-medium">Set as default template</p>
                    <p className="text-surface-500 text-xs">The default template will be pre-selected when creating new tasks.</p>
                  </div>
                </label>

                {/* Error */}
                {formError && (
                  <div className="bg-error/5 text-error flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {formError}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 border-t border-surface-300/10 pt-4">
                  <Button variant="outline" size="sm" onClick={() => setShowForm(false)} className="h-8 rounded-lg px-3 text-xs">Cancel</Button>
                  <Button onClick={saveTemplate} disabled={saving} size="sm" className="h-8 rounded-lg px-3 text-xs">
                    {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
                    {editingId ? 'Update' : 'Create'}
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="border-surface-300/30 bg-surface-50/95 w-full max-w-sm rounded-2xl border p-6 shadow-lg backdrop-blur-xl"
            >
              <h3 className="text-surface-900 text-lg font-semibold">Delete Template</h3>
              <p className="text-surface-500 mt-2 text-sm">Are you sure? This action cannot be undone.</p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowDeleteConfirm(null)} className="rounded-lg">Cancel</Button>
                <Button onClick={deleteTemplate} disabled={deletingId === showDeleteConfirm} className="rounded-lg bg-red-500 hover:bg-red-600 text-white">
                  {deletingId === showDeleteConfirm ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />}
                  Delete
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
