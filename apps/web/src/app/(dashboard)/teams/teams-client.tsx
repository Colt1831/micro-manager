'use client';

import { useCallback, useEffect, useState, startTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state-display';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Building2,
  GitBranch,
  AlertCircle,
  Plus,
  X,
  Loader2,
  Check,
  Trash2,
  Pencil,
} from 'lucide-react';

export type Team = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  leadUserId: string | null;
  leadUserName?: string | null;
  departmentId: string | null;
  isActive: boolean;
  createdAt: string;
};
export type Department = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  headUserId: string | null;
  isActive: boolean;
};

export interface TeamsData {
  teams: Team[];
  departments: Department[];
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
} as const;
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } },
} as const;

interface TeamsClientProps {
  /** Server-rendered teams + departments; null means the server load failed and the client should fetch. */
  initialData: TeamsData | null;
}

export function TeamsClient({ initialData }: TeamsClientProps) {
  // When the server provided data, first paint already has real content — skip
  // the loading skeleton and the entrance fade. Computed once (prop is stable).
  const [hadInitialData] = useState(() => initialData !== null);
  const [teams, setTeams] = useState<Team[]>(initialData?.teams ?? []);
  const [departments, setDepartments] = useState<Department[]>(initialData?.departments ?? []);
  const [loading, setLoading] = useState(initialData === null);
  const [error, setError] = useState<string | null>(null);

  // Create-team modal state
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Create-department modal state
  const [showCreateDept, setShowCreateDept] = useState(false);
  const [deptForm, setDeptForm] = useState({ name: '', code: '', description: '' });
  const [creatingDept, setCreatingDept] = useState(false);
  const [createDeptError, setCreateDeptError] = useState<string | null>(null);

  // Delete-department confirmation state
  const [deptToDelete, setDeptToDelete] = useState<Department | null>(null);
  const [deletingDept, setDeletingDept] = useState(false);
  const [deleteDeptError, setDeleteDeptError] = useState<string | null>(null);

  // Rename (edit) modal state — shared by teams and departments.
  const [renameTarget, setRenameTarget] = useState<{
    kind: 'team' | 'department';
    id: string;
    label: string;
  } | null>(null);
  const [renameForm, setRenameForm] = useState({ name: '', description: '' });
  const [savingRename, setSavingRename] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/teams');
      if (!res.ok) throw new Error('Failed to fetch teams');
      const data = await res.json();
      setTeams(data.teams ?? []);
      setDepartments(data.departments ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load teams');
    } finally {
      setLoading(false);
    }
  }, []);

  // Only fetch on mount when the server did not provide data (fallback path).
  useEffect(() => {
    if (hadInitialData) return;
    startTransition(() => {
      fetchData();
    });
  }, [hadInitialData, fetchData]);

  const openCreate = () => {
    setForm({ name: '', code: '', description: '' });
    setCreateError(null);
    setShowCreate(true);
  };

  const createTeam = async () => {
    if (!form.name.trim()) {
      setCreateError('Team name is required');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const body: Record<string, unknown> = { name: form.name.trim() };
      if (form.code.trim()) body.code = form.code.trim();
      if (form.description.trim()) body.description = form.description.trim();

      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? 'Failed to create team');
      }
      const data = await res.json();
      setTeams((prev) => [data.team, ...prev]);
      setShowCreate(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create team');
    } finally {
      setCreating(false);
    }
  };

  const openCreateDept = () => {
    setDeptForm({ name: '', code: '', description: '' });
    setCreateDeptError(null);
    setShowCreateDept(true);
  };

  const createDepartment = async () => {
    if (!deptForm.name.trim()) {
      setCreateDeptError('Department name is required');
      return;
    }
    setCreatingDept(true);
    setCreateDeptError(null);
    try {
      const body: Record<string, unknown> = { name: deptForm.name.trim() };
      if (deptForm.code.trim()) body.code = deptForm.code.trim();
      if (deptForm.description.trim()) body.description = deptForm.description.trim();

      const res = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? 'Failed to create department');
      }
      const data = await res.json();
      setDepartments((prev) => [data.department, ...prev]);
      setShowCreateDept(false);
    } catch (err) {
      setCreateDeptError(err instanceof Error ? err.message : 'Failed to create department');
    } finally {
      setCreatingDept(false);
    }
  };

  const requestDeleteDept = (dept: Department) => {
    setDeleteDeptError(null);
    setDeptToDelete(dept);
  };

  const deleteDepartment = async () => {
    if (!deptToDelete) return;
    setDeletingDept(true);
    setDeleteDeptError(null);
    try {
      const res = await fetch(`/api/departments/${deptToDelete.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? 'Failed to delete department');
      }
      setDepartments((prev) => prev.filter((d) => d.id !== deptToDelete.id));
      setDeptToDelete(null);
    } catch (err) {
      setDeleteDeptError(err instanceof Error ? err.message : 'Failed to delete department');
    } finally {
      setDeletingDept(false);
    }
  };

  const openRenameTeam = (team: Team) => {
    setRenameTarget({ kind: 'team', id: team.id, label: team.name });
    setRenameForm({ name: team.name, description: team.description ?? '' });
    setRenameError(null);
  };

  const openRenameDept = (dept: Department) => {
    setRenameTarget({ kind: 'department', id: dept.id, label: dept.name });
    setRenameForm({ name: dept.name, description: dept.description ?? '' });
    setRenameError(null);
  };

  const saveRename = async () => {
    if (!renameTarget) return;
    if (!renameForm.name.trim()) {
      setRenameError('Name is required');
      return;
    }
    setSavingRename(true);
    setRenameError(null);
    try {
      const path = renameTarget.kind === 'team' ? 'teams' : 'departments';
      const body = {
        name: renameForm.name.trim(),
        description: renameForm.description.trim() || null,
      };
      const res = await fetch(`/api/${path}/${renameTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? 'Failed to save changes');
      }
      // PATCH returns { success: true }, so update the row from the sent values.
      if (renameTarget.kind === 'team') {
        setTeams((prev) =>
          prev.map((t) =>
            t.id === renameTarget.id ? { ...t, name: body.name, description: body.description } : t,
          ),
        );
      } else {
        setDepartments((prev) =>
          prev.map((d) =>
            d.id === renameTarget.id ? { ...d, name: body.name, description: body.description } : d,
          ),
        );
      }
      setRenameTarget(null);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSavingRename(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="space-y-1">
          <div className="shimmer h-8 w-32 rounded-lg" />
          <div className="shimmer mt-2 h-4 w-48 rounded-md" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="neon-card rounded-xl p-5">
              <div className="shimmer h-4 w-3/4 rounded-md" />
              <div className="shimmer mt-2 h-3 w-1/4 rounded-md" />
              <div className="shimmer mt-3 h-3 w-full rounded-md" />
              <div className="shimmer mt-4 h-3 w-1/2 rounded-md" />
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
            <h2 className="text-surface-900 text-lg font-semibold">Failed to load teams</h2>
            <p className="text-surface-500 mt-1 text-sm">{error}</p>
            <button
              onClick={() => {
                setLoading(true);
                setError(null);
                fetchData();
              }}
              className="bg-brand-500 hover:bg-brand-400 mt-3 rounded-xl px-4 py-2 text-sm font-medium text-white"
            >
              Retry
            </button>
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
          title="Teams"
          subtitle={`${teams.length} team${teams.length !== 1 ? 's' : ''} · ${departments.length} department${departments.length !== 1 ? 's' : ''}`}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={openCreateDept} className="rounded-xl">
                <Building2 className="mr-2 h-4 w-4" /> New Department
              </Button>
              <Button onClick={openCreate} className="btn-shine shadow-sm shadow-brand-500/20">
                <Plus className="mr-2 h-4 w-4" /> Create Team
              </Button>
            </div>
          }
        />
      </motion.div>

      {departments.length > 0 && (
        <motion.section variants={itemVariants}>
          <div className="mb-3 flex items-center gap-2">
            <Building2 className="text-surface-500 h-4 w-4" />
            <h2 className="text-surface-600 text-sm font-semibold">Departments</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {departments.map((dept) => (
              <motion.div
                key={dept.id}
                whileHover={{ y: -3 }}
                className="group relative"
              >
                <Link href={`/teams/departments/${dept.id}`} className="block">
                  <div className="neon-card relative overflow-hidden rounded-2xl p-5">
                    <div className={'absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-500 to-brand-400 opacity-60 group-hover:opacity-100 transition-opacity duration-300'} />
                    <h3 className="text-surface-900 mb-2 truncate pr-16 font-semibold">
                      {dept.name}
                    </h3>
                    {dept.code && (
                      <p className="text-surface-500 mb-2 font-mono text-xs">{dept.code}</p>
                    )}
                    {dept.description && (
                      <p className="text-surface-500 line-clamp-2 text-sm">{dept.description}</p>
                    )}
                    <div className="mt-3">
                      <Badge variant={dept.isActive ? 'success' : 'default'} size="sm">
                        {dept.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </div>
                </Link>
                <div className="absolute right-3 top-3 z-10 flex items-center gap-1 opacity-0 transition-all focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => openRenameDept(dept)}
                    aria-label={`Rename ${dept.name}`}
                    className="text-surface-400 hover:bg-surface-200/70 hover:text-surface-700 rounded-lg p-1.5 transition-all focus:outline-none"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => requestDeleteDept(dept)}
                    aria-label={`Delete ${dept.name}`}
                    className="text-surface-400 hover:bg-error/10 hover:text-error rounded-lg p-1.5 transition-all focus:outline-none"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.section>
      )}

      {teams.length > 0 && (
        <motion.section variants={itemVariants}>
          <div className="mb-3 flex items-center gap-2">
            <Users className="text-surface-500 h-4 w-4" />
            <h2 className="text-surface-600 text-sm font-semibold">Teams</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {teams.map((team, i) => (
              <motion.div
                key={team.id}
                variants={itemVariants}
                custom={i}
                whileHover={{ y: -3 }}
                className="group relative"
              >
                <Link href={`/teams/${team.id}`} className="block">
                  <div className="neon-card relative overflow-hidden rounded-2xl p-5">
                    <div className={'absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-500 to-brand-400 opacity-60 group-hover:opacity-100 transition-opacity duration-300'} />
                    <h3 className="text-surface-900 mb-2 truncate pr-9 font-semibold">{team.name}</h3>
                    {team.code && (
                      <p className="text-surface-500 mb-1 font-mono text-xs">{team.code}</p>
                    )}
                    {team.description && (
                      <p className="text-surface-500 mb-2 line-clamp-2 text-sm">{team.description}</p>
                    )}
                    <div className="text-surface-500 flex items-center gap-3 text-xs">
                      {team.leadUserId && <span>Lead: {team.leadUserName ?? 'Unknown'}</span>}
                      {team.departmentId && (
                        <span>
                          Dept:{' '}
                          {departments.find((d) => d.id === team.departmentId)?.name ?? 'Unknown'}
                        </span>
                      )}
                    </div>
                    <div className="mt-3">
                      <Badge variant={team.isActive ? 'success' : 'default'} size="sm">
                        {team.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => openRenameTeam(team)}
                  aria-label={`Rename ${team.name}`}
                  className="text-surface-400 hover:bg-surface-200/70 hover:text-surface-700 absolute right-3 top-3 z-10 rounded-lg p-1.5 opacity-0 transition-all focus:opacity-100 focus:outline-none group-hover:opacity-100"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </motion.div>
            ))}
          </div>
        </motion.section>
      )}

      {teams.length === 0 && departments.length === 0 && (
        <motion.div variants={itemVariants}>
          <EmptyState
            icon={<GitBranch className="text-surface-400 h-16 w-16" />}
            title="No teams or departments"
            message="Teams and departments will appear here once they are created."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="outline" onClick={openCreateDept} className="rounded-xl">
                  <Building2 className="mr-2 h-4 w-4" />
                  New Department
                </Button>
                <Button onClick={openCreate} className="rounded-xl">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Team
                </Button>
              </div>
            }
          />
        </motion.div>
      )}

      {/* Create Team Modal */}
      <AnimatePresence>
        {showCreate && (
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
              className="gradient-border-card w-full max-w-md p-6"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-surface-900 text-lg font-semibold">Create Team</h3>
                <button
                  onClick={() => setShowCreate(false)}
                  className="text-surface-500 hover:bg-surface-200 rounded-lg p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Name <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Engineering"
                    autoFocus
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Code
                  </label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder="e.g. ENG"
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Description
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Optional description"
                    rows={3}
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full resize-none rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>
                {createError && (
                  <div className="bg-error/5 text-error flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {createError}
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowCreate(false)}
                    className="rounded-xl"
                  >
                    Cancel
                  </Button>
                  <Button onClick={createTeam} disabled={creating} className="rounded-xl">
                    {creating ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-1 h-4 w-4" />
                    )}
                    Create
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Department Modal */}
      <AnimatePresence>
        {showCreateDept && (
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
              className="gradient-border-card w-full max-w-md p-6"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-surface-900 text-lg font-semibold">Create Department</h3>
                <button
                  onClick={() => setShowCreateDept(false)}
                  className="text-surface-500 hover:bg-surface-200 rounded-lg p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Name <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={deptForm.name}
                    onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                    placeholder="e.g. Marketing"
                    autoFocus
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Code
                  </label>
                  <input
                    type="text"
                    value={deptForm.code}
                    onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value })}
                    placeholder="e.g. MKT"
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Description
                  </label>
                  <textarea
                    value={deptForm.description}
                    onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })}
                    placeholder="Optional description"
                    rows={3}
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full resize-none rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>
                {createDeptError && (
                  <div className="bg-error/5 text-error flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {createDeptError}
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowCreateDept(false)}
                    className="rounded-xl"
                  >
                    Cancel
                  </Button>
                  <Button onClick={createDepartment} disabled={creatingDept} className="rounded-xl">
                    {creatingDept ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-1 h-4 w-4" />
                    )}
                    Create
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Department Confirmation */}
      <AnimatePresence>
        {deptToDelete && (
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
              className="gradient-border-card w-full max-w-md p-6"
            >
              <div className="mb-2 flex items-center gap-3">
                <div className="bg-error/10 text-error flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                  <Trash2 className="h-5 w-5" />
                </div>
                <h3 className="text-surface-900 text-lg font-semibold">Delete department</h3>
              </div>
              <p className="text-surface-500 mt-2 text-sm">
                Are you sure you want to delete{' '}
                <span className="text-surface-900 font-semibold">{deptToDelete.name}</span>? Any teams
                in this department will become unassigned. This can&rsquo;t be undone.
              </p>
              {deleteDeptError && (
                <div className="bg-error/5 text-error mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {deleteDeptError}
                </div>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setDeptToDelete(null)}
                  className="rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={deleteDepartment}
                  disabled={deletingDept}
                  className="rounded-xl"
                >
                  {deletingDept ? (
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

      {/* Rename Team / Department Modal */}
      <AnimatePresence>
        {renameTarget && (
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
              className="gradient-border-card w-full max-w-md p-6"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-surface-900 flex items-center gap-2 text-lg font-semibold">
                  <Pencil className="h-4 w-4" />
                  {renameTarget.kind === 'team' ? 'Rename team' : 'Rename department'}
                </h3>
                <button
                  onClick={() => setRenameTarget(null)}
                  className="text-surface-500 hover:bg-surface-200 rounded-lg p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Name <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    aria-label="Name"
                    value={renameForm.name}
                    onChange={(e) => setRenameForm({ ...renameForm, name: e.target.value })}
                    autoFocus
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Description
                  </label>
                  <textarea
                    value={renameForm.description}
                    onChange={(e) => setRenameForm({ ...renameForm, description: e.target.value })}
                    placeholder="Optional description"
                    rows={3}
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full resize-none rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>
                {renameError && (
                  <div className="bg-error/5 text-error flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {renameError}
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setRenameTarget(null)}
                    className="rounded-xl"
                  >
                    Cancel
                  </Button>
                  <Button onClick={saveRename} disabled={savingRename} className="rounded-xl">
                    {savingRename ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-1 h-4 w-4" />
                    )}
                    Save
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
