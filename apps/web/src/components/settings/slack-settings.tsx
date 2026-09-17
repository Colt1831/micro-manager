'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Loader2,
  Check,
  AlertCircle,
  Trash2,
  MessageSquare,
  Link,
  Send,
  TestTube,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────

interface SlackIntegration {
  id: string;
  channelName: string | null;
  isActive: boolean;
  lastUsedAt: string | null;
  lastError: string | null;
  hasWebhookUrl: boolean;
  createdAt: string;
}

interface TestResult {
  success: boolean;
  error?: string;
}

// ─── Animation variants ─────────────────────────────────────

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } },
} as const;

// ─── Helpers ────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ═══════════════════════════════════════════════════════════════
//  SLACK SETTINGS COMPONENT
// ═══════════════════════════════════════════════════════════════

export function SlackSettings() {
  const [integration, setIntegration] = useState<SlackIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<TestResult | null>(null);

  // ── Fetch integration ──────────────────────────────────

  const fetchIntegration = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/slack');
      if (!res.ok) throw new Error('Failed to load Slack integration');
      const data = await res.json();
      setIntegration(data.integration ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchIntegration();
  }, [fetchIntegration]);

  // ── Test webhook ───────────────────────────────────────

  const testWebhook = async () => {
    if (!webhookUrl.trim()) return;
    
    setTesting(true);
    setTestResult(null);
    
    try {
      const res = await fetch('/api/settings/slack/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: webhookUrl.trim() }),
      });
      
      const result: TestResult = await res.json();
      setTestResult(result);
    } catch {
      setTestResult({ success: false, error: 'Request failed' });
    } finally {
      setTesting(false);
    }
  };

  // ── Save webhook ───────────────────────────────────────

  const saveWebhook = async () => {
    if (!webhookUrl.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/settings/slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: webhookUrl.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message ?? 'Failed to save');
      }

      const data = await res.json();
      setIntegration(data.integration);
      setWebhookUrl('');
      setTestResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete integration ─────────────────────────────────

  const deleteIntegration = async () => {
    setDeleting(true);
    try {
      const res = await fetch('/api/settings/slack', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      setIntegration(null);
      setShowDeleteConfirm(false);
    } catch {
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  // ── Send preview notification ──────────────────────────

  const sendPreview = async () => {
    setPreviewing(true);
    setPreviewResult(null);

    try {
      const res = await fetch('/api/settings/slack/preview', {
        method: 'POST',
      });

      const result: TestResult = await res.json();
      setPreviewResult(result);
    } catch {
      setPreviewResult({ success: false, error: 'Request failed' });
    } finally {
      setPreviewing(false);
    }
  };

  // ── Render: Loading ────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="shimmer h-28 rounded-2xl" />
        ))}
      </div>
    );
  }

  // ── Render: Error ──────────────────────────────────────

  if (error && !integration) {
    return (
      <div className="flex flex-col items-center py-12">
        <AlertCircle className="text-error mb-2 h-8 w-8" />
        <p className="text-error text-sm">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={fetchIntegration}>
          Retry
        </Button>
      </div>
    );
  }

  // ── Render: Main ───────────────────────────────────────

  return (
    <motion.div variants={itemVariants}>
      {/* Header */}
      <div className="mb-4">
        <p className="text-surface-500 text-sm">
          Send notifications to Slack when tasks are created, updated, or commented on.
        </p>
      </div>

      {/* Existing Integration */}
      {integration ? (
        <div className="space-y-4">
          {/* Integration Card */}
          <div className="border-surface-300/20 bg-surface-100/80 relative overflow-hidden rounded-2xl border transition-all duration-200 hover:shadow-sm">
            
            
            <div className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#4A154B]/10">
                    <MessageSquare className="h-4 w-4 text-[#4A154B]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-surface-900 text-sm font-semibold">
                        Slack Integration
                      </h3>
                      <Badge
                        variant={integration.isActive ? 'success' : 'default'}
                        size="sm"
                        className="px-1.5 py-0 text-[9px]"
                      >
                        {integration.isActive ? 'Active' : 'Disabled'}
                      </Badge>
                    </div>
                    <p className="text-surface-500 mt-0.5 flex items-center gap-1 truncate text-xs font-mono">
                      <Link className="h-3 w-3 shrink-0" />
                      {integration.channelName ?? 'Slack Webhook'}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {integration.lastUsedAt && (
                    <span
                      className="text-success text-[10px]"
                      title={`Last used: ${formatDate(integration.lastUsedAt)}`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                  {integration.lastError && (
                    <span
                      className="text-error text-[10px]"
                      title={`Last error: ${integration.lastError}`}
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    aria-label="Disconnect Slack"
                    title="Disconnect Slack"
                    className="text-surface-500 hover:text-error hover:bg-error/5 rounded-lg p-1.5 transition-all"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Meta */}
              <div className="text-surface-400 mt-2 flex items-center gap-3 border-t border-surface-300/10 pt-2 text-[10px]">
                <span>Connected {formatDate(integration.createdAt)}</span>
                <span>·</span>
                <span>All task events</span>
              </div>
            </div>
          </div>

          {/* Preview Result */}
          <AnimatePresence>
            {previewResult && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className={cn(
                  'flex items-start gap-2 rounded-xl border px-3 py-2 text-xs',
                  previewResult.success
                    ? 'border-success/30 bg-success/5 text-success'
                    : 'border-error/30 bg-error/5 text-error',
                )}
              >
                <div className="mt-0.5">
                  {previewResult.success ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5" />
                  )}
                </div>
                <div>
                  <p className="font-medium">
                    {previewResult.success ? 'Preview sent! Check your Slack channel.' : 'Preview failed'}
                  </p>
                  {previewResult.error && (
                    <p className="mt-0.5 text-[10px] opacity-80">{previewResult.error}</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={sendPreview}
              disabled={previewing}
              className="h-8 rounded-lg px-3 text-xs"
            >
              {previewing ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1 h-3.5 w-3.5" />
              )}
              Send Preview
            </Button>
          </div>

          {/* Setup Instructions */}
          <div className="border-surface-300/20 bg-surface-100/50 rounded-2xl border p-4">
            <h4 className="text-surface-900 mb-2 text-sm font-semibold">
              How to set up Slack notifications
            </h4>
            <ol className="text-surface-500 space-y-2 text-xs">
              <li className="flex items-start gap-2">
                <span className="text-brand-500 mt-0.5 font-semibold">1.</span>
                <span>Go to <strong>Slack → Apps → Incoming Webhooks</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-500 mt-0.5 font-semibold">2.</span>
                <span>Click <strong>Add to Slack</strong> and choose a channel</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-500 mt-0.5 font-semibold">3.</span>
                <span>Copy the webhook URL and paste it in Settings → Integrations → Slack</span>
              </li>
            </ol>
          </div>
        </div>
      ) : (
        /* No Integration - Show Setup Form */
        <div className="space-y-4">
          {/* Setup Card */}
          <div className="border-surface-300/20 bg-surface-100/80 relative overflow-hidden rounded-2xl border">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-surface-300 to-surface-400 opacity-40" />
            
            <div className="p-4">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4A154B]/10">
                  <MessageSquare className="h-5 w-5 text-[#4A154B]" />
                </div>
                <div>
                  <h3 className="text-surface-900 text-sm font-semibold">
                    Connect Slack
                  </h3>
                  <p className="text-surface-500 text-xs">
                    Send task notifications to your Slack channel
                  </p>
                </div>
              </div>

              {/* Webhook URL Input */}
              <div className="space-y-3">
                <div>
                  <label className="text-surface-500 mb-1 block text-xs font-semibold uppercase tracking-wider">
                    Webhook URL
                  </label>
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => {
                      setWebhookUrl(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder="https://hooks.slack.com/services/..."
                    className="border-surface-300/30 bg-surface-100 focus:border-brand-500 focus:ring-brand-500/20 w-full rounded-xl border px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2"
                  />
                </div>

                {/* Test Result */}
                <AnimatePresence>
                  {testResult && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className={cn(
                        'flex items-start gap-2 rounded-xl border px-3 py-2 text-xs',
                        testResult.success
                          ? 'border-success/30 bg-success/5 text-success'
                          : 'border-error/30 bg-error/5 text-error',
                      )}
                    >
                      <div className="mt-0.5">
                        {testResult.success ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">
                          {testResult.success ? 'Test message sent!' : 'Test failed'}
                        </p>
                        {testResult.error && (
                          <p className="mt-0.5 text-[10px] opacity-80">{testResult.error}</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Error */}
                {error && (
                  <div className="bg-error/5 text-error flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={testWebhook}
                    disabled={!webhookUrl.trim() || testing}
                    className="h-8 rounded-lg px-3 text-xs"
                  >
                    {testing ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <TestTube className="mr-1 h-3.5 w-3.5" />
                    )}
                    Test
                  </Button>
                  <Button
                    onClick={saveWebhook}
                    disabled={!webhookUrl.trim() || saving}
                    size="sm"
                    className="h-8 rounded-lg px-3 text-xs"
                  >
                    {saving ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="mr-1 h-3.5 w-3.5" />
                    )}
                    Connect
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Setup Instructions */}
          <div className="border-surface-300/20 bg-surface-100/50 rounded-2xl border p-4">
            <h4 className="text-surface-900 mb-2 text-sm font-semibold">
              How to get a Slack webhook URL
            </h4>
            <ol className="text-surface-500 space-y-2 text-xs">
              <li className="flex items-start gap-2">
                <span className="text-brand-500 mt-0.5 font-semibold">1.</span>
                <span>Go to <strong>Slack → Apps → Incoming Webhooks</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-500 mt-0.5 font-semibold">2.</span>
                <span>Click <strong>Add to Slack</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-500 mt-0.5 font-semibold">3.</span>
                <span>Choose a channel to receive notifications</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-500 mt-0.5 font-semibold">4.</span>
                <span>Copy the <strong>Webhook URL</strong> and paste it above</span>
              </li>
            </ol>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
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
                  <h3 className="text-surface-900 text-lg font-semibold">
                    Disconnect Slack
                  </h3>
                  <p className="text-surface-500 text-sm">
                    Are you sure? Notifications will stop being sent to Slack.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="rounded-lg"
                >
                  Cancel
                </Button>
                <Button
                  onClick={deleteIntegration}
                  disabled={deleting}
                  className="rounded-lg bg-red-500 text-white hover:bg-red-600"
                >
                  {deleting ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1 h-4 w-4" />
                  )}
                  Disconnect
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
