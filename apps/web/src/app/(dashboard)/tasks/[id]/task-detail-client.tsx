'use client';
import { useEffect, useState, startTransition, type ElementType, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { StatusChip, PriorityChip } from '@/components/ui/chip';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RichTextEditor, RichTextViewer } from '@/components/tasks/rich-text-editor';
import { TaskChecklist } from '@/components/tasks/task-checklist';
import { TaskActivityFeed } from '@/components/tasks/task-activity-feed';
import { TaskWatcherButton } from '@/components/tasks/task-watcher-button';
import { TaskMentionText } from '@/components/tasks/task-hover-card';
import { EmptyState } from '@/components/ui/state-display';
import { useTaskStore, type Task, type Comment, type Attachment, type TimeEntry } from '@/stores/task-store';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Loader2,
  ArrowLeft,
  MessageSquare,
  Paperclip,
  Trash2,
  Send,
  Calendar,
  User,
  Clock,
  Tag,
  AlertCircle,
  FileText,
  Upload,
  X,
  Edit3,
  Check,
  Play,
  StopCircle,
  Timer,
  History,
  Copy,
  SlidersHorizontal,
} from 'lucide-react';
import { TaskDependencySection } from '@/components/tasks/task-dependency-section';

// ─── Constants ──────────────────────────────────────────────

const statusOptions = [
  'draft',
  'open',
  'in_progress',
  'blocked',
  'under_review',
  'on_hold',
  'completed',
  'closed',
  'reopened',
  'cancelled',
  'archived',
];

const priorityLabel: Record<string, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
  critical: 'Critical',
};

const priorityOptions = ['none', 'low', 'medium', 'high', 'urgent', 'critical'];

// ─── Helpers ────────────────────────────────────────────────

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? '').charAt(0).toUpperCase();
  const first = (parts[0] ?? '').charAt(0).toUpperCase();
  const last = (parts[parts.length - 1] ?? '').charAt(0).toUpperCase();
  return first + last;
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.25, staggerChildren: 0.05 } },
} as const;

// NOTE: `hidden` intentionally does NOT set opacity to 0. This page mounts its
// motion tree late (after the Zustand store resolves) and some sections mount
// progressively as their data loads — under those conditions framer-motion's
// parent→child "visible" propagation can miss a child, leaving it stuck at its
// hidden variant. A slide-only entrance means that even if a section never
// receives the "visible" state it stays fully visible (just un-slid) rather than
// rendering the whole page blank. The container above still handles the fade-in.
const itemVariants = {
  hidden: { y: 16 },
  visible: { y: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } },
} as const;

// ─── Section primitives (presentational, no hooks/motion) ───

// The shared surface for every detail section. Soft depth + a hairline inset
// ring lift the flat cards without changing their layout or the motion tree.
const sectionCardClass =
  'border-surface-300/20 bg-surface-100/70 ring-1 ring-inset ring-white/[0.015] shadow-lg shadow-black/5 overflow-hidden rounded-2xl border transition-colors';

// A uniform section header: an electric-violet icon chip + title (+ optional
// count and a right-aligned action). Purely presentational so it can live at
// module scope and be reused across every card.
function SectionHeading({
  icon: Icon,
  title,
  count,
  action,
}: {
  icon: ElementType;
  title: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="border-surface-300/10 flex items-center justify-between gap-3 border-b px-5 py-4">
      <h2 className="text-surface-900 flex items-center gap-2.5 text-base font-semibold">
        <span className="from-brand-500/15 to-brand-400/5 text-brand-400 ring-brand-500/10 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ring-1 ring-inset">
          <Icon className="h-4 w-4" />
        </span>
        {title}
        {count !== undefined && (
          <span className="text-surface-500 ml-0.5 text-xs font-normal">({count})</span>
        )}
      </h2>
      {action}
    </div>
  );
}

// ─── Page Component ─────────────────────────────────────────

interface TaskDetailClientProps {
  /** Server-rendered task; null means the server load failed/not-found and the client should fetch. */
  initialTask: Task | null;
  /** Server-rendered comments (empty when unavailable). */
  initialComments: Comment[];
  /** Server-rendered attachments (empty when unavailable). */
  initialAttachments: Attachment[];
  /** Server-rendered time entries (empty when unavailable). */
  initialTimeEntries: TimeEntry[];
}

export function TaskDetailClient({
  initialTask,
  initialComments,
  initialAttachments,
  initialTimeEntries,
}: TaskDetailClientProps) {
  const params = useParams();
  const taskId = params.id as string;

  // When the server provided the task, first paint already has real content.
  const [hadInitialData] = useState(() => initialTask !== null);

  // Zustand store
  const storeCurrentTask = useTaskStore((s) => s.currentTask);
  const storeComments = useTaskStore((s) => s.comments);
  const storeAttachments = useTaskStore((s) => s.attachments);
  const storeTimeEntries = useTaskStore((s) => s.timeEntries);

  const storeError = useTaskStore((s) => s.detailError);
  const fetchTaskDetail = useTaskStore((s) => s.fetchTaskDetail);
  const updateCurrentTask = useTaskStore((s) => s.updateCurrentTask);
  const addCommentAction = useTaskStore((s) => s.addComment);
  const removeCommentAction = useTaskStore((s) => s.removeComment);
  const addAttachment = useTaskStore((s) => s.addAttachment);
  const removeAttachment = useTaskStore((s) => s.removeAttachment);
  const removeTimeEntryAction = useTaskStore((s) => s.removeTimeEntry);

  const setTimeEntries = useTaskStore((s) => s.setTimeEntries);

  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(initialTask === null);
  const [error, setError] = useState<string | null>(null);

  // Comment form
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  // Description editing
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);

  // Time tracking
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualMinutes, setManualMinutes] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  // Use store data as source of truth once it has loaded; until then fall back
  // to the server-seeded props so the first paint (SSR + hydration) shows real
  // content instead of waiting on the client fetch. The store keeps driving all
  // mutations (add/remove comment, attachment, time entry, field edits).
  const storeLoaded = storeCurrentTask !== null;
  const task = storeLoaded ? storeCurrentTask : initialTask;
  const comments = storeLoaded ? storeComments : initialComments;
  const attachments = storeLoaded ? storeAttachments : initialAttachments;
  const timeEntries = storeLoaded ? storeTimeEntries : initialTimeEntries;


  const [elapsed, setElapsed] = useState('00:00:00');

  const runningTimer = timeEntries.find((e) => !e.endTime) ?? null;

  // Toast
  const { toast } = useToast();

  // Duplicate task
  const [duplicating, setDuplicating] = useState(false);

  // Status / Priority editing
  const [updating, setUpdating] = useState<string | null>(null);

  // ── Fetch task data via Zustand store ─────────────────────

  useEffect(() => {
    // NOTE: do NOT wrap in startTransition — the detail page renders `null` until
    // the task loads, so the container <motion.div> mounts late; mounting it inside
    // a transition made framer-motion skip the enter animation and leave the whole
    // page stuck at its `initial="hidden"` (opacity 0) state → blank page.
    fetchTaskDetail(taskId).finally(() => setLoading(false));
  }, [taskId, fetchTaskDetail]);

  // Derive notFound from store error
  // needed to sync store errors into local state
  useEffect(() => {
    if (storeError === 'Task not found') {
      startTransition(() => setNotFound(true));
    }
    if (storeError && storeError !== 'Task not found') {
      startTransition(() => setError(storeError));
    }
  }, [storeError]);

  // ── Status / Priority update ────────────────────────────

  const updateField = async (field: string, value: string) => {
    setUpdating(field);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error('Failed to update');
      const data = await res.json();
      updateCurrentTask(data.task);
    } catch (err) {
      console.error(`Failed to update ${field}:`, err);
    } finally {
      setUpdating(null);
    }
  };

  // ── Submit comment ──────────────────────────────────────

  const submitComment = async () => {
    if (!commentText.trim()) return;
    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: commentText.trim() }),
      });
      if (!res.ok) throw new Error('Failed to post comment');
      const data = await res.json();
      addCommentAction(data.comment);
      setCommentText('');
    } catch (err) {
      console.error('Failed to submit comment:', err);
    } finally {
      setSubmittingComment(false);
    }
  };

  // ── Submit attachment ───────────────────────────────────

  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`/api/tasks/${taskId}/attachments`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? 'Failed to upload attachment');
      }
      const data = await res.json();
      addAttachment(data.attachment);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload file');
    }

    // Reset input
    e.target.value = '';
  };

  const deleteAttachment = async (attachmentId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/attachments?attachmentId=${attachmentId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete attachment');
      removeAttachment(attachmentId);
    } catch (err) {
      console.error('Failed to delete attachment:', err);
    }
  };

  // ── Timer interval ───────────────────────────────────

  useEffect(() => {
    if (!runningTimer) return;
    const secondsSince = (startTime: string): number =>
      Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
    const interval = setInterval(() => {
      setElapsed(formatElapsed(secondsSince(runningTimer.startTime)));
    }, 1000);
    return () => clearInterval(interval);
  }, [runningTimer]);

  // ── Scroll to a #comment-<id> deep link once comments render ──
  // Comments load async, so the browser's native hash scroll fires before the
  // target exists. Re-run when the comment list changes and scroll it in.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith('#comment-')) return;
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [comments]);

  // ── Refetch time entries helper ───────────────────────

  const refetchTimeEntries = async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/time-entries`);
      if (res.ok) {
        const data = await res.json();
        setTimeEntries(data.entries ?? []);
      }
    } catch {}
  };

  // ── Start timer ───────────────────────────────────────

  const startTimer = async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/time-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryType: 'timer' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? 'Failed to start timer');
      }
      refetchTimeEntries();
    } catch (err) {
      console.error('Failed to start timer:', err);
    }
  };

  // ── Stop timer ────────────────────────────────────────

  const stopTimer = async (entryId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/time-entries?entryId=${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Failed to stop timer');
      refetchTimeEntries();
    } catch (err) {
      console.error('Failed to stop timer:', err);
    }
  };

  // ── Delete time entry ─────────────────────────────────

  const deleteTimeEntry = async (entryId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/time-entries?entryId=${entryId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete time entry');
      removeTimeEntryAction(entryId);
    } catch (err) {
      console.error('Failed to delete time entry:', err);
    }
  };

  // ── Submit manual entry ───────────────────────────────

  const submitManualEntry = async () => {
    const minutes = parseInt(manualMinutes, 10);
    if (isNaN(minutes) || minutes < 1) return;
    setManualSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/time-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryType: 'manual',
          durationMinutes: minutes,
          description: manualDescription.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to log time');
      refetchTimeEntries();
      setShowManualForm(false);
      setManualMinutes('');
      setManualDescription('');
    } catch (err) {
      console.error('Failed to log time:', err);
    } finally {
      setManualSubmitting(false);
    }
  };


  // ── Save description ──────────────────────────────────

  const saveDescription = async () => {
    if (!task) return;
    setSavingDescription(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description:
            descriptionDraft === '<p></p>' || !descriptionDraft.trim() ? null : descriptionDraft,
        }),
      });
      if (!res.ok) throw new Error('Failed to save description');
      const data = await res.json();
      updateCurrentTask(data.task);
      setEditingDescription(false);
    } catch (err) {
      console.error('Failed to save description:', err);
    } finally {
      setSavingDescription(false);
    }
  };

  // ── Delete comment ──────────────────────────────────────

  const deleteComment = async (commentId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments?commentId=${commentId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete comment');
      removeCommentAction(commentId);
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  };

  // ── Render states ───────────────────────────────────────

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="max-w-4xl space-y-6"
      >
        <div className="flex items-center gap-3">
          <div className="shimmer h-9 w-9 rounded-xl" />
          <div className="space-y-2">
            <div className="shimmer h-5 w-24 rounded-lg" />
            <div className="shimmer h-7 w-72 rounded-lg" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="space-y-6 lg:col-span-2"
          >
            <div className="shimmer h-48 rounded-xl" />
            <div className="shimmer h-64 rounded-xl" />
            <div className="shimmer h-40 rounded-xl" />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-6"
          >
            <div className="shimmer h-72 rounded-xl" />
            <div className="shimmer h-48 rounded-xl" />
            <div className="shimmer h-48 rounded-xl" />
          </motion.div>
        </div>
      </motion.div>
    );
  }

  if (notFound) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-20"
      >
        <AlertCircle className="text-surface-500 mb-4 h-12 w-12" />
        <h2 className="text-surface-300 text-xl font-semibold">Task not found</h2>
        <p className="text-surface-500 mt-1 text-sm">
          This task may have been deleted or you don&apos;t have access.
        </p>
        <Button
          variant="outline"
          className="mt-4 rounded-xl"
          onClick={() => (window.location.href = '/tasks')}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to tasks
        </Button>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-20"
      >
        <AlertCircle className="text-error mb-4 h-12 w-12" />
        <h2 className="text-surface-300 text-xl font-semibold">Failed to load task</h2>
        <p className="text-error mt-1 text-sm">{error}</p>
        <Button
          variant="outline"
          className="mt-4 rounded-xl"
          onClick={() => {
            setLoading(true);
            setError(null);
            fetchTaskDetail(taskId);
          }}
        >
          Try again
        </Button>
      </motion.div>
    );
  }

  if (!task) return null;

  // ── Main render ─────────────────────────────────────────

  return (
    <motion.div
      variants={containerVariants}
      initial={hadInitialData ? false : 'hidden'}
      animate="visible"
      className="max-w-6xl space-y-6"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => window.history.back()}
            aria-label="Go back"
            className="border-surface-300/20 bg-surface-100/80 text-surface-500 hover:bg-surface-200/70 hover:text-surface-600 mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-all"
          >
            <ArrowLeft className="h-4 w-4" />
          </motion.button>
          <div className="min-w-0">
            <div className="text-surface-500 mb-1.5 flex items-center gap-1.5 text-xs font-medium">
              <Link href="/tasks" className="hover:text-surface-700 transition-colors">
                Tasks
              </Link>
              <span className="text-surface-600">/</span>
              <span className="font-mono">{task.taskIdDisplay}</span>
            </div>
            <h1 className="font-display text-surface-900 text-2xl font-bold tracking-tight sm:text-[28px]">
              {task.title}
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <StatusChip status={task.status} />
              <PriorityChip priority={task.priority} />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!task || duplicating) return;
              setDuplicating(true);
              try {
                const res = await fetch('/api/tasks', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    title: `${task.title} (copy)`,
                    description: task.description,
                    priority: task.priority,
                    projectId: task.projectId,
                    assignedTo: task.assignedTo,
                  }),
                });
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}));
                  throw new Error(data.error?.message ?? 'Failed to duplicate task');
                }
                const data = await res.json();
                window.location.href = `/tasks/${data.task.id}`;
              } catch (err) {
                toast({
                  title: 'Failed to duplicate task',
                  description: err instanceof Error ? err.message : 'An unexpected error occurred',
                  variant: 'error',
                });
              } finally {
                setDuplicating(false);
              }
            }}
            disabled={duplicating}
            className="btn-shine h-8 rounded-xl text-xs"
            title="Duplicate this task"
          >
            {duplicating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Copy className="mr-1 h-3.5 w-3.5" />
            )}
            Duplicate
          </Button>
          <TaskWatcherButton taskId={task.id} />
        </div>
      </motion.div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Description */}
          <motion.div
            variants={itemVariants}
            className={sectionCardClass}
          >
            <SectionHeading
              icon={FileText}
              title="Description"
              action={
                !editingDescription ? (
                  <button
                    onClick={() => {
                      setDescriptionDraft(task.description ?? '');
                      setEditingDescription(true);
                    }}
                    className="text-surface-500 hover:bg-surface-200 hover:text-surface-300 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Edit
                  </button>
                ) : undefined
              }
            />
            <div className="px-5 py-4">
              {editingDescription ? (
                <div className="space-y-3">
                  <RichTextEditor
                    content={descriptionDraft}
                    onChange={setDescriptionDraft}
                    placeholder="Describe the task in detail..."
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingDescription(false);
                        setDescriptionDraft(task.description ?? '');
                      }}
                      disabled={savingDescription}
                      className="rounded-xl"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={saveDescription}
                      disabled={savingDescription}
                      className="rounded-xl"
                    >
                      {savingDescription ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="mr-1 h-3.5 w-3.5" />
                      )}
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <RichTextViewer content={task.description} />
              )}
            </div>
          </motion.div>
          {/* Checklist */}
          <motion.div
            variants={itemVariants}
            className={sectionCardClass}
          >
            <SectionHeading icon={Check} title="Checklist" />
            <div className="px-5 py-4">
              <TaskChecklist taskId={task.id} taskStatus={task.status} />
            </div>
          </motion.div>
          {/* Comments */}
          <motion.div
            variants={itemVariants}
            className={sectionCardClass}
          >
            <SectionHeading icon={MessageSquare} title="Comments" count={comments.length} />
            <div className="space-y-4 px-5 py-4">
              {/* Comment input */}
              <div className="flex gap-3">
                <div className="from-brand-400 to-brand-600 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-medium text-white">
                  {getInitials('You')}
                </div>
                <div className="flex-1 space-y-2">
                  <Textarea
                    placeholder="Write a comment..."
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    className="min-h-[60px] rounded-xl"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !submittingComment) {
                        e.preventDefault();
                        submitComment();
                      }
                    }}
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={submitComment}
                      disabled={!commentText.trim() || submittingComment}
                      className="rounded-xl"
                    >
                      {submittingComment ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Send className="mr-1 h-3 w-3" />
                      )}
                      Send
                    </Button>
                  </div>
                </div>
              </div>

              {/* Comment list */}
              {comments.length === 0 ? (
                <EmptyState
                  variant="compact"
                  animated={false}
                  icon={<MessageSquare className="h-8 w-8" />}
                  title="No comments yet"
                  message="Start the conversation."
                  className="border-0 bg-transparent py-6"
                />
              ) : (
                <div className="space-y-4 pt-2">
                  <AnimatePresence initial={false}>
                    {comments.map((comment, idx) => (
                      <motion.div
                        key={comment.id}
                        id={`comment-${comment.id}`}
                        initial={{ opacity: 0, y: -10, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{
                          delay: idx * 0.03,
                          type: 'spring',
                          stiffness: 200,
                          damping: 20,
                        }}
                        className="hover:bg-surface-200/30 group -mx-2 flex gap-3 rounded-xl px-2 py-2 transition-all duration-200"
                      >
                        <motion.div
                          whileHover={{ scale: 1.05 }}
                          className="from-brand-400 to-brand-600 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-medium text-white"
                        >
                          {getInitials(comment.user?.name)}
                        </motion.div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-surface-900 text-sm font-medium">
                              {comment.user?.name ?? 'Unknown user'}
                            </span>
                            <span className="text-surface-500 text-xs">
                              {new Date(comment.createdAt).toLocaleString()}
                            </span>
                            {comment.isEdited && (
                              <motion.span
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="text-surface-500 text-xs"
                              >
                                (edited)
                              </motion.span>
                            )}
                          </div>
                          <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-surface-700 mt-1 whitespace-pre-wrap text-sm"
                          >
                            <TaskMentionText text={comment.content} />
                          </motion.p>
                          <div className="mt-1 flex items-center gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                            <motion.button
                              whileHover={{ scale: 1.05 }}
                              onClick={() => deleteComment(comment.id)}
                              className="text-surface-500 hover:text-error text-xs transition-colors"
                            >
                              Delete
                            </motion.button>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </motion.div>{' '}
          {/* Activity Feed */}
          <motion.div
            variants={itemVariants}
            className={sectionCardClass}
          >
            <SectionHeading icon={History} title="Activity" />
            <div className="px-5 py-4">
              <TaskActivityFeed taskId={task.id} />
            </div>
          </motion.div>
          {/* Attachments */}
          <motion.div
            variants={itemVariants}
            className={sectionCardClass}
          >
            <SectionHeading icon={Paperclip} title="Attachments" count={attachments.length} />
            <div className="space-y-4 px-5 py-4">
              {/* Upload button */}
              <AnimatePresence>
                {uploadError && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="text-error bg-error/5 rounded-xl px-3 py-2 text-sm"
                  >
                    {uploadError}
                  </motion.p>
                )}
              </AnimatePresence>
              <div>
                <motion.label
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  className="border-surface-400/30 text-surface-500 hover:border-brand-500/40 hover:text-brand-500 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-4 py-2 text-sm transition-all duration-200"
                >
                  <Upload className="h-4 w-4" />
                  Upload file
                  <input type="file" className="hidden" onChange={handleFileUpload} />
                </motion.label>
              </div>

              {/* Attachment list */}
              {attachments.length === 0 ? (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-surface-500 py-2 text-center text-sm"
                >
                  No attachments yet.
                </motion.p>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence initial={false}>
                    {attachments.map((att) => (
                      <motion.div
                        key={att.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        className="border-surface-300/10 bg-surface-200/30 hover:bg-surface-200/50 hover:border-surface-400/20 group flex items-center justify-between rounded-xl border px-3 py-2 transition-all"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <FileText className="text-surface-500 h-4 w-4 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-surface-900 group-hover:text-brand-600 truncate text-sm font-medium transition-colors">
                              {att.fileName}
                            </p>
                            <p className="text-surface-500 text-xs">
                              {formatFileSize(att.fileSize)} · {att.user?.name ?? 'Unknown'}
                            </p>
                          </div>
                        </div>
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          onClick={() => deleteAttachment(att.id)}
                          className="text-surface-500 hover:text-error hover:bg-error/5 shrink-0 rounded-lg p-1 transition-all duration-200"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </motion.button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </motion.div>
        </div>

        {/* Sidebar - Task Properties */}
        <div className="space-y-6">
          {/* Properties card */}
          <motion.div
            variants={itemVariants}
            className={sectionCardClass}
          >
            <SectionHeading icon={SlidersHorizontal} title="Properties" />
            <div className="space-y-4 px-5 py-4">
              {/* Status */}
              <div>
                <label className="text-surface-500 mb-1 block text-xs font-medium">Status</label>
                <select
                  aria-label="Status"
                  value={task.status}
                  onChange={(e) => updateField('status', e.target.value)}
                  disabled={updating === 'status'}
                  className="border-surface-300/20 bg-surface-200/50 hover:border-surface-400/30 focus:border-brand-500 focus:ring-brand-500/20 h-9 w-full rounded-xl border px-3 text-sm transition-all focus:outline-none focus:ring-2 disabled:opacity-50"
                >
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>

              {/* Priority */}
              <div>
                <label className="text-surface-500 mb-1 block text-xs font-medium">Priority</label>
                <select
                  aria-label="Priority"
                  value={task.priority}
                  onChange={(e) => updateField('priority', e.target.value)}
                  disabled={updating === 'priority'}
                  className="border-surface-300/20 bg-surface-200/50 hover:border-surface-400/30 focus:border-brand-500 focus:ring-brand-500/20 h-9 w-full rounded-xl border px-3 text-sm transition-all focus:outline-none focus:ring-2 disabled:opacity-50"
                >
                  {priorityOptions.map((p) => (
                    <option key={p} value={p}>
                      {priorityLabel[p]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Due Date */}
              <div>
                <label className="text-surface-500 mb-1 block text-xs font-medium">Due Date</label>
                <div className="text-surface-300 flex items-center gap-2 text-sm">
                  <Calendar className="text-surface-500 h-3.5 w-3.5" />
                  {task.dueDate ? (
                    new Date(task.dueDate).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })
                  ) : (
                    <span className="text-surface-500">Not set</span>
                  )}
                </div>
              </div>

              {/* Assignee */}
              <div>
                <label className="text-surface-500 mb-1 block text-xs font-medium">Assignee</label>
                <div className="text-surface-300 flex items-center gap-2 text-sm">
                  <User className="text-surface-500 h-3.5 w-3.5" />
                  {task.assignedTo ? (
                    <span className="font-mono text-xs">{task.assignedTo.substring(0, 12)}...</span>
                  ) : (
                    <span className="text-surface-500">Unassigned</span>
                  )}
                </div>
              </div>

              {/* Category */}
              {task.category && (
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-medium">
                    Category
                  </label>
                  <div className="text-surface-300 flex items-center gap-2 text-sm">
                    <Tag className="text-surface-500 h-3.5 w-3.5" />
                    {task.category}
                  </div>
                </div>
              )}

              {/* Labels */}
              {task.labels && task.labels.length > 0 && (
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-medium">Labels</label>
                  <div className="flex flex-wrap gap-1">
                    {task.labels.map((label, i) => (
                      <span
                        key={i}
                        className="bg-brand-500/10 text-brand-400 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Estimated Hours */}
              {task.estimatedHours && (
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-medium">
                    Estimated Hours
                  </label>
                  <div className="text-surface-300 flex items-center gap-2 text-sm">
                    <Clock className="text-surface-500 h-3.5 w-3.5" />
                    {task.estimatedHours}h
                    {task.actualHours && (
                      <span className="text-surface-500">({task.actualHours}h logged)</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* Dependencies */}
          <TaskDependencySection taskId={taskId} variants={itemVariants} />

          {/* Time Tracking */}
          <motion.div
            variants={itemVariants}
            className={sectionCardClass}
          >
            <SectionHeading icon={Timer} title="Time Tracking" />
            <div className="space-y-4 px-5 py-4">
              {/* Current timer */}
              {runningTimer ? (
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="border-brand-500/20 bg-brand-500/5 rounded-xl border p-4 text-center"
                >
                  <motion.p
                    key={elapsed}
                    initial={{ scale: 1.05 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                    className="text-brand-400 font-mono text-2xl font-bold tabular-nums"
                  >
                    {elapsed}
                  </motion.p>
                  <p className="text-surface-500 mt-1 text-xs">
                    Started {new Date(runningTimer.startTime).toLocaleTimeString()}
                  </p>
                  <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-error/30 text-error hover:bg-error/5 mt-3 rounded-xl"
                      onClick={() => stopTimer(runningTimer.id)}
                    >
                      <StopCircle className="mr-1 h-4 w-4" />
                      Stop Timer
                    </Button>
                  </motion.div>
                </motion.div>
              ) : (
                <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                  <Button
                    variant="outline"
                    className="border-brand-500/30 text-brand-400 hover:bg-brand-500/5 w-full rounded-xl"
                    onClick={startTimer}
                  >
                    <Play className="mr-1.5 h-4 w-4" />
                    Start Timer
                  </Button>
                </motion.div>
              )}

              {/* Manual log toggle */}
              {!showManualForm && !runningTimer && (
                <motion.button
                  whileHover={{ x: 4 }}
                  onClick={() => setShowManualForm(true)}
                  className="text-surface-500 hover:text-surface-300 w-full py-1 text-xs transition-colors"
                >
                  + Log time manually
                </motion.button>
              )}

              {/* Manual log form */}
              <AnimatePresence>
                {showManualForm && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 25 }}
                    className="border-surface-300/20 space-y-2 overflow-hidden border-t pt-1"
                  >
                    <p className="text-surface-500 text-xs font-medium">Log time manually</p>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        placeholder="Minutes"
                        value={manualMinutes}
                        onChange={(e) => setManualMinutes(e.target.value)}
                        className="border-surface-300/30 bg-surface-200 placeholder:text-surface-500 focus:border-brand-500 focus:ring-brand-500/20 w-24 rounded-xl border px-2.5 py-1.5 text-sm transition-all duration-200 focus:outline-none focus:ring-2"
                      />
                      <input
                        type="text"
                        placeholder="Description (optional)"
                        value={manualDescription}
                        onChange={(e) => setManualDescription(e.target.value)}
                        className="border-surface-300/30 bg-surface-200 placeholder:text-surface-500 focus:border-brand-500 focus:ring-brand-500/20 flex-1 rounded-xl border px-2.5 py-1.5 text-sm transition-all duration-200 focus:outline-none focus:ring-2"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={submitManualEntry}
                        disabled={!manualMinutes || manualSubmitting}
                        className="rounded-xl"
                      >
                        {manualSubmitting ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="mr-1 h-3 w-3" />
                        )}
                        Log
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setShowManualForm(false);
                          setManualMinutes('');
                          setManualDescription('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Progress bar — total tracked vs estimated */}
              {(() => {
                const totalMinutes = timeEntries.reduce(
                  (sum, e) => sum + (e.durationMinutes ?? 0),
                  0,
                );
                const totalHours = (totalMinutes / 60).toFixed(1);
                const estimated = task?.estimatedHours ? parseFloat(task.estimatedHours) : 0;
                const pct =
                  estimated > 0 ? Math.min((totalMinutes / 60 / estimated) * 100, 100) : 0;
                return (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="pt-1"
                  >
                    <div className="text-surface-500 mb-1.5 flex items-center justify-between text-[10px]">
                      <span>{totalHours}h logged</span>
                      {estimated > 0 && <span>{estimated}h estimated</span>}
                    </div>
                    {estimated > 0 && (
                      <div className="bg-surface-300/30 h-1 w-full overflow-hidden rounded-full">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.6, ease: 'easeOut' }}
                          className={cn(
                            'h-full rounded-full transition-colors',
                            pct >= 100 ? 'bg-error' : pct >= 75 ? 'bg-amber-500' : 'bg-brand-500',
                          )}
                        />
                      </div>
                    )}
                  </motion.div>
                );
              })()}

              {/* Recent entries */}
              {timeEntries.length > 0 && (
                <div className="border-surface-300/20 border-t pt-2">
                  <p className="text-surface-500 mb-2 flex items-center gap-1.5 text-xs font-medium">
                    <Timer className="h-3 w-3" />
                    Recent entries{' '}
                    <span className="text-surface-400 font-normal">({timeEntries.length})</span>
                  </p>
                  <div className="scrollbar-thin max-h-48 space-y-1.5 overflow-y-auto">
                    <AnimatePresence initial={false}>
                      {timeEntries.slice(0, 10).map((entry, idx) => (
                        <motion.div
                          key={entry.id}
                          initial={{ opacity: 0, x: -8, scale: 0.97 }}
                          animate={{ opacity: 1, x: 0, scale: 1 }}
                          exit={{ opacity: 0, x: 8, scale: 0.95 }}
                          transition={{
                            delay: idx * 0.02,
                            type: 'spring',
                            stiffness: 200,
                            damping: 22,
                          }}
                          className="border-surface-300/10 bg-surface-200/30 hover:bg-surface-200/50 hover:border-surface-400/20 group flex items-center justify-between rounded-xl border px-2.5 py-1.5 text-sm transition-all"
                          layout
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {entry.endTime ? (
                                <motion.span
                                  initial={{ scale: 0 }}
                                  animate={{ scale: 1 }}
                                  transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                                  className="text-surface-900 font-mono text-xs font-medium"
                                >
                                  {entry.durationMinutes
                                    ? formatDuration(entry.durationMinutes)
                                    : '—'}
                                </motion.span>
                              ) : (
                                <span className="text-brand-400 inline-flex items-center gap-1 text-xs">
                                  <span className="bg-brand-500 inline-block h-1.5 w-1.5 animate-pulse rounded-full" />
                                  Running
                                </span>
                              )}
                              <span className="text-surface-500 text-xs">
                                {new Date(entry.startTime).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                            </div>
                            {entry.description && (
                              <p className="text-surface-500 mt-0.5 truncate text-xs">
                                {entry.description}
                              </p>
                            )}
                          </div>
                          <motion.button
                            whileHover={{ scale: 1.15 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={() => deleteTimeEntry(entry.id)}
                            className="text-surface-500 hover:text-error hover:bg-error/5 ml-2 shrink-0 rounded-lg p-1 opacity-0 transition-all duration-200 group-hover:opacity-100"
                          >
                            <X className="h-3 w-3" />
                          </motion.button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {timeEntries.length === 0 && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-surface-500 py-2 text-center text-xs"
                >
                  No time logged yet.
                </motion.p>
              )}
            </div>
          </motion.div>

          {/* Metadata card */}
          <motion.div
            variants={itemVariants}
            className={sectionCardClass}
          >
            <SectionHeading icon={Calendar} title="Details" />
            <div className="text-surface-500 space-y-3 px-5 py-4 text-sm">
              <motion.div className="group flex items-center gap-2" whileHover={{ x: 2 }}>
                <Clock className="text-surface-400 group-hover:text-brand-500 h-3.5 w-3.5 transition-colors" />
                Created {new Date(task.createdAt).toLocaleDateString()}
              </motion.div>
              <motion.div className="group flex items-center gap-2" whileHover={{ x: 2 }}>
                <Clock className="text-surface-400 group-hover:text-brand-500 h-3.5 w-3.5 transition-colors" />
                Updated {new Date(task.updatedAt).toLocaleDateString()}
              </motion.div>
              <motion.div className="group flex items-center gap-2" whileHover={{ x: 2 }}>
                <User className="text-surface-400 group-hover:text-brand-500 h-3.5 w-3.5 transition-colors" />
                Created by {(task.createdBy ?? '').substring(0, 12)}...
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
