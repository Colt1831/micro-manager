'use client';

import { useEffect, useState, useCallback, startTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { FormField } from '@/components/ui/form-field';
import { EmptyState } from '@/components/ui/state-display';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  Plus,
  Shield,
  Users,
  Edit3,
  Trash2,
  X,
  Check,
  AlertCircle,
  UserPlus,
  Settings as SettingsIcon,
  Bell,
  MessageSquare,
  UserCheck,
  Clock,
  AlertTriangle,
  ArrowRightLeft,
  AtSign,
  Flag,
  Mail,
  Smartphone,
  Monitor,
  BookOpen,
  Save,
  Sparkles,
  Webhook,
  Volume2,
  Play,
} from 'lucide-react';

import { AISettings } from '@/components/settings/ai-settings';
import { WebhookSettings } from '@/components/settings/webhook-settings';
import {
  EODScheduleSettings,
  DEFAULT_EOD_SETTINGS,
  type EODSettings,
} from '@/components/settings/eod-schedule-settings';
import { SlackSettings } from '@/components/settings/slack-settings';
import { SecuritySettings } from '@/components/settings/security-settings';
import { setMediaPrefs } from '@/lib/notification-media';
import { useToast } from '@/hooks/use-toast';
import { playNotificationChime, isNotificationSoundSupported } from '@/lib/notification-sound';
import { triggerHaptic } from '@/lib/haptics';

type Tab = 'general' | 'roles' | 'ai' | 'security' | 'notifications' | 'webhooks' | 'slack';
export type Organization = {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  settings: Record<string, unknown>;
};
type Role = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  priority: number;
  createdAt: string;
  permissionCount: number;
  userCount: number;
};
type Permission = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  module: string;
};
type UserRole = {
  id: string;
  roleId: string;
  userId: string;
  assignedAt: string;
  role: { id: string; name: string; slug: string; description: string | null; isSystem: boolean };
};
type User = { id: string; name: string | null; email: string };

const moduleLabels: Record<string, string> = {
  task: 'Tasks',
  project: 'Projects',
  team: 'Teams',
  role: 'Roles & Permissions',
  user: 'Users',
  report: 'Reports',
  settings: 'Settings',
  organization: 'Organization',
};
const moduleColors: Record<string, string> = {
  task: 'bg-blue-500/10 text-blue-400',
  project: 'bg-purple-500/10 text-purple-400',
  team: 'bg-green-500/10 text-green-400',
  role: 'bg-amber-500/10 text-amber-400',
  user: 'bg-cyan-500/10 text-cyan-400',
  report: 'bg-rose-500/10 text-rose-400',
  settings: 'bg-slate-500/10 text-slate-400',
  organization: 'bg-indigo-500/10 text-indigo-400',
};

type ChannelKey = 'inApp' | 'email' | 'push' | 'slack';

type NotifPreferences = {
  channels?: {
    inApp?: boolean;
    email?: boolean;
    push?: boolean;
    slack?: boolean;
  };
  types?: {
    task_assigned?: boolean;
    task_comment?: boolean;
    task_status_changed?: boolean;
    task_mention?: boolean;
    task_due_soon?: boolean;
    task_overdue?: boolean;
    task_escalated?: boolean;
    task_completed?: boolean;
    task_closed?: boolean;
    task_reopened?: boolean;
  };
  /**
   * Per-type, per-channel overrides.
   * When a channel is explicitly set for a type, it overrides the global
   * `channels` + `types` defaults. Not setting a value means "use default."
   */
  typeChannels?: Record<string, Partial<Record<ChannelKey, boolean>>>;
  digest?: {
    enabled?: boolean;
    frequency?: 'daily' | 'weekly' | 'never';
  };
  /**
   * Sound/vibration media feedback preferences.
   * These are also synced to localStorage so the SSE handler
   * can read them instantly without an API roundtrip.
   */
  media?: {
    soundEnabled?: boolean;
    hapticEnabled?: boolean;
  };
};

const DEFAULT_NOTIF_PREFS: NotifPreferences = {
  channels: { inApp: true, email: true, push: false, slack: false },
  types: {
    task_assigned: true,
    task_comment: true,
    task_status_changed: true,
    task_mention: true,
    task_due_soon: true,
    task_overdue: true,
    task_escalated: true,
    task_completed: false,
    task_closed: false,
    task_reopened: false,
  },
  typeChannels: {},
  digest: { enabled: false, frequency: 'daily' },
  media: { soundEnabled: true, hapticEnabled: true },
};

const notifTypeMeta: Record<string, { label: string; description: string; icon: React.ReactNode }> = {
  task_assigned: { label: 'Task assigned', description: 'When a task is assigned to you', icon: <UserCheck className="h-4 w-4" /> },
  task_comment: { label: 'New comment', description: 'When someone comments on your task', icon: <MessageSquare className="h-4 w-4" /> },
  task_status_changed: { label: 'Status changed', description: 'When your task status changes', icon: <ArrowRightLeft className="h-4 w-4" /> },
  task_mention: { label: 'Mentions', description: 'When you are mentioned in a comment', icon: <AtSign className="h-4 w-4" /> },
  task_due_soon: { label: 'Due soon', description: 'When a task is due within 24 hours', icon: <Clock className="h-4 w-4" /> },
  task_overdue: { label: 'Overdue', description: 'When a task becomes overdue', icon: <AlertTriangle className="h-4 w-4" /> },
  task_escalated: { label: 'Escalated', description: 'When a task is escalated', icon: <Flag className="h-4 w-4" /> },
  task_completed: { label: 'Completed', description: 'When a task you are assigned is completed', icon: <Check className="h-4 w-4" /> },
  task_closed: { label: 'Closed', description: 'When a task is closed', icon: <X className="h-4 w-4" /> },
  task_reopened: { label: 'Reopened', description: 'When a closed task is reopened', icon: <ArrowRightLeft className="h-4 w-4" /> },
};

const channelMeta: Record<ChannelKey, { label: string; description: string; icon: React.ReactNode }> = {
  inApp: { label: 'In-app', description: 'Notification bell in the top bar', icon: <Monitor className="h-4 w-4" /> },
  email: { label: 'Email', description: 'Send email notifications', icon: <Mail className="h-4 w-4" /> },
  push: { label: 'Push', description: 'Push notifications (coming soon)', icon: <Smartphone className="h-4 w-4" /> },
  slack: { label: 'Slack', description: 'Send notifications to Slack channel', icon: <MessageSquare className="h-4 w-4" /> },
};

// ─── Helpers ────────────────────────────────────────────────

function Toggle({ enabled, onChange, disabled, ariaLabel }: { enabled: boolean; onChange: (v: boolean) => void; disabled?: boolean; ariaLabel?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:ring-offset-2 focus:ring-offset-surface-50 ${
        enabled ? 'bg-brand-500' : 'bg-surface-300/50 '
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
          enabled ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? '').charAt(0).toUpperCase();
  return ((parts[0] ?? '').charAt(0) + (parts[parts.length - 1] ?? '').charAt(0)).toUpperCase();
}

// ─── Animation Variants ─────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
} as const;
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } },
} as const;
const tabContentVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
} as const;

const CARD_GRADIENTS: Record<string, string> = {
  general: 'from-blue-500 to-blue-400',
  roles: 'from-amber-500 to-yellow-400',
  ai: 'from-purple-500 to-pink-400',
  webhooks: 'from-cyan-500 to-teal-400',
  slack: 'from-[#4A154B] to-[#611f69]',
  security: 'from-emerald-500 to-teal-400',
  notifications: 'from-purple-500 to-violet-400',
} as const;

// ─── Tab Config ─────────────────────────────────────────────

const TABS: { id: Tab; label: string; gradient: string }[] = [
  { id: 'general', label: 'General', gradient: 'from-blue-500 to-blue-400' },
  { id: 'roles', label: 'Roles & Permissions', gradient: 'from-amber-500 to-yellow-400' },
  { id: 'ai', label: 'AI', gradient: 'from-purple-500 to-pink-400' },
  { id: 'webhooks', label: 'Webhooks', gradient: 'from-cyan-500 to-teal-400' },
  { id: 'slack', label: 'Slack', gradient: 'from-[#4A154B] to-[#611f69]' },
  { id: 'security', label: 'Security', gradient: 'from-emerald-500 to-teal-400' },
  { id: 'notifications', label: 'Notifications', gradient: 'from-purple-500 to-violet-400' },
];

// ─── Card wrapper with gradient bar ─────────────────────────

function SectionCard({ gradient, children, className = '' }: { gradient: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`neon-card relative overflow-hidden rounded-2xl ${className}`}>
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${gradient} opacity-60`} />
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════════

export function SettingsClient({ initialOrg = null }: { initialOrg?: Organization | null }) {
  const { toast } = useToast();
  // When the server seeded the org, paint the general tab immediately (no
  // shimmer, no fade-in) so it becomes the LCP without a client round-trip.
  const [hadInitialData] = useState(() => initialOrg !== null);
  // The EOD-schedule card (its description is the page's LCP element) reads the
  // same /api/organization payload, so seed it from the org we already have:
  // when the org loaded server-side, hand the card its settings (or defaults)
  // to skip its client fetch; otherwise (null) let it fetch on mount as before.
  const initialEodSettings: EODSettings | null = initialOrg
    ? { ...DEFAULT_EOD_SETTINGS, ...((initialOrg.settings?.eod as Partial<EODSettings>) ?? {}) }
    : null;
  const [tab, setTab] = useState<Tab>('general');
  const [org, setOrg] = useState<Organization | null>(initialOrg);
  const [loading, setLoading] = useState(initialOrg === null);
  const [name, setName] = useState(initialOrg?.name ?? '');
  const [notifPrefs, setNotifPrefs] = useState<NotifPreferences>(DEFAULT_NOTIF_PREFS);
  const [notifPrefsLoading, setNotifPrefsLoading] = useState(true);
  const [notifPrefsSaving, setNotifPrefsSaving] = useState(false);
  const [notifPrefsSaved, setNotifPrefsSaved] = useState(false);
  const [notifPrefsError, setNotifPrefsError] = useState<string | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [userRolesMap, setUserRolesMap] = useState<Record<string, UserRole[]>>({});
  const [assigningUser, setAssigningUser] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const [roleForm, setRoleForm] = useState({ name: '', slug: '', description: '' });
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<string[]>([]);
  const [savingRole, setSavingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [slackConnected, setSlackConnected] = useState<boolean | null>(null);

  // ── Keyboard shortcuts ──────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '1') setTab('general');
      else if (e.key === '2') setTab('roles');
      else if (e.key === '3') setTab('security');
      else if (e.key === '4') setTab('webhooks');
      else if (e.key === '5') setTab('slack');
      else if (e.key === '6') setTab('ai');
      else if (e.key === '7') setTab('notifications');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    // The server already seeded the org for the general tab — skip the mount
    // fetch so there's no redundant round-trip (this effect only runs once).
    if (hadInitialData) return;
    async function fetchOrg() {
      try {
        const res = await fetch('/api/organization');
        if (!res.ok) throw new Error('Failed to fetch organization');
        const data = await res.json();
        setOrg(data.organization ?? null);
        setName(data.organization?.name ?? '');
      } catch {
        /* */
      } finally {
        setLoading(false);
      }
    }
    fetchOrg();
  }, [hadInitialData]);

  const fetchRoles = useCallback(async () => {
    setRolesLoading(true);
    setRolesError(null);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        fetch('/api/roles'),
        fetch('/api/permissions'),
      ]);
      if (!rolesRes.ok) throw new Error('Failed to fetch roles');
      if (!permsRes.ok) throw new Error('Failed to fetch permissions');
      setRoles((await rolesRes.json()).roles ?? []);
      setPermissions((await permsRes.json()).permissions ?? []);
    } catch (err) {
      setRolesError(err instanceof Error ? err.message : 'Failed to load roles');
    } finally {
      setRolesLoading(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users?limit=100');
      if (res.ok) setUsers((await res.json()).users ?? []);
    } catch {
      /* */
    }
  }, []);

  const fetchUserRoles = useCallback(async (userId: string) => {
    try {
      const res = await fetch(`/api/users/${userId}/roles`);
      if (res.ok) {
        const data = await res.json();
        setUserRolesMap((prev) => ({ ...prev, [userId]: data.userRoles ?? [] }));
      }
    } catch {
      /* */
    }
  }, []);

  useEffect(() => {
    if (tab === 'roles') {
      startTransition(() => {
        fetchRoles();
        fetchUsers();
      });
    }
  }, [tab, fetchRoles, fetchUsers]);

  useEffect(() => {
    if (tab === 'notifications' && notifPrefsLoading) {
      (async () => {
        try {
          const res = await fetch('/api/users/me/preferences');
          if (res.ok) {
            const data = await res.json();              if (data.preferences && Object.keys(data.preferences).length > 0) {
              setNotifPrefs((prev) => {
                const updated = {
                  ...prev,
                  channels: { ...(prev.channels ?? {}), ...(data.preferences.channels ?? {}) },
                  types: { ...(prev.types ?? {}), ...(data.preferences.types ?? {}) },
                  typeChannels: { ...(prev.typeChannels ?? {}), ...(data.preferences.typeChannels ?? {}) },
                  digest: { ...(prev.digest ?? {}), ...(data.preferences.digest ?? {}) },
                  media: { ...(prev.media ?? {}), ...(data.preferences.media ?? {}) },
                };
                // Sync media prefs to localStorage only if the API actually returned them
                const apiMedia = data.preferences.media as
                  | { soundEnabled?: boolean; hapticEnabled?: boolean }
                  | undefined;
                if (apiMedia) {
                  setMediaPrefs({
                    soundEnabled: apiMedia.soundEnabled ?? true,
                    hapticEnabled: apiMedia.hapticEnabled ?? true,
                  });
                }
                return updated;
              });
            }
          }
        } catch {
          // Use defaults
        } finally {
          setNotifPrefsLoading(false);
        }
      })();

      // Fetch Slack connection status
      (async () => {
        try {
          const res = await fetch('/api/settings/slack');
          if (res.ok) {
            const data = await res.json();
            setSlackConnected(!!data.integration?.isActive);
          }
        } catch {
          setSlackConnected(false);
        }
      })();
    }
  }, [tab, notifPrefsLoading]);

  const saveNotifPrefs = async () => {
    setNotifPrefsSaving(true);
    setNotifPrefsError(null);
    setNotifPrefsSaved(false);
    try {
      const res = await fetch('/api/users/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notifPrefs),
      });
      if (!res.ok) throw new Error('Failed to save');
      // Sync media prefs to localStorage for the SSE hook
      if (notifPrefs.media) {
        setMediaPrefs({
          soundEnabled: notifPrefs.media.soundEnabled ?? true,
          hapticEnabled: notifPrefs.media.hapticEnabled ?? true,
        });
      }
      setNotifPrefsSaved(true);
      setTimeout(() => setNotifPrefsSaved(false), 2000);
    } catch {
      setNotifPrefsError('Failed to save preferences. Please try again.');
    } finally {
      setNotifPrefsSaving(false);
    }
  };

  /**
   * Update a per-type channel toggle.
   * When the user explicitly toggles a channel for a notification type,
   * we store it in typeChannels so the backend can distinguish "explicitly
   * set" from "use default."
   */
  const updateTypeChannel = useCallback(
    (typeKey: string, channel: ChannelKey, value: boolean) => {
      setNotifPrefs((prev) => ({
        ...prev,
        typeChannels: {
          ...(prev.typeChannels ?? {}),
          [typeKey]: {
            ...((prev.typeChannels as Record<string, Partial<Record<ChannelKey, boolean>>> | undefined)?.[typeKey] ?? {}),
            [channel]: value,
          },
        },
      }));
    },
    [],
  );

  const openCreateDialog = () => {
    setEditingRole(null);
    setRoleForm({ name: '', slug: '', description: '' });
    setSelectedPermissionIds([]);
    setRoleError(null);
    setShowRoleDialog(true);
  };

  const openEditDialog = async (role: Role) => {
    setEditingRole(role);
    setRoleForm({ name: role.name, slug: role.slug, description: role.description ?? '' });
    setRoleError(null);
    try {
      const res = await fetch(`/api/roles/${role.id}`);
      if (res.ok) setSelectedPermissionIds((await res.json()).permissionIds ?? []);
      else setSelectedPermissionIds([]);
    } catch {
      setSelectedPermissionIds([]);
    }
    setShowRoleDialog(true);
  };

  const saveRole = async () => {
    if (!roleForm.name.trim() || !roleForm.slug.trim()) {
      setRoleError('Name and slug are required');
      return;
    }
    setSavingRole(true);
    setRoleError(null);
    try {
      const url = editingRole ? `/api/roles/${editingRole.id}` : '/api/roles';
      const method = editingRole ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...roleForm, permissionIds: selectedPermissionIds }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error?.message ?? 'Failed to save role');
      }
      setShowRoleDialog(false);
      fetchRoles();
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : 'Failed to save role');
    } finally {
      setSavingRole(false);
    }
  };

  const deleteRole = async () => {
    if (!deletingRoleId) return;
    try {
      const res = await fetch(`/api/roles/${deletingRoleId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete role');
      setShowDeleteConfirm(false);
      setDeletingRoleId(null);
      fetchRoles();
    } catch {
      setShowDeleteConfirm(false);
    }
  };

  const assignRole = async (userId: string, roleId: string) => {
    if (!roleId) return;
    setAssigningUser(userId);
    try {
      const res = await fetch(`/api/users/${userId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleId }),
      });
      if (res.ok) fetchUserRoles(userId);
    } catch {
      /* */
    } finally {
      setAssigningUser(null);
    }
  };

  const removeRole = async (userId: string, roleId: string) => {
    try {
      const res = await fetch(`/api/users/${userId}/roles?roleId=${roleId}`, { method: 'DELETE' });
      if (res.ok) fetchUserRoles(userId);
    } catch {
      /* */
    }
  };

  const togglePermission = (permissionId: string) => {
    setSelectedPermissionIds((prev) =>
      prev.includes(permissionId)
        ? prev.filter((id) => id !== permissionId)
        : [...prev, permissionId],
    );
  };

  const groupedPermissions = permissions.reduce<Record<string, Permission[]>>((acc, perm) => {
    const mod = perm.module;
    if (!acc[mod]) acc[mod] = [];
    acc[mod]!.push(perm);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="space-y-1">
          <div className="shimmer h-8 w-32 rounded-xl" />
          <div className="shimmer mt-2 h-4 w-48 rounded-lg" />
        </div>
        <div className="shimmer h-10 w-full max-w-md rounded-xl" />
        <div className="shimmer h-48 w-full rounded-xl" />
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
      {/* Header */}
      <motion.div variants={itemVariants}>
        <PageHeader
          icon={
            <span className="from-brand-500/15 to-brand-400/5 text-brand-400 ring-brand-500/10 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-inset">
              <SettingsIcon className="h-5 w-5" />
            </span>
          }
          title="Settings"
          subtitle="Manage your workspace settings"
          className="mb-0"
        />
      </motion.div>

      {/* Tabs */}
      <motion.div variants={itemVariants}>
        <div
          className="bg-surface-200/50 inline-flex items-center gap-0.5 rounded-xl p-0.5"
          role="tablist"
          aria-label="Settings sections"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                tab === t.id
                  ? 'bg-brand-500/15 text-brand-500 shadow-sm shadow-brand-500/10'
                  : 'text-surface-500 hover:text-surface-700 '
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {tab === 'general' && (
          <motion.div
            key="general"
            variants={tabContentVariants}
            // Seeded general tab (org + EOD card) is the LCP content — render it
            // visible immediately rather than fading from opacity:0, which would
            // delay the largest-contentful-paint even though the HTML is present.
            initial={hadInitialData ? false : 'hidden'}
            animate="visible"
            exit="exit"
          >
            <SectionCard gradient={CARD_GRADIENTS.general ?? 'from-blue-500 to-blue-400'}>
              <div className="p-5 space-y-4">
                <h2 className="text-surface-900 flex items-center gap-2 text-base font-semibold">
                  <SettingsIcon className="text-surface-400 h-4 w-4" />
                  General Settings
                </h2>
                {[
                  { label: 'Organization Name', value: name },
                  { label: 'Slug', value: org?.slug ?? '' },
                  { label: 'Domain', value: org?.domain ?? '', placeholder: 'your-company.com' },
                ].map((field) => (
                  <FormField key={field.label} label={field.label} className="max-w-md">
                    <input
                      type="text"
                      aria-label={field.label}
                      value={field.value}
                      disabled
                      placeholder={field.placeholder}
                      // These read-only fields are now server-rendered. The browser
                      // applies a client-only `caret-color: transparent` to disabled
                      // inputs, which React would otherwise flag as a hydration
                      // mismatch — suppress it here since the value is server-authoritative.
                      suppressHydrationWarning
                      className="border-surface-300/20 bg-surface-200/50 text-surface-500 w-full cursor-not-allowed rounded-xl border px-3 py-2.5 text-sm"
                    />
                  </FormField>
                ))}
                <p className="text-surface-500 text-xs pt-1">General settings cannot be edited yet.</p>
              </div>
            </SectionCard>

            {/* EOD Report Schedule */}
            <SectionCard gradient={CARD_GRADIENTS.general ?? 'from-blue-500 to-blue-400'} className="mt-6">
              <EODScheduleSettings initialSettings={initialEodSettings} />
            </SectionCard>
          </motion.div>
        )}

        {tab === 'roles' && (
          <motion.div
            key="roles"
            variants={tabContentVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="space-y-6"
          >
            {/* Roles List */}
            <SectionCard gradient={CARD_GRADIENTS.roles ?? 'from-amber-500 to-yellow-400'}>
              <div className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-surface-900 flex items-center gap-2 text-base font-semibold">
                    <Shield className="text-surface-400 h-4 w-4" />
                    Roles
                  </h2>
                  <Button size="sm" onClick={openCreateDialog} className="h-7 rounded-lg px-2.5 text-xs">
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    New Role
                  </Button>
                </div>

                {rolesLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="shimmer h-12 rounded-xl" />
                    ))}
                  </div>
                ) : rolesError ? (
                  <div className="flex flex-col items-center py-8">
                    <AlertCircle className="text-error mb-2 h-8 w-8" />
                    <p className="text-error text-sm">{rolesError}</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={fetchRoles}>
                      Retry
                    </Button>
                  </div>
                ) : roles.length === 0 ? (
                  <EmptyState
                    icon={<Shield className="text-surface-400 h-12 w-12" />}
                    title="No roles yet"
                    message="Create your first role to set up permissions."
                    action={
                      <Button size="sm" onClick={openCreateDialog}>
                        <Plus className="mr-1.5 h-4 w-4" /> Create Role
                      </Button>
                    }
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-surface-300/20 border-b">
                          <th className="text-surface-500 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider">Name</th>
                          <th className="text-surface-500 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider hidden md:table-cell">Slug</th>
                          <th className="text-surface-500 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider">Perms</th>
                          <th className="text-surface-500 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider">Users</th>
                          <th className="text-surface-500 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider">Status</th>
                          <th className="w-20 px-3 py-2.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {roles.map((role) => (
                          <tr
                            key={role.id}
                            className="border-surface-300/20 hover:bg-surface-200/30 border-b transition-colors"
                          >
                            <td className="px-3 py-3">
                              <div>
                                <span className="text-surface-900 font-medium">{role.name}</span>
                                {role.isSystem && (
                                  <Badge variant="primary" className="ml-2 px-1.5 py-0 text-[9px]">System</Badge>
                                )}
                                {role.description && (
                                  <p className="text-surface-500 mt-0.5 text-xs">{role.description}</p>
                                )}
                              </div>
                            </td>
                            <td className="text-surface-500 px-3 py-3 font-mono text-xs hidden md:table-cell">
                              {role.slug}
                            </td>
                            <td className="px-3 py-3">
                              <Badge variant="default" size="sm">{role.permissionCount}</Badge>
                            </td>
                            <td className="px-3 py-3">
                              <Badge variant="default" size="sm">{role.userCount}</Badge>
                            </td>
                            <td className="px-3 py-3">
                              <Badge variant={role.isActive ? 'success' : 'default'} size="sm">
                                {role.isActive ? 'Active' : 'Inactive'}
                              </Badge>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => openEditDialog(role)}
                                  className="text-surface-500 hover:text-brand-500 hover:bg-surface-200/70 rounded-lg p-1.5 transition-all"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </button>
                                {!role.isSystem && (
                                  <button
                                    onClick={() => { setDeletingRoleId(role.id); setShowDeleteConfirm(true); }}
                                    className="text-surface-500 hover:text-error hover:bg-error/5 rounded-lg p-1.5 transition-all"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </SectionCard>

            {/* User Role Assignments */}
            <SectionCard gradient={CARD_GRADIENTS.roles ?? 'from-amber-500 to-yellow-400'}>
              <div className="p-5">
                <h2 className="text-surface-900 mb-4 flex items-center gap-2 text-base font-semibold">
                  <Users className="text-surface-400 h-4 w-4" />
                  User Role Assignments
                </h2>
                {users.length === 0 ? (
                  <EmptyState
                    icon={<UserPlus className="text-surface-400 h-10 w-10" />}
                    title="No users found"
                    message="Users will appear here once they join the workspace."
                  />
                ) : (
                  <div className="space-y-2">
                    {users.map((user) => (
                      <motion.div
                        key={user.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="neon-card hover:bg-surface-200/40 flex items-center justify-between rounded-xl px-4 py-3 transition-all duration-200"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="bg-brand-500/10 text-brand-500 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                            {getInitials(user.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-surface-900 truncate text-sm font-medium">
                              {user.name ?? 'Unnamed'}
                            </p>
                            <p className="text-surface-500 truncate text-xs">{user.email}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {(userRolesMap[user.id] ?? []).map((ur) => (
                            <span
                              key={ur.roleId}
                              className="bg-brand-500/10 text-brand-500 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                            >
                              {ur.role.name}
                              <button onClick={() => removeRole(user.id, ur.roleId)} className="hover:text-error ml-0.5">
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                          {(userRolesMap[user.id] ?? []).length === 0 && (
                            <span className="text-surface-500 text-xs">No roles</span>
                          )}
                          <select
                            aria-label="Assign role to user"
                            value=""
                            onChange={(e) => { if (e.target.value) assignRole(user.id, e.target.value); }}
                            className="border-surface-300/30 bg-surface-100 hover:border-surface-400/30 ml-2 h-7 rounded-lg border px-2 text-xs transition-all"
                          >
                            <option value="">
                              {assigningUser === user.id ? 'Assigning...' : '+ Add role'}
                            </option>
                            {roles
                              .filter((r) => !(userRolesMap[user.id] ?? []).some((ur) => ur.roleId === r.id))
                              .map((r) => (
                                <option key={r.id} value={r.id}>{r.name}</option>
                              ))}
                          </select>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </SectionCard>
          </motion.div>
        )}

        {tab === 'ai' && (
          <motion.div
            key="ai"
            variants={tabContentVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <SectionCard gradient={CARD_GRADIENTS.ai ?? 'from-purple-500 to-pink-400'}>
              <div className="p-5">
                <h2 className="text-surface-900 mb-4 flex items-center gap-2 text-base font-semibold">
                  <Sparkles className="text-surface-400 h-4 w-4" />
                  AI Provider Configuration
                </h2>
                <p className="text-surface-500 mb-6 text-sm">
                  Configure your AI provider to enable smart features: task summaries, priority suggestions,
                  deadline risk predictions, duplicate detection, and writing assistance.
                </p>
                <AISettings />
              </div>
            </SectionCard>
          </motion.div>
        )}

        {tab === 'webhooks' && (
          <motion.div
            key="webhooks"
            variants={tabContentVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <SectionCard gradient={CARD_GRADIENTS.webhooks ?? 'from-cyan-500 to-teal-400'}>
              <div className="p-5">
                <h2 className="text-surface-900 mb-4 flex items-center gap-2 text-base font-semibold">
                  <Webhook className="text-surface-400 h-4 w-4" />
                  Webhook Integrations
                </h2>
                <p className="text-surface-500 mb-6 text-sm">
                  Configure webhooks to send real-time HTTP notifications to external services
                  when events occur in your workspace.
                </p>
                <WebhookSettings />
              </div>
            </SectionCard>
          </motion.div>
        )}

        {tab === 'slack' && (
          <motion.div
            key="slack"
            variants={tabContentVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <SectionCard gradient={CARD_GRADIENTS.slack ?? 'from-[#4A154B] to-[#611f69]'}>
              <div className="p-5">
                <h2 className="text-surface-900 mb-4 flex items-center gap-2 text-base font-semibold">
                  <MessageSquare className="text-[#4A154B] h-4 w-4" />
                  Slack Integration
                </h2>
                <SlackSettings />
              </div>
            </SectionCard>
          </motion.div>
        )}

        {tab === 'security' && (
          <motion.div
            key="security"
            variants={tabContentVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <SectionCard gradient={CARD_GRADIENTS.security ?? 'from-emerald-500 to-teal-400'}>
              <div className="p-5">
                <h2 className="text-surface-900 flex items-center gap-2 text-base font-semibold">
                  <Shield className="text-surface-400 h-4 w-4" />
                  Security Settings
                </h2>
                <SecuritySettings />
              </div>
            </SectionCard>
          </motion.div>
        )}

        {tab === 'notifications' && (
          <motion.div
            key="notifications"
            variants={tabContentVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="space-y-4"
          >
            {/* Channels */}
            <SectionCard gradient={CARD_GRADIENTS.notifications ?? 'from-purple-500 to-violet-400'}>
              <div className="p-5">
                <h2 className="text-surface-900 mb-4 flex items-center gap-2 text-base font-semibold">
                  <Bell className="text-surface-400 h-4 w-4" />
                  Notification Channels
                </h2>
                <div className="space-y-2">
                  {(['inApp', 'email', 'push', 'slack'] as const).map((key) => (
                    <motion.div
                      key={key}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="border-surface-300/20 hover:border-brand-500/20 hover:bg-surface-200/40 flex items-center justify-between rounded-xl border px-4 py-3 transition-all duration-200"
                    >
                      <div className="flex items-center gap-3">
                        <div className="text-surface-500">{channelMeta[key]!.icon}</div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-surface-900 text-sm font-medium">
                              {channelMeta[key]!.label}
                            </p>
                            {key === 'slack' && slackConnected !== null && (
                              <Badge
                                variant={slackConnected ? 'success' : 'default'}
                                size="sm"
                                className="px-1.5 py-0 text-[9px]"
                              >
                                {slackConnected ? 'Connected' : 'Not connected'}
                              </Badge>
                            )}
                          </div>
                          <p className="text-surface-500 text-xs">
                            {channelMeta[key]!.description}
                            {key === 'slack' && !slackConnected && (
                              <> · <a href="#" onClick={(e) => { e.preventDefault(); setTab('slack'); }} className="text-brand-500 hover:underline">Configure Slack</a></>
                            )}
                          </p>
                        </div>
                      </div>
                      <Toggle
                        ariaLabel={`${channelMeta[key]!.label} notifications`}
                        enabled={notifPrefs.channels?.[key] ?? false}
                        onChange={(v) => setNotifPrefs((prev) => ({ ...prev, channels: { ...(prev.channels ?? {}), [key]: v } }))}
                        disabled={key === 'push' || (key === 'slack' && slackConnected === false)}
                      />
                    </motion.div>
                  ))}

                  {/* Sound & Haptic feedback toggles */}
                  <div className="border-surface-300/20 border-t pt-3 mt-3">
                    <p className="text-surface-500 mb-2 text-[10px] font-semibold uppercase tracking-wider">
                      Notification Feedback
                    </p>
                    <div className="space-y-2">
                      <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="hover:border-brand-500/20 hover:bg-surface-200/40 flex items-center justify-between rounded-xl border border-transparent px-4 py-3 transition-all duration-200"
                      >
                        <div className="flex items-center gap-3">
                          <Volume2 className="text-surface-500 h-4 w-4" />
                          <div>
                            <p className="text-surface-900 text-sm font-medium">Sound</p>
                            <p className="text-surface-500 text-xs">Play a chime on new notifications</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              playNotificationChime();
                              toast({
                                title: '🔔 Preview chime',
                                description: 'Notification chime is playing...',
                              });
                            }}
                            disabled={!(notifPrefs.media?.soundEnabled ?? true) || !isNotificationSoundSupported()}
                            title="Preview chime"
                            aria-label="Preview notification chime"
                            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200 ${
                              (notifPrefs.media?.soundEnabled ?? true) && isNotificationSoundSupported()
                                ? 'text-brand-500 hover:bg-brand-500/10 active:scale-90'
                                : 'text-surface-400 cursor-not-allowed opacity-40'
                            }`}
                          >
                            <Play className="h-3.5 w-3.5" />
                          </button>
                          <Toggle
                            ariaLabel="Notification sound"
                            enabled={notifPrefs.media?.soundEnabled ?? true}
                            onChange={(v) => setNotifPrefs((prev) => ({ ...prev, media: { ...(prev.media ?? {}), soundEnabled: v } }))}
                          />
                        </div>
                      </motion.div>
                      <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="hover:border-brand-500/20 hover:bg-surface-200/40 flex items-center justify-between rounded-xl border border-transparent px-4 py-3 transition-all duration-200"
                      >
                        <div className="flex items-center gap-3">
                          <Smartphone className="text-surface-500 h-4 w-4" />
                          <div>
                            <p className="text-surface-900 text-sm font-medium">Vibration</p>
                            <p className="text-surface-500 text-xs">Vibrate on new notifications (mobile only)</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              triggerHaptic('light');
                              toast({
                                title: '📳 Preview vibration',
                                description: 'Vibration feedback triggered (mobile devices only).',
                              });
                            }}
                            disabled={!(notifPrefs.media?.hapticEnabled ?? true)}
                            title="Preview vibration"
                            aria-label="Preview vibration feedback"
                            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200 ${
                              (notifPrefs.media?.hapticEnabled ?? true)
                                ? 'text-brand-500 hover:bg-brand-500/10 active:scale-90'
                                : 'text-surface-400 cursor-not-allowed opacity-40'
                            }`}
                          >
                            <Play className="h-3.5 w-3.5" />
                          </button>
                          <Toggle
                            ariaLabel="Vibration feedback"
                            enabled={notifPrefs.media?.hapticEnabled ?? true}
                            onChange={(v) => setNotifPrefs((prev) => ({ ...prev, media: { ...(prev.media ?? {}), hapticEnabled: v } }))}
                          />
                        </div>
                      </motion.div>
                    </div>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Notification Events — Per-Channel Toggles */}
            <SectionCard gradient={CARD_GRADIENTS.notifications ?? 'from-purple-500 to-violet-400'}>
              <div className="p-5">
                <h2 className="text-surface-900 mb-1 flex items-center gap-2 text-base font-semibold">
                  <Bell className="text-surface-400 h-4 w-4" />
                  Notification Events
                </h2>
                <p className="text-surface-500 mb-4 text-xs">
                  Toggle each channel per event type. Unset channels use the global defaults above.
                </p>
                <div className="space-y-1">
                  {Object.keys(notifTypeMeta).map((key) => {
                    const k = key as keyof typeof notifTypeMeta;
                    const tc = (notifPrefs.typeChannels as Record<string, Partial<Record<ChannelKey, boolean>>> | undefined)?.[k] ?? {};
                    return (
                      <motion.div
                        key={key}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="border-surface-300/20 hover:border-brand-500/20 hover:bg-surface-200/40 group flex items-center justify-between rounded-xl border px-4 py-2.5 transition-all duration-200"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="text-surface-500 shrink-0">{notifTypeMeta[k]!.icon}</div>
                          <div className="min-w-0">
                            <p className="text-surface-900 text-sm font-medium">
                              {notifTypeMeta[k]!.label}
                            </p>
                            <p className="text-surface-500 hidden truncate text-xs sm:block">
                              {notifTypeMeta[k]!.description}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
                          {/* In-app */}
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-surface-400 text-[9px] font-medium uppercase tracking-wider">In-app</span>
                            <Toggle
                              ariaLabel={`${notifTypeMeta[k]!.label}: in-app`}
                              enabled={tc.inApp ?? true}
                              onChange={(v) => updateTypeChannel(k, 'inApp', v)}
                            />
                          </div>
                          {/* Email */}
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-surface-400 text-[9px] font-medium uppercase tracking-wider">Email</span>
                            <Toggle
                              ariaLabel={`${notifTypeMeta[k]!.label}: email`}
                              enabled={tc.email ?? (notifPrefs.channels?.email ?? true)}
                              onChange={(v) => updateTypeChannel(k, 'email', v)}
                            />
                          </div>
                          {/* Push */}
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-surface-400 text-[9px] font-medium uppercase tracking-wider">Push</span>
                            <Toggle
                              ariaLabel={`${notifTypeMeta[k]!.label}: push`}
                              enabled={tc.push ?? false}
                              onChange={(v) => updateTypeChannel(k, 'push', v)}
                              disabled
                            />
                          </div>
                          {/* Slack */}
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-surface-400 text-[9px] font-medium uppercase tracking-wider">Slack</span>
                            <Toggle
                              ariaLabel={`${notifTypeMeta[k]!.label}: Slack`}
                              enabled={tc.slack ?? (notifPrefs.channels?.slack ?? false)}
                              onChange={(v) => updateTypeChannel(k, 'slack', v)}
                            />
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </SectionCard>

            {/* Digest */}
            <SectionCard gradient={CARD_GRADIENTS.notifications ?? 'from-purple-500 to-violet-400'}>
              <div className="p-5">
                <h2 className="text-surface-900 mb-4 flex items-center gap-2 text-base font-semibold">
                  <BookOpen className="text-surface-400 h-4 w-4" />
                  Email Digest
                </h2>
                <div className="space-y-4">
                  <div className="border-surface-300/20 hover:border-brand-500/20 hover:bg-surface-200/40 flex items-center justify-between rounded-xl border px-4 py-3 transition-all duration-200">
                    <div className="flex items-center gap-3">
                      <Mail className="text-surface-500 h-4 w-4" />
                      <div>
                        <p className="text-surface-900 text-sm font-medium">Send digest email</p>
                        <p className="text-surface-500 text-xs">Receive a summary of unread notifications</p>
                      </div>
                    </div>
                    <Toggle
                      ariaLabel="Send digest email"
                      enabled={notifPrefs.digest?.enabled ?? false}
                      onChange={(v) => setNotifPrefs((prev) => ({ ...prev, digest: { ...(prev.digest ?? {}), enabled: v } }))}
                    />
                  </div>

                  {notifPrefs.digest?.enabled && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="flex items-center gap-3 pl-7"
                    >
                      <label className="text-surface-500 text-xs font-medium uppercase tracking-wider">Frequency</label>
                      <select
                        aria-label="Digest frequency"
                        value={notifPrefs.digest?.frequency ?? 'daily'}
                        onChange={(e) => setNotifPrefs((prev) => ({ ...prev, digest: { ...(prev.digest ?? {}), frequency: e.target.value as 'daily' | 'weekly' | 'never' } }))}
                        className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 rounded-xl border px-3 py-2 text-sm transition-all focus:outline-none focus:ring-2"
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="never">Never</option>
                      </select>
                    </motion.div>
                  )}
                </div>
              </div>
            </SectionCard>

            {/* Save */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {notifPrefsError && (
                  <div className="bg-error/5 text-error flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {notifPrefsError}
                  </div>
                )}
                {notifPrefsSaved && (
                  <div className="bg-success/10 text-success flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                    <Check className="h-4 w-4 shrink-0" />
                    Preferences saved
                  </div>
                )}
              </div>
              <Button onClick={saveNotifPrefs} disabled={notifPrefsSaving} className="h-8 rounded-lg px-3 text-xs">
                {notifPrefsSaving ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1 h-3.5 w-3.5" />
                )}
                Save Preferences
              </Button>
            </div>

            {/* Keyboard hint */}
            <div className="flex items-center justify-center gap-2 text-[10px] text-surface-400">
              <span>Tab shortcuts:</span>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <kbd key={n} className="bg-surface-200/50 rounded-md px-1.5 py-0.5 font-mono">{n}</kbd>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Role Dialog */}
      <AnimatePresence>
        {showRoleDialog && (
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
              className="border-surface-300/30 bg-surface-50/95 w-full max-w-lg rounded-2xl border p-6 shadow-lg backdrop-blur-xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-surface-900 text-lg font-semibold">
                  {editingRole ? 'Edit Role' : 'Create Role'}
                </h3>
                <button onClick={() => setShowRoleDialog(false)} className="text-surface-500 hover:bg-surface-200/70 hover:text-surface-600 rounded-lg p-1.5 transition-all">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-4">
                <FormField label="Name" htmlFor="role-name">
                  <input
                    id="role-name"
                    type="text"
                    value={roleForm.name}
                    onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value, slug: editingRole ? roleForm.slug : e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                    placeholder="e.g. Project Manager"
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </FormField>
                <FormField label="Slug" htmlFor="role-slug">
                  <input
                    id="role-slug"
                    type="text"
                    value={roleForm.slug}
                    onChange={(e) => setRoleForm({ ...roleForm, slug: e.target.value })}
                    placeholder="e.g. project-manager"
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </FormField>
                <FormField label="Description" htmlFor="role-description">
                  <input
                    id="role-description"
                    type="text"
                    value={roleForm.description}
                    onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
                    placeholder="Optional description"
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </FormField>
                <div>
                  <label className="text-surface-500 mb-2 block text-xs font-semibold uppercase tracking-wider">Permissions</label>
                  <div className="border-surface-300/30 max-h-64 space-y-3 overflow-y-auto rounded-xl border p-3">
                    {Object.entries(groupedPermissions).map(([module, perms]) => (
                      <div key={module}>
                        <p className={`mb-1.5 inline-block rounded-lg px-1.5 py-0.5 text-xs font-semibold uppercase ${moduleColors[module] ?? 'bg-surface-200 text-surface-500'}`}>
                          {moduleLabels[module] ?? module}
                        </p>
                        <div className="grid grid-cols-2 gap-1">
                          {perms.map((perm) => (
                            <label key={perm.id} className="hover:bg-surface-200/50 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors">
                              <input
                                type="checkbox"
                                checked={selectedPermissionIds.includes(perm.id)}
                                onChange={() => togglePermission(perm.id)}
                                className="border-surface-400 text-brand-500 focus:ring-brand-500 rounded"
                              />
                              <span className="text-surface-600 ">{perm.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                    {permissions.length === 0 && (
                      <p className="text-surface-500 py-4 text-center text-sm">No permissions defined.</p>
                    )}
                  </div>
                </div>
                {roleError && (
                  <div className="bg-error/5 text-error flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {roleError}
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setShowRoleDialog(false)} className="rounded-lg">Cancel</Button>
                  <Button onClick={saveRole} disabled={savingRole} className="rounded-lg">
                    {savingRole ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
                    {editingRole ? 'Update' : 'Create'}
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
              <div className="mb-4 flex items-center gap-3">
                <div className="bg-error/10 flex h-10 w-10 items-center justify-center rounded-full">
                  <AlertCircle className="text-error h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-surface-900 text-lg font-semibold">Delete Role</h3>
                  <p className="text-surface-500 text-sm">Are you sure? This action cannot be undone.</p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} className="rounded-lg">Cancel</Button>
                <Button variant="destructive" onClick={deleteRole} className="rounded-lg">
                  <Trash2 className="mr-1 h-4 w-4" /> Delete
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
