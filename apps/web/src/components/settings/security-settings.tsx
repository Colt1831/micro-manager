'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authClient } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

interface LoginRecord {
  id: string;
  ipAddress: string;
  userAgent: string | null;
  loginMethod: string | null;
  success: boolean;
  createdAt: string;
}

/** Truncate a user-agent to keep the list readable; full string is in the title. */
function shortUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  return ua.length > 60 ? `${ua.slice(0, 60)}…` : ua;
}

export function SecuritySettings() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [logins, setLogins] = useState<LoginRecord[] | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/login-history')
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => {
        if (active) setLogins(data.logins ?? []);
      })
      .catch(() => {
        if (active) setLogins([]);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmation) {
      setError('New passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setError(result.error.message || 'Could not update your password.');
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      toast({
        title: 'Password updated',
        description: 'Other signed-in devices have been logged out.',
      });
    } catch {
      setError('Could not update your password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-5 space-y-8">
      <form onSubmit={submit} className="max-w-lg space-y-4">
      <FormField label="Current password" htmlFor="current-password" required>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
        />
      </FormField>
      <FormField label="New password" htmlFor="new-password" required hint="Use at least 8 characters.">
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
        />
      </FormField>
      <FormField label="Confirm new password" htmlFor="confirm-password" required>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          required
        />
      </FormField>
      {error && <p role="alert" className="text-error text-xs">{error}</p>}
      <div className="flex items-center justify-between gap-4 pt-1">
        <p className="text-surface-500 text-xs">Updating your password signs out every other device.</p>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Update password
        </Button>
      </div>
      </form>

      <section className="max-w-lg">
        <h3 className="text-surface-900 text-sm font-medium">Recent sign-ins</h3>
        <p className="text-surface-500 mt-0.5 text-xs">Your last 20 successful sign-ins.</p>
        {logins === null ? (
          <div className="mt-3 flex items-center gap-2 text-surface-500 text-xs">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : logins.length === 0 ? (
          <p className="text-surface-500 mt-3 text-xs">No sign-ins recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-surface-200/60 rounded-lg border border-surface-200/60">
            {logins.map((login) => (
              <li key={login.id} className="flex items-center justify-between gap-4 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="text-surface-900">{new Date(login.createdAt).toLocaleString()}</p>
                  <p className="text-surface-500 truncate" title={login.userAgent ?? undefined}>
                    {shortUserAgent(login.userAgent)}
                  </p>
                </div>
                <span className="text-surface-500 shrink-0 font-mono">{login.ipAddress}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
