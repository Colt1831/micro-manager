'use client';

import { useEffect, useState, useCallback, startTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  Plus,
  X,
  AlertCircle,
  Check,
  Edit3,
  Trash2,
  Bot,
  Zap,
  Bell,
  ArrowRightLeft,
  UserPlus,
  Tag,
  Flag,
  AlertTriangle,
  ToggleLeft,
  ToggleRight,
  History,
  Sparkles,
  Clock,
  Mail,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────

export interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  trigger: string;
  conditions: unknown[];
  actions: Array<{ type: string; config: Record<string, unknown> }>;
  enabled: boolean;
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
  executionCount: number;
  createdAt: string;
}

export interface AutomationLog {
  id: string;
  ruleId: string;
  ruleName: string;
  trigger: string;
  entityType: string;
  entityId: string;
  conditionsMet: boolean;
  actionsExecuted: Array<{ type: string; success: boolean; message?: string }>;
  success: boolean;
  errorMessage: string | null;
  durationMs: number;
  triggeredByUserId: string | null;
  createdAt: string;
}

type Tab = 'rules' | 'logs';
type RuleForm = {
  name: string;
  description: string;
  trigger: string;
  actions: Array<{ type: string; config: Record<string, unknown> }>;
  conditions: Array<{
    field: string;
    operator: string;
    value: string;
  }>;
  enabled: boolean;
  cooldownMinutes: number;
};

// ─── Constants ──────────────────────────────────────────────

const TRIGGER_DEFINITIONS: Record<string, { label: string; description: string; icon: string }> = {
  'task.created': { label: 'Task Created', description: 'When a new task is created', icon: 'Plus' },
  'task.status_changed': { label: 'Task Status Changed', description: 'When a task status changes', icon: 'ArrowRightLeft' },
  'task.assigned': { label: 'Task Assigned', description: 'When a task is assigned', icon: 'UserPlus' },
  'task.overdue': { label: 'Task Overdue', description: 'When a task becomes overdue', icon: 'AlertTriangle' },
  'task.completed': { label: 'Task Completed', description: 'When a task is completed', icon: 'Check' },
  'task.comment_added': { label: 'Comment Added', description: 'When a comment is added to a task', icon: 'Bell' },
};

const ACTION_OPTIONS = [
  { value: 'notify', label: 'Send Notification', description: 'Notify one or more users', icon: Bell },
  { value: 'send_email', label: 'Send Email', description: 'Send an email to specified recipients', icon: Mail },
  { value: 'change_status', label: 'Change Status', description: 'Update the task status', icon: ArrowRightLeft },
  { value: 'assign', label: 'Assign To', description: 'Assign the task to a user', icon: UserPlus },
  { value: 'add_label', label: 'Add Label', description: 'Add a label to the task', icon: Tag },
  { value: 'change_priority', label: 'Change Priority', description: 'Update the task priority', icon: Flag },
  { value: 'escalate', label: 'Escalate', description: 'Escalate with critical priority + notify', icon: AlertTriangle },
] as const;

const CONDITION_FIELDS = [
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'assignedTo', label: 'Assignee' },
  { value: 'projectId', label: 'Project' },
  { value: 'labels', label: 'Labels' },
  { value: 'title', label: 'Title' },
];

const CONDITION_OPERATORS = [
  { value: 'eq', label: 'is' },
  { value: 'neq', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

const EMPTY_RULE_FORM: RuleForm = {
  name: '',
  description: '',
  trigger: 'task.created',
  actions: [{ type: 'notify', config: { userIds: [], message: '' } }],
  conditions: [],
  enabled: true,
  cooldownMinutes: 0,
};

const TRIGGER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Plus: Plus,
  ArrowRightLeft,
  UserPlus,
  AlertTriangle,
  Check,
  Bell,
};

const ACTION_ICONS_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  notify: Bell,
  send_email: Mail,
  change_status: ArrowRightLeft,
  assign: UserPlus,
  add_label: Tag,
  change_priority: Flag,
  escalate: AlertTriangle,
};

// ─── Helpers ────────────────────────────────────────────────

function getTriggerIcon(trigger: string) {
  const def = TRIGGER_DEFINITIONS[trigger];
  const iconName = def?.icon ?? 'Zap';
  const Icon = TRIGGER_ICONS[iconName] ?? Zap;
  return Icon;
}

function getActionIcon(type: string) {
  const Icon = ACTION_ICONS_MAP[type] ?? Zap;
  return Icon;
}

function getActionLabel(type: string): string {
  const actions: Record<string, string> = {
    notify: 'Notify',
    send_email: 'Send Email',
    change_status: 'Change Status',
    assign: 'Assign',
    add_label: 'Add Label',
    change_priority: 'Change Priority',
    escalate: 'Escalate',
  };
  return actions[type] ?? type;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}

// ─── Animation variants ─────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } },
} as const;

// ─── Action Config Editor Component ─────────────────────────

function ActionConfigEditor({
  action,
  onChange,
  onRemove,
}: {
  action: { type: string; config: Record<string, unknown> };
  onChange: (updated: { type: string; config: Record<string, unknown> }) => void;
  onRemove: () => void;
}) {  const Icon = getActionIcon(action.type);
  const config = action.config;

  const renderConfigFields
 = () => {
    switch (action.type) {
      case 'notify':
        return (
          <div className="space-y-2">
            <div>
              <label className="text-surface-500 mb-1 block text-[10px] font-semibold uppercase tracking-wider">
                Message
              </label>
              <input
                type="text"
                value={(config.message as string) ?? ''}
                onChange={(e) => onChange({ ...action, config: { ...config, message: e.target.value } })}
                placeholder="e.g., A high-priority task needs attention"
                className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-lg border px-3 py-2 text-xs transition-all focus:outline-none focus:ring-2"
              />
            </div>
          </div>
        );

      case 'change_status':
        return (
          <div>
            <label className="text-surface-500 mb-1 block text-[10px] font-semibold uppercase tracking-wider">
              New Status
            </label>
            <select
              value={(config.status as string) ?? ''}
              onChange={(e) => onChange({ ...action, config: { ...config, status: e.target.value } })}
              className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-lg border px-3 py-2 text-xs transition-all focus:outline-none focus:ring-2"
            >
              <option value="">Select status...</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="under_review">Under Review</option>
              <option value="completed">Completed</option>
              <option value="blocked">Blocked</option>
              <option value="on_hold">On Hold</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        );

      case 'assign':
        return (
          <div>
            <label className="text-surface-500 mb-1 block text-[10px] font-semibold uppercase tracking-wider">
              Assignee User ID
            </label>
            <input
              type="text"
              value={(config.userId as string) ?? ''}
              onChange={(e) => onChange({ ...action, config: { ...config, userId: e.target.value } })}
              placeholder="User ID to assign"
              className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-lg border px-3 py-2 text-xs transition-all focus:outline-none focus:ring-2"
            />
          </div>
        );

      case 'add_label':
        return (
          <div>
            <label className="text-surface-500 mb-1 block text-[10px] font-semibold uppercase tracking-wider">
              Label
            </label>
            <input
              type="text"
              value={(config.label as string) ?? ''}
              onChange={(e) => onChange({ ...action, config: { ...config, label: e.target.value } })}
              placeholder="e.g., auto-tagged, urgent"
              className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-lg border px-3 py-2 text-xs transition-all focus:outline-none focus:ring-2"
            />
          </div>
        );

      case 'change_priority':
        return (
          <div>
            <label className="text-surface-500 mb-1 block text-[10px] font-semibold uppercase tracking-wider">
              Priority
            </label>
            <select
              value={(config.priority as string) ?? ''}
              onChange={(e) => onChange({ ...action, config: { ...config, priority: e.target.value } })}
              className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-lg border px-3 py-2 text-xs transition-all focus:outline-none focus:ring-2"
            >
              <option value="">Select priority...</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        );

      case 'escalate':
        return (
          <div className="space-y-2">
            <div>
              <label className="text-surface-500 mb-1 block text-[10px] font-semibold uppercase tracking-wider">
                Message
              </label>
              <input
                type="text"
                value={(config.message as string) ?? ''}
                onChange={(e) => onChange({ ...action, config: { ...config, message: e.target.value } })}
                placeholder="Escalation reason"
                className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-lg border px-3 py-2 text-xs transition-all focus:outline-none focus:ring-2"
              />
            </div>
            <p className="text-surface-500 text-[10px]">Escalation also sets priority to critical.</p>
          </div>
        );

      case 'send_email':
        return (
          <div className="space-y-3">
            <div>
              <label className="text-surface-500 mb-1 block text-[10px] font-semibold uppercase tracking-wider">
                To (email addresses, comma-separated)
              </label>
              <input
                type="text"
                value={((config.to as string[]) ?? []).join(', ')}
                onChange={(e) =>
                  onChange({
                    ...action,
                    config: {
                      ...config,
                      to: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
                placeholder="user@example.com, manager@example.com"
                className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-lg border px-3 py-2 text-xs transition-all focus:outline-none focus:ring-2"
              />
            </div>
            <div>
              <label className="text-surface-500 mb-1 block text-[10px] font-semibold uppercase tracking-wider">
                Subject
              </label>
              <input
                type="text"
                value={(config.subject as string) ?? ''}
                onChange={(e) => onChange({ ...action, config: { ...config, subject: e.target.value } })}
                placeholder="e.g., Task requires immediate attention"
                className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-lg border px-3 py-2 text-xs transition-all focus:outline-none focus:ring-2"
              />
            </div>
            <div>
              <label className="text-surface-500 mb-1 block text-[10px] font-semibold uppercase tracking-wider">
                Message
              </label>
              <textarea
                value={(config.message as string) ?? ''}
                onChange={(e) => onChange({ ...action, config: { ...config, message: e.target.value } })}
                placeholder="Write the email body content here..."
                rows={3}
                className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full resize-none rounded-lg border px-3 py-2 text-xs transition-all focus:outline-none focus:ring-2"
              />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="border-surface-300/20 bg-surface-100/60 rounded-xl border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line react-hooks/static-components */}
          <Icon className="text-surface-500 h-3.5 w-3.5" />
          <span className="text-surface-700 text-xs font-medium">
            {getActionLabel(action.type)}
          </span>
        </div>
        <button onClick={onRemove} className="text-surface-500 hover:text-error rounded-lg p-1 transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>
      {renderConfigFields()}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────

interface AutomationClientProps {
  /** Server-rendered rules + logs; null means the server load failed and the client should fetch. */
  initialData: { rules: AutomationRule[]; logs: AutomationLog[] } | null;
}

export function AutomationClient({ initialData }: AutomationClientProps) {
  // When the server provided data, first paint already has real content — skip
  // the loading skeleton and the entrance fade. Computed once (prop is stable).
  const [hadInitialData] = useState(() => initialData !== null);
  const [tab, setTab] = useState<Tab>('rules');
  const [rules, setRules] = useState<AutomationRule[]>(initialData?.rules ?? []);
  const [logs, setLogs] = useState<AutomationLog[]>(initialData?.logs ?? []);
  const [loading, setLoading] = useState(initialData === null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_RULE_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [toggleLoading, setToggleLoading] = useState<string | null>(null);

  // ── Fetch Data ──────────────────────────────────────────

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/automation/rules');
      if (!res.ok) throw new Error('Failed to load rules');
      setRules((await res.json()).rules ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rules');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/automation/logs?limit=50');
      if (!res.ok) throw new Error('Failed to load logs');
      setLogs((await res.json()).logs ?? []);
    } catch {
      // Non-critical
    }
  }, []);

  // Only fetch on mount when the server did not provide data (fallback path).
  useEffect(() => {
    if (hadInitialData) return;
    startTransition(() => {
      fetchRules();
      fetchLogs();
    });
  }, [hadInitialData, fetchRules, fetchLogs]);

  useEffect(() => {
    if (tab === 'logs' && logs.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchLogs();
    }
  }, [tab, logs.length, fetchLogs]);

  // ── Rule CRUD ────────────────────────────────────────────

  const openCreateForm = () => {
    setEditingRuleId(null);
    setForm(EMPTY_RULE_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = async (rule: AutomationRule) => {
    setEditingRuleId(rule.id);
    setForm({
      name: rule.name,
      description: rule.description ?? '',
      trigger: rule.trigger,
      actions: rule.actions,
      conditions: (rule.conditions as Array<{ field: string; operator: string; value: string }>) ?? [],
      enabled: rule.enabled,
      cooldownMinutes: rule.cooldownMinutes,
    });
    setFormError(null);
    setShowForm(true);
  };

  const saveRule = async () => {
    if (!form.name.trim()) {
      setFormError('Rule name is required');
      return;
    }
    if (form.actions.length === 0) {
      setFormError('At least one action is required');
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const url = editingRuleId
        ? `/api/automation/rules/${editingRuleId}`
        : '/api/automation/rules';
      const method = editingRuleId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message ?? 'Failed to save rule');
      }

      setShowForm(false);
      fetchRules();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/automation/rules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      setShowDeleteConfirm(null);
      fetchRules();
    } catch {
      setShowDeleteConfirm(null);
    } finally {
      setDeletingId(null);
    }
  };

  const toggleRule = async (rule: AutomationRule) => {
    setToggleLoading(rule.id);
    try {
      const res = await fetch(`/api/automation/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (res.ok) {
        setRules((prev) =>
          prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)),
        );
      }
    } catch {
      // Silently fail
    } finally {
      setToggleLoading(null);
    }
  };

  // ── Add/remove actions in form ───────────────────────────

  const addAction = (type: string) => {
    const defaults: Record<string, Record<string, unknown>> = {
      notify: { userIds: [], message: '' },
      send_email: { to: [], userIds: [], subject: '', message: '' },
      change_status: { status: '' },
      assign: { userId: '' },
      add_label: { label: '' },
      change_priority: { priority: 'high' },
      escalate: { message: '' },
    };
    setForm((prev) => ({
      ...prev,
      actions: [...prev.actions, { type, config: defaults[type] ?? {} }],
    }));
  };

  const updateAction = (index: number, updated: { type: string; config: Record<string, unknown> }) => {
    setForm((prev) => ({
      ...prev,
      actions: prev.actions.map((a, i) => (i === index ? updated : a)),
    }));
  };

  const removeAction = (index: number) => {
    setForm((prev) => ({
      ...prev,
      actions: prev.actions.filter((_, i) => i !== index),
    }));
  };

  const addCondition = () => {
    setForm((prev) => ({
      ...prev,
      conditions: [...prev.conditions, { field: 'status', operator: 'eq', value: '' }],
    }));
  };

  const updateCondition = (index: number, updates: Partial<{ field: string; operator: string; value: string }>) => {
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.map((c, i) => (i === index ? { ...c, ...updates } : c)),
    }));
  };

  const removeCondition = (index: number) => {
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== index),
    }));
  };

  // ── Render ───────────────────────────────────────────────

  return (
    <motion.div
      variants={containerVariants}
      initial={hadInitialData ? false : 'hidden'}
      animate="visible"
      className="space-y-6"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-surface-950 flex items-center gap-2.5 text-[22px] font-semibold tracking-tight sm:text-2xl">
            <div className="bg-brand-500/15 flex h-8 w-8 items-center justify-center rounded-lg">
              <Bot className="h-4 w-4 text-white" />
            </div>
            Automation
          </h1>
          <p className="text-surface-500 mt-0.5 text-sm">
            Trigger actions when events happen in your workspace
          </p>
        </div>
        {tab === 'rules' && (
          <Button onClick={openCreateForm} className="h-8 rounded-lg px-3 text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" />
            New Rule
          </Button>
        )}
      </motion.div>

      {/* Tabs */}
      <motion.div variants={itemVariants}>
        <div
          className="bg-surface-200/50 inline-flex items-center gap-0.5 rounded-xl p-0.5"
          role="tablist"
        >
          <button
            role="tab"
            aria-selected={tab === 'rules'}
            onClick={() => setTab('rules')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
              tab === 'rules'
                ? 'bg-surface-50 text-surface-900 shadow-sm'
                : 'text-surface-500 hover:text-surface-700 ',
            )}
          >
            <Zap className="-ml-0.5 mr-1.5 inline h-3.5 w-3.5" />
            Rules
            {rules.length > 0 && (
              <span className="bg-surface-300/30 ml-1.5 rounded-full px-1.5 py-0.5 text-[9px]">
                {rules.length}
              </span>
            )}
          </button>
          <button
            role="tab"
            aria-selected={tab === 'logs'}
            onClick={() => setTab('logs')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
              tab === 'logs'
                ? 'bg-surface-50 text-surface-900 shadow-sm'
                : 'text-surface-500 hover:text-surface-700 ',
            )}
          >
            <History className="-ml-0.5 mr-1.5 inline h-3.5 w-3.5" />
            Audit Log
          </button>
        </div>
      </motion.div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {tab === 'rules' && (
          <motion.div
            key="rules"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="shimmer h-24 rounded-2xl" />
                ))}
              </div>
            ) : error ? (
              <div className="flex flex-col items-center py-12">
                <AlertCircle className="text-error mb-2 h-8 w-8" />
                <p className="text-error text-sm">{error}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={fetchRules}>
                  Retry
                </Button>
              </div>
            ) : rules.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center py-16"
              >
                <div className="border-surface-300/20 bg-surface-100/50 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border">
                  <Bot className="text-surface-400 h-7 w-7" />
                </div>
                <h3 className="text-surface-900 text-base font-semibold">
                  No automation rules yet
                </h3>
                <p className="text-surface-500 mt-1.5 max-w-xs text-center text-sm">
                  Create rules to automatically notify, assign, update, or escalate tasks when events happen.
                </p>
                <div className="mt-5 flex items-center gap-2">
                  <Button onClick={openCreateForm} className="h-8 rounded-xl px-3 text-xs">
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Create Your First Rule
                  </Button>
                </div>
              </motion.div>
            ) : (
              <div className="space-y-3">
                {rules.map((rule, idx) => {
                  const TriggerIcon = getTriggerIcon(rule.trigger);
                  return (
                    <motion.div
                      key={rule.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className={cn(
                        'neon-card overflow-hidden rounded-2xl transition-all duration-200',
                        !rule.enabled && 'opacity-60',
                      )}
                    >
                      {/* Gradient bar */}
                      <div
                        className={cn(
                          'absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r',
                          rule.enabled ? 'from-brand-400 to-brand-600' : 'from-surface-300 to-surface-400',
                        )}
                      />

                      <div className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex min-w-0 items-start gap-3">
                            <div
                              className={cn(
                                'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
                                rule.enabled
                                  ? 'bg-brand-500/10 text-brand-500'
                                  : 'bg-surface-200/50 text-surface-400',
                              )}
                            >
                              <TriggerIcon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="text-surface-900 text-sm font-semibold">
                                  {rule.name}
                                </h3>
                                <Badge
                                  variant={rule.enabled ? 'success' : 'default'}
                                  size="sm"
                                  className="px-1.5 py-0 text-[9px]"
                                >
                                  {rule.enabled ? 'Active' : 'Disabled'}
                                </Badge>
                              </div>
                              {rule.description && (
                                <p className="text-surface-500 mt-0.5 line-clamp-1 text-xs">
                                  {rule.description}
                                </p>
                              )}
                              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                <span className="text-surface-500 inline-flex items-center gap-1 rounded-lg bg-surface-200/40 px-1.5 py-0.5 text-[9px] font-medium">
                                  <Zap className="h-2.5 w-2.5" />
                                  {TRIGGER_DEFINITIONS[rule.trigger]?.label ?? rule.trigger}
                                </span>
                                {(rule.actions ?? []).map((action, ai) => {
                                  const AIcon = getActionIcon(action.type);
                                  return (
                                    <span
                                      key={ai}
                                      className="text-surface-500 inline-flex items-center gap-1 rounded-lg bg-surface-200/40 px-1.5 py-0.5 text-[9px] font-medium"
                                    >
                                      <AIcon className="h-2.5 w-2.5" />
                                      {getActionLabel(action.type)}
                                    </span>
                                  );
                                })}
                                {rule.cooldownMinutes > 0 && (
                                  <span className="text-surface-500 inline-flex items-center gap-1 rounded-lg bg-surface-200/40 px-1.5 py-0.5 text-[9px] font-medium">
                                    <Clock className="h-2.5 w-2.5" />
                                    {rule.cooldownMinutes}m cooldown
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            {rule.executionCount > 0 && (
                              <span className="text-surface-400 mr-1 text-[10px] font-medium">
                                {rule.executionCount}x
                              </span>
                            )}
                            <button
                              onClick={() => toggleRule(rule)}
                              disabled={toggleLoading === rule.id}
                              className={cn(
                                'rounded-lg p-1.5 transition-all',
                                rule.enabled
                                  ? 'text-brand-500 hover:bg-brand-500/10'
                                  : 'text-surface-400 hover:bg-surface-200/50 hover:text-surface-600',
                              )}
                              title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                            >
                              {toggleLoading === rule.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : rule.enabled ? (
                                <ToggleRight className="h-3.5 w-3.5" />
                              ) : (
                                <ToggleLeft className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              onClick={() => openEditForm(rule)}
                              aria-label="Edit rule"
                              className="text-surface-500 hover:text-brand-500 hover:bg-surface-200/70 rounded-lg p-1.5 transition-all"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setShowDeleteConfirm(rule.id)}
                              aria-label="Delete rule"
                              className="text-surface-500 hover:text-error hover:bg-error/5 rounded-lg p-1.5 transition-all"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Last triggered info */}
                        {rule.lastTriggeredAt && (
                          <div className="text-surface-400 mt-2 flex items-center gap-1.5 border-t border-surface-300/10 pt-2 text-[10px]">
                            <Clock className="h-3 w-3" />
                            Last triggered {formatDate(rule.lastTriggeredAt)}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* Keyboard hint */}
            {rules.length > 0 && (
              <div className="flex items-center justify-center gap-2 text-[10px] text-surface-400">
                <Sparkles className="h-3 w-3" />
                <span>Automation rules run automatically when their trigger event occurs</span>
              </div>
            )}
          </motion.div>
        )}

        {tab === 'logs' && (
          <motion.div
            key="logs"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <div className="neon-card relative overflow-hidden rounded-2xl">
              <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-surface-300 to-surface-400 opacity-40" />
              <div className="p-4">
                {logs.length === 0 ? (
                  <div className="flex flex-col items-center py-8">
                    <History className="text-surface-400 mb-2 h-8 w-8" />
                    <p className="text-surface-500 text-sm">No automation logs yet</p>
                    <p className="text-surface-400 mt-1 text-xs">Logs appear when automation rules are triggered.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {logs.map((log) => (
                      <div
                        key={log.id}
                        className="border-surface-300/20 bg-surface-50/50 flex items-start gap-3 rounded-xl border p-3"
                      >
                        <div
                          className={cn(
                            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg',
                            log.success
                              ? 'bg-success/10 text-success'
                              : 'bg-error/10 text-error',
                          )}
                        >
                          {log.success ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <AlertCircle className="h-3 w-3" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-surface-900 text-xs font-medium">
                              {log.ruleName}
                            </span>
                            <Badge
                              variant={
                                log.success ? 'success' : log.conditionsMet ? 'warning' : 'default'
                              }
                              size="sm"
                              className="px-1.5 py-0 text-[9px]"
                            >
                              {log.success
                                ? 'Executed'
                                : log.conditionsMet
                                  ? 'Action Error'
                                  : 'Conditions Not Met'}
                            </Badge>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-surface-500">
                            <span>{log.trigger}</span>
                            <span className="text-surface-300 ">·</span>
                            <span>{log.entityType}:{log.entityId.slice(0, 8)}</span>
                            <span className="text-surface-300 ">·</span>
                            <span>{log.durationMs}ms</span>
                            <span className="text-surface-300 ">·</span>
                            <span>{formatDate(log.createdAt)}</span>
                          </div>
                          {log.errorMessage && (
                            <p className="text-error mt-1 text-[10px]">{log.errorMessage}</p>
                          )}
                          {log.actionsExecuted.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {log.actionsExecuted.map((action, ai) => (
                                <span
                                  key={ai}
                                  className={cn(
                                    'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium',
                                    action.success
                                      ? 'bg-success/10 text-success'
                                      : 'bg-error/10 text-error',
                                  )}
                                >
                                  {action.success ? (
                                    <Check className="h-2 w-2" />
                                  ) : (
                                    <X className="h-2 w-2" />
                                  )}
                                  {getActionLabel(action.type)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Keyboard hint */}
            {logs.length > 0 && (
              <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-surface-400">
                <History className="h-3 w-3" />
                <span>Logs are immutable — they cannot be deleted</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rule Form Dialog */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm py-10"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowForm(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="border-surface-300/30 bg-surface-50/95 w-full max-w-2xl rounded-2xl border p-6 shadow-lg backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-surface-900 text-lg font-semibold">
                  {editingRuleId ? 'Edit Rule' : 'New Automation Rule'}
                </h3>
                <button
                  onClick={() => setShowForm(false)}
                  className="text-surface-500 hover:bg-surface-200/70 hover:text-surface-600 rounded-lg p-1.5 transition-all"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-5">
                {/* Name */}
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Rule Name
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Notify on high-priority task"
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Description
                  </label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Optional description of what this rule does"
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>

                {/* Trigger */}
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Trigger Event
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(TRIGGER_DEFINITIONS).map(([key, def]) => {
                      const Icon = TRIGGER_ICONS[def.icon] ?? Zap;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, trigger: key }))}
                          className={cn(
                            'flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all',
                            form.trigger === key
                              ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500/30'
                              : 'border-surface-300/20 bg-surface-100/50 hover:border-surface-300/40',
                          )}
                        >
                          <Icon className="text-surface-500 mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <p className="text-surface-700 text-xs font-medium">
                              {def.label}
                            </p>
                            <p className="text-surface-500 mt-0.5 text-[10px]">{def.description}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Conditions */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-surface-500 text-xs font-semibold uppercase tracking-wider">
                      Conditions <span className="text-surface-400 font-normal normal-case">(optional)</span>
                    </label>
                    <button
                      type="button"
                      onClick={addCondition}
                      className="text-brand-500 hover:bg-brand-500/10 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors"
                    >
                      + Add Condition
                    </button>
                  </div>
                  {form.conditions.length === 0 ? (
                    <p className="text-surface-400 py-2 text-center text-xs">
                      No conditions — rule runs for all matching events
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {form.conditions.map((cond, idx) => (
                        <div
                          key={idx}
                          className="border-surface-300/20 bg-surface-100/60 flex items-center gap-2 rounded-xl border p-2"
                        >
                          <select
                            value={cond.field}
                            onChange={(e) => updateCondition(idx, { field: e.target.value })}
                            className="border-surface-300/30 bg-surface-50 rounded-lg border px-2 py-1.5 text-xs"
                          >
                            {CONDITION_FIELDS.map((f) => (
                              <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                          </select>
                          <select
                            value={cond.operator}
                            onChange={(e) => updateCondition(idx, { operator: e.target.value })}
                            className="border-surface-300/30 bg-surface-50 rounded-lg border px-2 py-1.5 text-xs"
                          >
                            {CONDITION_OPERATORS.map((op) => (
                              <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                          </select>
                          {cond.operator !== 'is_empty' && cond.operator !== 'is_not_empty' && (
                            <input
                              type="text"
                              value={cond.value}
                              onChange={(e) => updateCondition(idx, { value: e.target.value })}
                              placeholder="Value"
                              className="border-surface-300/30 bg-surface-50 focus:border-brand-500 flex-1 rounded-lg border px-2 py-1.5 text-xs transition-all focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                            />
                          )}
                          <button
                            onClick={() => removeCondition(idx)}
                            className="text-surface-500 hover:text-error shrink-0 rounded-lg p-1 transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-surface-500 text-xs font-semibold uppercase tracking-wider">
                      Actions
                    </label>
                    <div className="flex items-center gap-1">
                      {ACTION_OPTIONS.filter(
                        (opt) => !form.actions.some((a) => a.type === opt.value),
                      ).slice(0, 4).map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => addAction(opt.value)}
                            className="text-surface-500 hover:text-brand-500 hover:bg-brand-500/10 flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-all"
                          >
                            <Icon className="h-3 w-3" />
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {form.actions.map((action, idx) => (
                      <ActionConfigEditor
                        key={idx}
                        action={action}
                        onChange={(updated) => updateAction(idx, updated)}
                        onRemove={() => removeAction(idx)}
                      />
                    ))}
                  </div>
                </div>

                {/* Cooldown */}
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Cooldown (minutes) — <span className="font-normal normal-case">0 = no cooldown</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={form.cooldownMinutes}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        cooldownMinutes: Math.max(0, parseInt(e.target.value) || 0),
                      }))
                    }
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-24 rounded-xl border px-3 py-2 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>

                {/* Error & Success */}
                {formError && (
                  <div className="bg-error/5 text-error flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {formError}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 border-t border-surface-300/10 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowForm(false)}
                    className="h-8 rounded-lg px-3 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={saveRule}
                    disabled={saving}
                    size="sm"
                    className="h-8 rounded-lg px-3 text-xs"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="mr-1 h-3.5 w-3.5" />
                        {editingRuleId ? 'Update Rule' : 'Create Rule'}
                      </>
                    )}
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
              <h3 className="text-surface-900 text-lg font-semibold">Delete Rule</h3>
              <p className="text-surface-500 mt-2 text-sm">Are you sure you want to delete this rule? This action cannot be undone.</p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(null)}
                  className="h-8 rounded-lg px-3 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => deleteRule(showDeleteConfirm)}
                  disabled={deletingId === showDeleteConfirm}
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs bg-red-500 hover:bg-red-600 text-white"
                >
                  {deletingId === showDeleteConfirm ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
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
