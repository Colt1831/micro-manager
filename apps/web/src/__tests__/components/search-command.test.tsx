import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchCommand } from '@/components/layout/search-command';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('@/components/layout/sidebar', () => ({
  navItems: [
    { label: 'Dashboard', href: '/', icon: () => null },
    { label: 'Tasks', href: '/tasks', icon: () => null },
    { label: 'Projects', href: '/projects', icon: () => null },
  ],
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function mockSearchResponse() {
  mockFetch.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        results: {
          tasks: {
            hits: [
              {
                id: 't1',
                type: 'task',
                title: 'Test Task',
                subtitle: 'TASK-1',
                description: null,
                status: 'open',
                url: '/tasks/t1',
                metadata: {},
              },
            ],
            total: 1,
          },
          projects: {
            hits: [
              {
                id: 'p1',
                type: 'project',
                title: 'Test Project',
                subtitle: 'PRJ',
                description: null,
                status: 'active',
                url: '/projects/p1',
                metadata: {},
              },
            ],
            total: 1,
          },
          users: {
            hits: [
              {
                id: 'u1',
                type: 'user',
                title: 'Test User',
                subtitle: 'test@example.com',
                description: null,
                status: 'active',
                url: '/users/u1',
                metadata: {},
              },
            ],
            total: 1,
          },
          comments: {
            hits: [
              {
                id: 'c1',
                type: 'comment',
                title: 'Test Task',
                subtitle: 'TASK-1',
                description: 'A matching comment body',
                status: null,
                url: '/tasks/t1#comment-c1',
                metadata: { taskId: 't1' },
              },
            ],
            total: 1,
          },
        },
        total: 4,
        query: 'test',
      }),
    ),
  );
}

describe('SearchCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<SearchCommand open={false} onOpenChange={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders search input when open', () => {
    render(<SearchCommand open={true} onOpenChange={vi.fn()} />);
    expect(
      screen.getByPlaceholderText(/search tasks, projects, people, or type a command/i),
    ).toBeInTheDocument();
  });

  it('shows navigation commands when no query', () => {
    render(<SearchCommand open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Jump to')).toBeInTheDocument();
  });

  it('shows action commands when no query', () => {
    render(<SearchCommand open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText('New Task')).toBeInTheDocument();
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Switch to Dark Mode')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('fetches cross-entity search results on input', async () => {
    mockSearchResponse();

    render(<SearchCommand open={true} onOpenChange={vi.fn()} />);
    const input = screen.getByPlaceholderText(/search tasks, projects, people, or type a command/i);
    input.focus();
    await userEvent.type(input, 'test');

    vi.advanceTimersByTime(300);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/search?type=all&q=test&limit=5',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Test Task')).toBeInTheDocument();
      expect(screen.getByText('Test Project')).toBeInTheDocument();
      expect(screen.getByText('Test User')).toBeInTheDocument();
      expect(screen.getByText('A matching comment body')).toBeInTheDocument();
    });
  });

  it('resets query, results, and selection when reopened', async () => {
    mockSearchResponse();
    const { rerender } = render(
      <SearchCommand open={true} onOpenChange={vi.fn()} />,
    );
    const input = screen.getByPlaceholderText(
      /search tasks, projects, people, or type a command/i,
    );
    input.focus();
    await userEvent.type(input, 'test');
    vi.advanceTimersByTime(300);
    await waitFor(() => {
      expect(screen.getByText('Test Task')).toBeInTheDocument();
    });

    // Close then reopen
    rerender(<SearchCommand open={false} onOpenChange={vi.fn()} />);
    rerender(<SearchCommand open={true} onOpenChange={vi.fn()} />);

    // Query wiped, no stale search results, nav commands back
    const reopenedInput = screen.getByPlaceholderText(
      /search tasks, projects, people, or type a command/i,
    );
    expect(reopenedInput).toHaveValue('');
    expect(screen.queryByText('Test Task')).not.toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();

    // Selection reset — Enter runs the first command (Dashboard) again
    reopenedInput.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('navigates to selected command on Enter', async () => {
    render(<SearchCommand open={true} onOpenChange={vi.fn()} />);
    const input = screen.getByPlaceholderText(/search tasks, projects, people, or type a command/i);
    input.focus();

    // First visible item is Dashboard (first nav item) — selected by default
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('closes on Escape', async () => {
    const onOpenChange = vi.fn();
    render(<SearchCommand open={true} onOpenChange={onOpenChange} />);
    const input = screen.getByPlaceholderText(/search tasks, projects, people, or type a command/i);
    input.focus();

    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows close keyboard hint in footer', () => {
    render(<SearchCommand open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText('Esc')).toBeInTheDocument();
  });

  it('shows navigation footer', () => {
    render(<SearchCommand open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText('Navigate')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
  });
});
