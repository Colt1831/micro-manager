'use client';

import { FormEvent, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authClient } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

export function SecuritySettings() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    <form onSubmit={submit} className="mt-5 max-w-lg space-y-4">
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
  );
}
