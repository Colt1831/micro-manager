'use client';

import { useCallback, useEffect, useState, startTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state-display';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  FolderOpen,
  AlertCircle,
  X,
  Plus,
  Loader2,
  Check,
  Search,
  Pencil,
  Trash2,
} from 'lucide-react';
import { containerVariants, itemVariants } from '@/lib/motion/variants';
import { FormField } from '@/components/ui/form-field';

export type Project = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: string;
  priority: string;
  progress: number;
  ownerId: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
};

const statusBadge: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'info'> = {
  active: 'success',
  on_hold: 'warning',
  completed: 'primary',
  archived: 'default',
};

/** "on_hold" → "On Hold" for display; the Badge variant keeps the semantic color. */
function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface ProjectsClientProps {
  /** Server-rendered projects; null means the server load failed and the client should fetch. */
  initialProjects: Project[] | null;
}

export function ProjectsClient({ initialProjects }: ProjectsClientProps) {
  // When the server provided data, first paint already has real content — skip
  // the loading skeleton and the entrance fade. Computed once (prop is stable).
  const [hadInitialData] = useState(() => initialProjects !== null);

  const [projects, setProjects] = useState<Project[]>(initialProjects ?? []);
  const [loading, setLoading] = useState(initialProjects === null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Create / edit modal state (editingId === null means create)
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    code: '',
    description: '',
    startDate: '',
    endDate: '',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  // Only fetch on mount when the server did not provide data (fallback path);
  // otherwise first paint already has content and refetching would just
  // reintroduce the client waterfall we are removing.
  useEffect(() => {
    if (hadInitialData) return;
    startTransition(() => {
      fetchData();
    });
  }, [hadInitialData, fetchData]);

  const filtered = search
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.code?.toLowerCase().includes(search.toLowerCase()),
      )
    : projects;

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: '', code: '', description: '', startDate: '', endDate: '' });
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (project: Project) => {
    setEditingId(project.id);
    setForm({
      name: project.name,
      code: project.code ?? '',
      description: project.description ?? '',
      startDate: project.startDate ? project.startDate.slice(0, 10) : '',
      endDate: project.endDate ? project.endDate.slice(0, 10) : '',
    });
    setFormError(null);
    setShowForm(true);
  };

  const saveProject = async () => {
    if (!form.name.trim()) {
      setFormError('Project name is required');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const isEdit = editingId !== null;
      // On edit, send the managed fields explicitly (code/description/dates are
      // nullable) so they can be cleared; on create, only include what was filled.
      const body: Record<string, unknown> = { name: form.name.trim() };
      if (isEdit) {
        body.code = form.code.trim() || null;
        body.description = form.description.trim() || null;
        body.startDate = form.startDate ? new Date(form.startDate).toISOString() : null;
        body.endDate = form.endDate ? new Date(form.endDate).toISOString() : null;
      } else {
        if (form.code.trim()) body.code = form.code.trim();
        if (form.description.trim()) body.description = form.description.trim();
        if (form.startDate) body.startDate = new Date(form.startDate).toISOString();
        if (form.endDate) body.endDate = new Date(form.endDate).toISOString();
      }

      const res = await fetch(isEdit ? `/api/projects/${editingId}` : '/api/projects', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? `Failed to ${isEdit ? 'update' : 'create'} project`);
      }

      if (isEdit) {
        // PATCH returns { success: true }, so update the row from the sent values.
        setProjects((prev) =>
          prev.map((p) =>
            p.id === editingId
              ? {
                  ...p,
                  name: body.name as string,
                  code: (body.code as string | null) ?? null,
                  description: (body.description as string | null) ?? null,
                  startDate: (body.startDate as string | null) ?? null,
                  endDate: (body.endDate as string | null) ?? null,
                }
              : p,
          ),
        );
      } else {
        const data = await res.json();
        setProjects((prev) => [data.project, ...prev]);
      }
      setShowForm(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save project');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/projects/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? 'Failed to delete project');
      }
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete project');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="space-y-1">
          <div className="shimmer h-8 w-48 rounded-xl" />
          <div className="shimmer mt-2 h-4 w-32 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="neon-card rounded-2xl p-5">
              <div className="shimmer h-4 w-3/4 rounded-lg" />
              <div className="shimmer mt-2 h-3 w-1/3 rounded-lg" />
              <div className="shimmer mt-4 h-3 w-full rounded-lg" />
              <div className="shimmer mt-2 h-3 w-2/3 rounded-lg" />
              <div className="shimmer mt-4 h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Card className="border-error/20 w-full max-w-md">
          <CardContent className="flex flex-col items-center p-8 text-center">
            <AlertCircle className="text-error mb-3 h-10 w-10" />
            <h2 className="text-surface-900 text-lg font-semibold">Failed to load projects</h2>
            <p className="text-surface-500 mt-1 text-sm">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                setError(null);
                fetchData();
              }}
              className="mt-3"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial={hadInitialData ? false : 'hidden'}
      animate="visible"
      className="space-y-6"
    >
      <motion.div variants={itemVariants}>
        <PageHeader
          className="mb-0"
          title="Projects"
          subtitle={`${projects.length} project${projects.length !== 1 ? 's' : ''}`}
          actions={
            <Button onClick={openCreate} className="btn-shine shadow-sm shadow-brand-500/20">
              <Plus className="mr-2 h-4 w-4" /> New Project
            </Button>
          }
        />
      </motion.div>

      {projects.length > 0 && (
        <motion.div variants={itemVariants}>
          <div className="relative max-w-md">
            <Search className="text-surface-400 absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </motion.div>
      )}

      {filtered.length === 0 && projects.length > 0 ? (
        <motion.div variants={itemVariants} className="py-12 text-center">
          <p className="text-surface-500 text-sm">No projects match your search.</p>
        </motion.div>
      ) : projects.length === 0 ? (
        <motion.div variants={itemVariants}>
          <EmptyState
            icon={<FolderOpen className="text-surface-300 h-16 w-16" />}
            title="No projects yet"
            message="Organize your work into projects to track progress."
            action={
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                Create Project
              </Button>
            }
          />
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project, i) => (
            <motion.div key={project.id} variants={itemVariants} custom={i}>
              <div
                className="border-surface-700/15 bg-surface-200 shadow-card hover:border-surface-700/30 hover:bg-surface-300/50 group relative flex h-full flex-col overflow-hidden rounded-xl border p-5 transition-colors duration-150"
              >
                {/* Stretched link: the whole card opens the project; the edit/delete
                    buttons sit above it (z-10) so they stay clickable. */}
                <Link
                  href={`/projects/${project.id}`}
                  aria-label={`Open ${project.name}`}
                  className="absolute inset-0 z-[1] rounded-2xl"
                />
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-surface-900 truncate font-semibold">{project.name}</h3>
                    {project.code && (
                      <p className="text-surface-500 mt-0.5 font-mono text-xs">{project.code}</p>
                    )}
                  </div>
                  <div className="relative z-10 flex shrink-0 items-center gap-1.5">
                    <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => openEdit(project)}
                        aria-label={`Edit ${project.name}`}
                        className="text-surface-400 hover:bg-surface-200/70 hover:text-surface-600 rounded-lg p-1.5 transition-all"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(project)}
                        aria-label={`Delete ${project.name}`}
                        className="text-surface-400 hover:bg-error/10 hover:text-error rounded-lg p-1.5 transition-all"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <Badge variant={statusBadge[project.status] ?? 'default'} size="sm">
                      {formatStatus(project.status)}
                    </Badge>
                  </div>
                </div>
                {project.description && (
                  <p className="text-surface-600 mb-3 line-clamp-2 min-h-[2.5rem] text-sm leading-relaxed">
                    {project.description}
                  </p>
                )}
                <div className="mt-auto space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-surface-600 text-[11px] font-medium uppercase tracking-wide">
                      Progress
                    </span>
                    <span className="text-brand-400 font-semibold tabular-nums">
                      {project.progress}%
                    </span>
                  </div>
                  <div className="bg-surface-300/40 h-1.5 overflow-hidden rounded-full">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${project.progress}%` }}
                      transition={{ duration: 1, ease: 'easeOut' }}
                      className="from-brand-500 to-brand-400 h-full rounded-full bg-gradient-to-r shadow-[0_0_6px_rgba(138,120,255,0.5)]"
                    />
                  </div>
                </div>
                {(project.startDate || project.endDate) && (
                  <div className="text-surface-500 mt-3 flex items-center gap-3 text-xs">
                    {project.startDate && (
                      <span>Start: {new Date(project.startDate).toLocaleDateString()}</span>
                    )}
                    {project.endDate && (
                      <span>End: {new Date(project.endDate).toLocaleDateString()}</span>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create / Edit Project Modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="gradient-border-card w-full max-w-md p-6 shadow-xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-surface-900 text-lg font-semibold">
                  {editingId ? 'Edit Project' : 'New Project'}
                </h3>
                <button
                  onClick={() => setShowForm(false)}
                  className="text-surface-500 hover:bg-surface-200/70 hover:text-surface-600 rounded-lg p-1.5 transition-all"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-4">
                <FormField label="Name" htmlFor="project-name" required>
                  <Input
                    id="project-name"
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Q4 Product Launch"
                    autoFocus
                  />
                </FormField>
                <FormField label="Code" htmlFor="project-code">
                  <Input
                    id="project-code"
                    type="text"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder="e.g. Q4-2026"
                  />
                </FormField>
                <FormField label="Description" htmlFor="project-description">
                  <Textarea
                    id="project-description"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Optional description"
                    rows={3}
                    className="resize-none"
                  />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Start Date" htmlFor="project-start">
                    <Input
                      id="project-start"
                      type="date"
                      value={form.startDate}
                      onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    />
                  </FormField>
                  <FormField label="End Date" htmlFor="project-end">
                    <Input
                      id="project-end"
                      type="date"
                      value={form.endDate}
                      onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    />
                  </FormField>
                </div>
                {formError && (
                  <div className="bg-error/5 text-error flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {formError}
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                  <Button onClick={saveProject} disabled={saving}>
                    {saving ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-1 h-4 w-4" />
                    )}
                    {editingId ? 'Save' : 'Create'}
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Project Confirmation Modal */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="gradient-border-card w-full max-w-md p-6 shadow-xl"
            >
              <div className="mb-2 flex items-center gap-3">
                <div className="bg-error/10 text-error flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                  <Trash2 className="h-5 w-5" />
                </div>
                <h3 className="text-surface-900 text-lg font-semibold">Delete project</h3>
              </div>
              <p className="text-surface-500 text-sm">
                Delete <span className="text-surface-700 font-semibold">{deleteTarget.name}</span>?
                Its tasks will no longer be grouped under this project. This can&apos;t be undone.
              </p>
              {deleteError && (
                <div className="bg-error/5 text-error mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {deleteError}
                </div>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmDelete}
                  disabled={deleting}
                  className="bg-error hover:bg-error/90 text-white"
                >
                  {deleting ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1 h-4 w-4" />
                  )}
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
