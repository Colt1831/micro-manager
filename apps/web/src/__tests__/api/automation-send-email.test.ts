import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────────
// vi.hoisted — runs BEFORE the vi.mock factories.
// ──────────────────────────────────────────────────────────────

const { mockSendEmail, mockRender, mockDbSelect, mockDb } = vi.hoisted(() => ({
  mockSendEmail: vi.fn().mockResolvedValue({ id: 'email-1' }),
  mockRender: vi.fn().mockResolvedValue('<html><body>Test email</body></html>'),
  mockDbSelect: vi.fn(),
  mockDb: vi.fn(),
}));

// ──────────────────────────────────────────────────────────────
// Module-level mocks
// ──────────────────────────────────────────────────────────────

vi.mock('@/lib/email', () => ({
  sendEmail: mockSendEmail,
}));

vi.mock('@react-email/components', () => ({
  render: mockRender,
}));

vi.mock('@/lib/email/components', () => ({
  AutomationTriggeredEmail: vi.fn(() => null),
}));

// actions.ts now resolves users via db() from @/lib/api/db (org-scoped lookups).
vi.mock('@/lib/api/db', () => ({
  db: mockDb,
  schema: {
    users: {
      id: 'users.id',
      email: 'users.email',
      organizationId: 'users.organizationId',
      isActive: 'users.isActive',
      deletedAt: 'users.deletedAt',
    },
  },
}));

// The shared task-mutation service isn't exercised by send_email; stub it so the
// static import doesn't pull the whole mutation graph into this focused test.
vi.mock('@/lib/tasks/mutate', () => ({
  mutateTask: vi.fn().mockResolvedValue({ ok: true, task: {} }),
  SYSTEM_SCOPE: { rank: 'super_admin', level: 100, departmentId: null, seeAllDepartments: true },
}));

// ──────────────────────────────────────────────────────────────
// Imports
// ──────────────────────────────────────────────────────────────

import { executeAction } from '@/lib/automation/actions';
import type { AutomationContext } from '@/lib/automation/engine';

// ──────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────

const BASE_CONTEXT: AutomationContext = {
  organizationId: 'org-1',
  triggeredByUserId: 'user-1',
  entityType: 'task',
  entityId: 'task-42',
  data: {
    id: 'task-42',
    title: 'Test Task',
    status: 'open',
  },
};

function buildDbChain(resolveValue: unknown) {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: unknown) => void) => {
      resolve(resolveValue);
    },
  };
  const METHODS = ['select', 'from', 'where', 'limit', 'offset', 'orderBy', 'leftJoin', 'innerJoin', 'values', 'set', 'insert', 'update', 'delete'];
  for (const method of METHODS) {
    (chain as unknown as Record<string, unknown>)[method] = vi.fn(() => chain);
  }
  (chain as unknown as Record<string, unknown>).returning = vi.fn(() => Promise.resolve(resolveValue));
  return chain as unknown as Record<string, (...args: unknown[]) => unknown> & { then: (resolve: (value: unknown) => void) => void };
}

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.mockImplementation(() => ({ select: mockDbSelect }));
});

describe('executeAction — send_email', () => {
  it('sends an email to direct email addresses', async () => {
    await executeAction(
      {
        type: 'send_email',
        config: {
          to: ['user@example.com'],
          subject: 'Test Subject',
          message: 'Test message body',
        },
      },
      BASE_CONTEXT,
    );

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Test Subject',
      html: '<html><body>Test email</body></html>',
    });
    expect(mockRender).toHaveBeenCalledTimes(1);
  });

  it('sends to multiple email addresses', async () => {
    await executeAction(
      {
        type: 'send_email',
        config: {
          to: ['alice@example.com', 'bob@example.com'],
          subject: 'Multiple Recipients',
          message: 'Message to multiple',
        },
      },
      BASE_CONTEXT,
    );

    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockSendEmail).toHaveBeenNthCalledWith(1, {
      to: 'alice@example.com',
      subject: 'Multiple Recipients',
      html: expect.any(String),
    });
    expect(mockSendEmail).toHaveBeenNthCalledWith(2, {
      to: 'bob@example.com',
      subject: 'Multiple Recipients',
      html: expect.any(String),
    });
  });

  it('looks up user emails from userIds and sends to them', async () => {
    // Mock DB to return users with emails
    const dbChain = buildDbChain([
      { email: 'found-user@example.com' },
      { email: 'second-user@example.com' },
    ]);
    mockDbSelect.mockReturnValue(dbChain);

    await executeAction(
      {
        type: 'send_email',
        config: {
          userIds: ['user-1', 'user-2'],
          subject: 'Via User IDs',
          message: 'Sent via user ID lookup',
        },
      },
      BASE_CONTEXT,
    );

    expect(mockDb).toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockSendEmail).toHaveBeenNthCalledWith(1, {
      to: 'found-user@example.com',
      subject: 'Via User IDs',
      html: expect.any(String),
    });
    expect(mockSendEmail).toHaveBeenNthCalledWith(2, {
      to: 'second-user@example.com',
      subject: 'Via User IDs',
      html: expect.any(String),
    });
  });

  it('sends to both direct emails and user IDs combined', async () => {
    const dbChain = buildDbChain([{ email: 'looked-up@example.com' }]);
    mockDbSelect.mockReturnValue(dbChain);

    await executeAction(
      {
        type: 'send_email',
        config: {
          to: ['direct@example.com'],
          userIds: ['user-3'],
          subject: 'Combined',
          message: 'Both direct and looked up',
        },
      },
      BASE_CONTEXT,
    );

    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockSendEmail).toHaveBeenNthCalledWith(1, {
      to: 'direct@example.com',
      subject: 'Combined',
      html: expect.any(String),
    });
    expect(mockSendEmail).toHaveBeenNthCalledWith(2, {
      to: 'looked-up@example.com',
      subject: 'Combined',
      html: expect.any(String),
    });
  });

  it('skips user IDs that have no email', async () => {
    const dbChain = buildDbChain([
      { email: 'has-email@example.com' },
      { email: null }, // User without email
    ]);
    mockDbSelect.mockReturnValue(dbChain);

    await executeAction(
      {
        type: 'send_email',
        config: {
          userIds: ['user-1', 'user-2'],
          subject: 'Skip Missing Emails',
          message: 'Should skip users without email',
        },
      },
      BASE_CONTEXT,
    );

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'has-email@example.com',
      subject: 'Skip Missing Emails',
      html: expect.any(String),
    });
  });

  it('appends entity link to email in the rendered HTML', async () => {
    await executeAction(
      {
        type: 'send_email',
        config: {
          to: ['user@example.com'],
          subject: 'Entity Link Test',
          message: 'Check entity link',
        },
      },
      BASE_CONTEXT,
    );

    // The render function should be called with props that include the entity link
    const renderCall = mockRender.mock.calls[0]![0];
    expect(renderCall).toBeDefined();
    expect(renderCall.props).toBeDefined();
    expect(renderCall.props.link).toContain('task-42');
  });

  it('throws when no subject is provided', async () => {
    await expect(
      executeAction(
        {
          type: 'send_email',
          config: {
            to: ['user@example.com'],
            subject: '',
            message: 'Has message but no subject',
          },
        },
        BASE_CONTEXT,
      ),
    ).rejects.toThrow('Email subject is required');
  });

  it('throws when no message is provided', async () => {
    await expect(
      executeAction(
        {
          type: 'send_email',
          config: {
            to: ['user@example.com'],
            subject: 'Has subject',
            message: '',
          },
        },
        BASE_CONTEXT,
      ),
    ).rejects.toThrow('Email message is required');
  });

  it('throws when no recipients are specified', async () => {
    await expect(
      executeAction(
        {
          type: 'send_email',
          config: {
            subject: 'No Recipients',
            message: 'Has subject and message but no recipients',
          },
        },
        BASE_CONTEXT,
      ),
    ).rejects.toThrow('No recipients specified for email');
  });

  it('throws when userIds lookup returns no valid emails', async () => {
    const dbChain = buildDbChain([{ email: null }]);
    mockDbSelect.mockReturnValue(dbChain);

    await expect(
      executeAction(
        {
          type: 'send_email',
          config: {
            userIds: ['user-no-email'],
            subject: 'No Valid Emails',
            message: 'User ID lookup yields no emails',
          },
        },
        BASE_CONTEXT,
      ),
    ).rejects.toThrow('No recipients specified for email');
  });

  it('continues sending to remaining recipients if one fails', async () => {
    mockSendEmail
      .mockRejectedValueOnce(new Error('SMTP error'))
      .mockResolvedValueOnce({ id: 'email-2' });

    await executeAction(
      {
        type: 'send_email',
        config: {
          to: ['fail@example.com', 'success@example.com'],
          subject: 'Partial Failure',
          message: 'One should fail, the other should succeed',
        },
      },
      BASE_CONTEXT,
    );

    // The action shouldn't throw for per-recipient failures
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockSendEmail).toHaveBeenNthCalledWith(1, {
      to: 'fail@example.com',
      subject: 'Partial Failure',
      html: expect.any(String),
    });
    expect(mockSendEmail).toHaveBeenNthCalledWith(2, {
      to: 'success@example.com',
      subject: 'Partial Failure',
      html: expect.any(String),
    });
  });

  it('uses the correct entity link format in the AutomationContext', async () => {
    const taskContext: AutomationContext = {
      ...BASE_CONTEXT,
      entityType: 'task',
      entityId: 'task-99',
    };

    await executeAction(
      {
        type: 'send_email',
        config: {
          to: ['user@example.com'],
          subject: 'Link Format',
          message: 'Check link format',
        },
      },
      taskContext,
    );

    const renderCall = mockRender.mock.calls[0]![0];
    expect(renderCall.props.link).toContain('/tasks/task-99');
  });
});
