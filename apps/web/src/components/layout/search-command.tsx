'use client';

import { useState, useEffect, useCallback, useMemo, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Search,
  Loader2,
  ArrowRight,
  FileText,
  Plus,
  Sun,
  Moon,
  Keyboard,
  ListTodo,
  FolderKanban,
  User,
  MessageSquare,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { navItems } from './sidebar';

// ─── Types ──────────────────────────────────────────────────

interface SearchHit {
  id: string;
  type: 'task' | 'project' | 'user' | 'comment';
  title: string;
  subtitle: string | null;
  description: string | null;
  status: string | null;
  url: string;
  metadata: Record<string, unknown>;
}

interface SearchApiResponse {
  results: {
    tasks: { hits: SearchHit[]; total: number };
    projects: { hits: SearchHit[]; total: number };
    users: { hits: SearchHit[]; total: number };
    comments: { hits: SearchHit[]; total: number };
  };
  total: number;
  query: string;
}

type PaletteItemType = 'command' | 'task' | 'project' | 'user' | 'comment';

interface PaletteItem {
  id: string;
  type: PaletteItemType;
  group: string;
  label: string;
  sublabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  action?: () => void;
  badge?: string;
}

// ─── Status colors (shared with search results) ─────────────

const statusColorMap: Record<string, string> = {
  draft: 'bg-surface-200 text-surface-600 ',
  open: 'bg-blue-100 text-blue-700 ',
  in_progress: 'bg-yellow-100 text-yellow-700 ',
  blocked: 'bg-red-100 text-red-700 ',
  under_review: 'bg-cyan-100 text-cyan-700 ',
  on_hold: 'bg-orange-100 text-orange-700 ',
  completed: 'bg-green-100 text-green-700 ',
  closed: 'bg-surface-100 text-surface-600 ',
  cancelled: 'bg-surface-100 text-surface-500 ',
};

// ─── Props ──────────────────────────────────────────────────

interface SearchCommandProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Component ──────────────────────────────────────────────

export function SearchCommand({ open, onOpenChange }: SearchCommandProps) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PaletteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset to a clean slate every time the palette opens — never remember the
  // last search. React-documented "adjust state during render" pattern: store
  // the previous `open` value in state and, when it transitions to open, wipe
  // the query, results, and selection. This runs during render (guarded by the
  // prevOpen comparison) so it's safe for the react-hooks compiler rules.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setQuery('');
      setItems([]);
      setLoading(false);
      setError(null);
      setSelectedIndex(0);
    }
  }

  // ── Static commands: navigation + actions ───────────────
  const baseCommands = useMemo<PaletteItem[]>(() => {
    const navigation: PaletteItem[] = navItems.map((item) => ({
      id: `nav-${item.href}`,
      type: 'command',
      group: 'Jump to',
      label: item.label,
      icon: item.icon,
      href: item.href,
    }));

    const actions: PaletteItem[] = [
      {
        id: 'action-new-task',
        type: 'command',
        group: 'Actions',
        label: 'New Task',
        sublabel: '⌘T',
        icon: Plus,
        action: () => window.dispatchEvent(new CustomEvent('open-quick-create')),
      },
      {
        id: 'action-shortcuts',
        type: 'command',
        group: 'Actions',
        label: 'Keyboard Shortcuts',
        sublabel: '?',
        icon: Keyboard,
        action: () => window.dispatchEvent(new CustomEvent('open-shortcuts')),
      },
      {
        id: 'action-theme',
        type: 'command',
        group: 'Actions',
        label: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        icon: theme === 'dark' ? Sun : Moon,
        action: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
    ];

    return [...navigation, ...actions];
  }, [theme, setTheme]);

  // ── Debounced cross-entity search ────────────────────────
  useEffect(() => {
    if (!query.trim()) {
      startTransition(() => {
        setItems([]);
        setLoading(false);
        setError(null);
      });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/search?type=all&q=${encodeURIComponent(query)}&limit=5`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error('Search failed');
        const data: SearchApiResponse = await res.json();
        // Discard stale responses that resolve after the query changed or the
        // palette closed/reopened (component stays mounted now).
        if (controller.signal.aborted) return;

        const searchItems: PaletteItem[] = [];
        data.results.tasks.hits.forEach((h) =>
          searchItems.push({
            id: `task-${h.id}`,
            type: 'task',
            group: 'Tasks',
            label: h.title,
            sublabel: h.subtitle ?? undefined,
            icon: ListTodo,
            href: h.url,
            badge: h.status ?? undefined,
          }),
        );
        data.results.projects.hits.forEach((h) =>
          searchItems.push({
            id: `project-${h.id}`,
            type: 'project',
            group: 'Projects',
            label: h.title,
            sublabel: h.subtitle ?? undefined,
            icon: FolderKanban,
            href: h.url,
            badge: h.status ?? undefined,
          }),
        );
        data.results.users.hits.forEach((h) =>
          searchItems.push({
            id: `user-${h.id}`,
            type: 'user',
            group: 'People',
            label: h.title,
            sublabel: h.subtitle ?? undefined,
            icon: User,
            href: h.url,
            badge: h.status ?? undefined,
          }),
        );
        data.results.comments.hits.forEach((h) =>
          searchItems.push({
            id: `comment-${h.id}`,
            type: 'comment',
            group: 'Comments',
            label: h.description ?? h.title,
            sublabel: h.subtitle ?? h.title,
            icon: MessageSquare,
            href: h.url,
          }),
        );

        startTransition(() => {
          setItems(searchItems);
          setLoading(false);
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Search failed');
        setItems([]);
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // ── Visible items: filtered commands + search hits ───────
  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return baseCommands;
    const filteredCommands = baseCommands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.sublabel ?? '').toLowerCase().includes(q),
    );
    return [...filteredCommands, ...items];
  }, [query, baseCommands, items]);

  // Clamp selection into the visible list on each render (render-time state
  // adjustment — avoids calling setState directly inside an effect).
  const activeIndex =
    visibleItems.length > 0
      ? Math.min(Math.max(selectedIndex, 0), visibleItems.length - 1)
      : -1;

  // Group visible items for rendering, keeping flat indices
  const grouped = useMemo(() => {
    const result: { group: string; items: { item: PaletteItem; index: number }[] }[] = [];
    visibleItems.forEach((item, index) => {
      const last = result[result.length - 1];
      if (!last || last.group !== item.group) {
        result.push({ group: item.group, items: [{ item, index }] });
      } else {
        last.items.push({ item, index });
      }
    });
    return result;
  }, [visibleItems]);

  // ── Actions ─────────────────────────────────────────────
  const runItem = useCallback(
    (item: PaletteItem) => {
      onOpenChange(false);
      if (item.action) {
        item.action();
      } else if (item.href) {
        router.push(item.href);
      }
    },
    [router, onOpenChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, visibleItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && activeIndex >= 0) {
        const item = visibleItems[activeIndex];
        if (item) {
          e.preventDefault();
          runItem(item);
        }
      } else if (e.key === 'Escape') {
        onOpenChange(false);
      }
    },
    [visibleItems, activeIndex, runItem, onOpenChange],
  );

  const noResults =
    !loading && !error && query.trim().length > 0 && visibleItems.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-surface-300/20 top-[12%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 shadow-xl sm:rounded-2xl">
        {/* Search input */}
        <div className="border-surface-300/20 flex items-center border-b px-4">
          <Search className="text-surface-400 h-4 w-4 shrink-0" />
          <input
            type="text"
            placeholder="Search tasks, projects, people, or type a command..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            autoFocus
            className="text-surface-900 placeholder:text-surface-400 flex-1 border-0 bg-transparent px-3 py-4 text-sm focus:outline-none"
          />
          {loading && <Loader2 className="text-surface-400 h-4 w-4 animate-spin" />}
          {!loading && query && (
            <kbd className="border-surface-300/20 bg-surface-100/80 text-surface-400 hidden rounded-lg border px-1.5 py-0.5 text-xs sm:inline-block">
              ESC
            </kbd>
          )}
        </div>

        {/* Results */}
        <div className="scrollbar-thin max-h-[420px] overflow-y-auto">
          {/* Loading skeleton */}
          {loading && visibleItems.length === 0 && (
            <div className="space-y-1 p-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="animate-skeleton-pulse flex items-center gap-3 rounded-xl px-3 py-2.5"
                >
                  <div className="bg-surface-300/50 h-4 w-20 rounded-lg" />
                  <div className="bg-surface-300/50 h-4 flex-1 rounded-lg" />
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && <div className="text-error px-6 py-4 text-center text-sm">{error}</div>}

          {/* Empty state */}
          {noResults && (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <FileText className="text-surface-300 h-8 w-8" />
              <p className="text-surface-500 text-sm">No results for &ldquo;{query}&rdquo;</p>
              <p className="text-surface-400 max-w-xs text-xs">
                Try a different search term.
              </p>
            </div>
          )}

          {/* Grouped items */}
          {visibleItems.length > 0 && (
            <div className="p-2">
              {grouped.map((group) => (
                <div key={group.group}>
                  <p className="text-surface-400 px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider">
                    {group.group}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map(({ item, index }) => (
                      <button
                        key={item.id}
                        onClick={() => runItem(item)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                          index === activeIndex
                            ? 'bg-brand-500/10 text-brand-400 '
                            : 'text-surface-700 hover:bg-surface-200/50 '
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <item.icon className="h-4 w-4 shrink-0" />
                          <div className="min-w-0">
                            <span className="block truncate">{item.label}</span>
                            {item.sublabel && (
                              <span className="text-surface-400 block truncate text-[11px]">
                                {item.sublabel}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="ml-3 flex shrink-0 items-center gap-2">
                          {item.badge && (
                            <span
                              className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                statusColorMap[item.badge] ??
                                'bg-surface-100 text-surface-600 '
                              }`}
                            >
                              {item.badge.replace(/_/g, ' ')}
                            </span>
                          )}
                          {index === activeIndex && (
                            <ArrowRight className="text-brand-500 h-3.5 w-3.5 shrink-0" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Initial hint (commands are listed above, keep this subtle) */}
          {!query && !loading && (
            <div className="text-surface-300 px-6 py-3 text-center text-[11px]">
              Start typing to search across tasks, projects, and people
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-surface-300/20 text-surface-400 hidden items-center gap-4 border-t px-4 py-2 text-xs sm:flex">
          <span className="flex items-center gap-1">
            <kbd className="border-surface-300/20 bg-surface-100/80 rounded-lg border px-1.5 py-0.5 text-[10px]">
              ↑↓
            </kbd>
            <span>Navigate</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="border-surface-300/20 bg-surface-100/80 rounded-lg border px-1.5 py-0.5 text-[10px]">
              ↵
            </kbd>
            <span>Open</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="border-surface-300/20 bg-surface-100/80 rounded-lg border px-1.5 py-0.5 text-[10px]">
              Esc
            </kbd>
            <span>Close</span>
          </span>
          {visibleItems.length > 0 && (
            <span className="text-surface-400 ml-auto text-[10px] tabular-nums">
              {visibleItems.length} result{visibleItems.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
