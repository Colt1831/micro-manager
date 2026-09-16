import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecuritySettings } from '@/components/settings/security-settings';

const { changePassword, toast } = vi.hoisted(() => ({
  changePassword: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/auth/client', () => ({
  authClient: { changePassword },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast }),
}));

describe('SecuritySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    changePassword.mockResolvedValue({ data: { status: true }, error: null });
  });

  it('changes the password and revokes other sessions', async () => {
    const user = userEvent.setup();
    render(<SecuritySettings />);

    await user.type(screen.getByLabelText(/^Current password/), 'old-password');
    await user.type(screen.getByLabelText(/^New password/), 'new-password');
    await user.type(screen.getByLabelText(/^Confirm new password/), 'new-password');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password',
      newPassword: 'new-password',
      revokeOtherSessions: true,
    });
    expect(toast).toHaveBeenCalledWith({
      title: 'Password updated',
      description: 'Other signed-in devices have been logged out.',
    });
    expect(screen.getByLabelText(/^Current password/)).toHaveValue('');
  });

  it('rejects mismatched confirmation before calling the auth API', async () => {
    const user = userEvent.setup();
    render(<SecuritySettings />);

    await user.type(screen.getByLabelText(/^Current password/), 'old-password');
    await user.type(screen.getByLabelText(/^New password/), 'new-password');
    await user.type(screen.getByLabelText(/^Confirm new password/), 'different-password');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(screen.getByRole('alert')).toHaveTextContent('New passwords do not match.');
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('shows an authentication error without blaming a password field', async () => {
    changePassword.mockResolvedValueOnce({ data: null, error: { message: 'Invalid current password.' } });
    const user = userEvent.setup();
    render(<SecuritySettings />);

    await user.type(screen.getByLabelText(/^Current password/), 'wrong-password');
    await user.type(screen.getByLabelText(/^New password/), 'new-password');
    await user.type(screen.getByLabelText(/^Confirm new password/), 'new-password');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid current password.');
    expect(screen.getByLabelText(/^Confirm new password/)).not.toHaveAttribute('aria-invalid', 'true');
  });
});
