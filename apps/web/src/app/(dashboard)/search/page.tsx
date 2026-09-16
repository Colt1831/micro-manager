'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Search,
  X,
  Loader2,
  ListTodo,
  FolderKanban,
  Users,
  ArrowRight,
  Sparkles,
  Command,
  Inbox,
  Hash,
  Bookmark,
  BookmarkPlus,
  Trash2,
  Filter,
  Calendar,
  MessageSquare,
} from 'lucide-react';

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

interface SearchResponse {
  results: {
    tasks: { hits: SearchHit[]; total: number };
    projects: { hits: SearchHit[]; total: number };
    users: { hits: SearchHit[]; total: number };
    comments: { hits: SearchHit[]; total: number };
  };
  total: number;
  query: string;
}

interface SavedSearch {
  id: string;
  name: string;
  query: string;
  type: string;
  filters: {
    status?: string;
    priority?: string;
    assignee?: string;
    dateRange?: { from?: string; to?: string };
  };
  createdAt: string;
}

type SearchTab = 'all' | 'tasks' | 'projects' | 'users' | 'comments';

// ─── Constants ──────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'None' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  open: { label: 'Open', color: 'text-blue-500 bg-blue-500/10' },
  in_progress: { label: 'In Progress', color: 'text-amber-500 bg-amber-500/10' },
  under_review: { label: 'Under Review', color: 'text-purple-500 bg-purple-500/10' },
  completed: { label: 'Completed', color: 'text-success bg-success/10' },
  blocked: { label: 'Blocked', color: 'text-error bg-error/10' },
  on_hold: { label: 'On Hold', color: 'text-orange-500 bg-orange-500/10' },
  cancelled: { label: 'Cancelled', color: 'text-surface-400 bg-surface-500/10' },
  active: { label: 'Active', color: 'text-success bg-success/10' },
  inactive: { label: 'Inactive', color: 'text-surface-400 bg-surface-500/10' },
  planning: { label: 'Planning', color: 'text-cyan-500 bg-cyan-500/10' },
  archived: { label: 'Archived', color: 'text-surface-400 bg-surface-500/10' },
};

function getStatusConfig(status: string | null) {
  return STATUS_CONFIG[status ?? ''] ?? { label: status ?? '—', color: 'text-surface-500 bg-surface-500/10' };
}

function getTypeIcon(type: string) {
  switch (type) {
    case 'task': return ListTodo;
    case 'project': return FolderKanban;
    case 'user': return Users;
    case 'comment': return MessageSquare;
    default: return Hash;
  }
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-brand-500/20 text-brand-500 rounded-sm px-0.5">{part}</mark>
    ) : (
      part
    ),
  );
}

// ─── Animation Variants ─────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.03 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } },
} as const;

// ═══════════════════════════════════════════════════════════════
//  SEARCH PAGE
// ═══════════════════════════════════════════════════════════════

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeTab, setActiveTab] = useState<SearchTab>('all');
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Advanced filters ──────────────────────────────────────
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<{
    status: string;
    priority: string;
    dateFrom: string;
    dateTo: string;
  }>({ status: '', priority: '', dateFrom: '', dateTo: '' });

  const hasActiveFilters = filters.status || filters.priority || filters.dateFrom || filters.dateTo;

  // ── Saved searches ────────────────────────────────────────
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [showSavedSearches, setShowSavedSearches] = useState(false);
  const [savingName, setSavingName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [savedSearchesLoading, setSavedSearchesLoading] = useState(false);

  // ── Load saved searches ────────────────────────────────────

  const loadSavedSearches = useCallback(async () => {
    setSavedSearchesLoading(true);
    try {
      const res = await fetch('/api/search/saved');
      if (res.ok) {
        const data = await res.json();
        setSavedSearches(data.searches ?? []);
      }
    } catch {
      // Silently fail
    } finally {
      setSavedSearchesLoading(false);
    }
  }, []);

   
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSavedSearches();
  }, [loadSavedSearches]);

  // ── Focus search input on mount and Cmd+K ──────────────────

   
  useEffect(() => {
    inputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── Debounce search query ──────────────────────────────────

   
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [query]);

  // ── Fetch results ──────────────────────────────────────────

  const fetchResults = useCallback(async (q: string, tab: SearchTab, f: typeof filters) => {
    if (!q.trim()) {
      setResults(null);
      setHasSearched(false);
      return;
    }

    setLoading(true);
    setHasSearched(true);

    try {
      const type = tab === 'all' ? 'all' : tab;
      const params = new URLSearchParams({
        q,
        type,
        limit: '8',
      });
      if (f.status) params.set('status', f.status);
      if (f.priority) params.set('priority', f.priority);

      const res = await fetch(`/api/search?${params}`);
      if (!res.ok) throw new Error('Search failed');
      const data: SearchResponse = await res.json();
      setResults(data);
    } catch {
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Trigger search when debounced query, tab, or filters change
   
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchResults(debouncedQuery, activeTab, filters);
  }, [debouncedQuery, activeTab, filters, fetchResults]);

  // ── Save current search ────────────────────────────────────

  const saveCurrentSearch = useCallback(async () => {
    if (!savingName.trim()) return;
    try {
      const res = await fetch('/api/search/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: savingName.trim(),
          query: query,
          type: activeTab,
          filters: {
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.priority ? { priority: filters.priority } : {}),
            ...(filters.dateFrom || filters.dateTo ? { dateRange: { from: filters.dateFrom || undefined, to: filters.dateTo || undefined } } : {}),
          },
        }),
      });
      if (res.ok) {
        setShowSaveDialog(false);
        setSavingName('');
        loadSavedSearches();
      }
    } catch {
      // Ignore
    }
  }, [savingName, query, activeTab, filters, loadSavedSearches]);

  // ── Apply saved search ─────────────────────────────────────

  const applySavedSearch = useCallback((saved: SavedSearch) => {
    setQuery(saved.query);
    setDebouncedQuery(saved.query);
    setActiveTab((saved.type as SearchTab) || 'all');
    if (saved.filters) {
      setFilters({
        status: saved.filters.status ?? '',
        priority: saved.filters.priority ?? '',
        dateFrom: saved.filters.dateRange?.from ?? '',
        dateTo: saved.filters.dateRange?.to ?? '',
      });
    }
    setShowSavedSearches(false);
  }, []);

  // ── Delete saved search ────────────────────────────────────

  const deleteSavedSearch = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/search/saved?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSavedSearches((prev) => prev.filter((s) => s.id !== id));
      }
    } catch {
      // Ignore
    }
  }, []);

  // ── Clear all filters ──────────────────────────────────────

  const clearAllFilters = () => {
    setFilters({ status: '', priority: '', dateFrom: '', dateTo: '' });
  };

  // ── Render search result item ────────────────────────────

  const renderHit = (hit: SearchHit, index: number) => {
    const Icon = getTypeIcon(hit.type);
    const statusConfig = getStatusConfig(hit.status);

    return (
      <motion.div
        key={`${hit.type}-${hit.id}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.03 }}
      >
        <Link
          href={hit.url}
          className={cn(
            'group flex items-start gap-3 rounded-xl border border-transparent px-3 py-3 transition-all duration-200',
            'hover:border-surface-300/20 hover:bg-surface-200/40 ',
            'active:scale-[0.99]',
          )}
        >
          {/* Type Icon */}
          <div
            className={cn(
              'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-200',
              'group-hover:scale-110 group-hover:shadow-sm',
              hit.type === 'task' && 'bg-blue-500/10 text-blue-500',
              hit.type === 'project' && 'bg-purple-500/10 text-purple-500',
              hit.type === 'user' && 'bg-emerald-500/10 text-emerald-500',
            )}
          >
            <Icon className="h-4 w-4" />
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-surface-900 truncate text-sm font-medium group-hover:text-brand-500 transition-colors">
                {highlightMatch(hit.title, debouncedQuery)}
              </span>
              {hit.status && (
                <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-medium', statusConfig.color)}>
                  {statusConfig.label}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs">
              {hit.subtitle && (
                <span className="text-surface-400 font-mono">{hit.subtitle}</span>
              )}
              <span className={cn(
                'text-[9px] font-medium uppercase tracking-wider',
                hit.type === 'task' && 'text-blue-400',
                hit.type === 'project' && 'text-purple-400',
                hit.type === 'user' && 'text-emerald-400',
              )}>
                {hit.type}
              </span>
            </div>
            {hit.description && (
              <p className="text-surface-500 mt-0.5 line-clamp-1 text-xs">
                {hit.description.length > 120
                  ? hit.description.slice(0, 120) + '...'
                  : hit.description}
              </p>
            )}
          </div>

          {/* Arrow */}
          <ArrowRight className="text-surface-400 mt-2 h-3.5 w-3.5 shrink-0 opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5" />
        </Link>
      </motion.div>
    );
  };

  // ── Render section ──────────────────────────────────────

  const renderSection = (type: 'tasks' | 'projects' | 'users' | 'comments', label: string) => {
    const section = results?.results[type];
    if (!section || section.hits.length === 0) return null;

    const Icon = getTypeIcon(
      type === 'tasks' ? 'task' : type === 'projects' ? 'project' : type === 'users' ? 'user' : 'comment',
    );

    return (
      <motion.div variants={itemVariants}>
        <div className="mb-2 flex items-center gap-2 px-1">
          <Icon className="text-surface-400 h-3.5 w-3.5" />
          <span className="text-surface-500 text-xs font-semibold uppercase tracking-wider">{label}</span>
          <span className="text-surface-400 text-[10px]">{section.total} result{section.total !== 1 ? 's' : ''}</span>
          {activeTab === 'all' && section.total > 0 && (
            <button
              onClick={() => setActiveTab(type)}
              className="text-brand-500 hover:text-brand-400 ml-auto text-[10px] font-medium"
            >
              View all
            </button>
          )}
        </div>
        <div className="space-y-0.5">
          {section.hits.map((hit, i) => renderHit(hit, i))}
        </div>
      </motion.div>
    );
  };

  // ── Counts by type ─────────────────────────────────────

  const counts = {
    tasks: results?.results.tasks.total ?? 0,
    projects: results?.results.projects.total ?? 0,
    users: results?.results.users.total ?? 0,
    comments: results?.results.comments.total ?? 0,
  };

  const TAB_CONFIG: { id: SearchTab; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: results?.total ?? 0 },
    { id: 'tasks', label: 'Tasks', count: counts.tasks },
    { id: 'projects', label: 'Projects', count: counts.projects },
    { id: 'users', label: 'Users', count: counts.users },
    { id: 'comments', label: 'Comments', count: counts.comments },
  ];

  // ── Render ─────────────────────────────────────────────

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="mx-auto max-w-3xl space-y-6"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <div>
          <h1 className="text-surface-900 flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <div className="from-brand-400 to-brand-600 flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm">
              <Search className="h-4 w-4 text-white" />
            </div>
            Search
          </h1>
          <p className="text-surface-500 mt-0.5 text-sm">
            Search across tasks, projects, and people
          </p>
        </div>

        {/* Saved Searches Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSavedSearches(!showSavedSearches)}
            className={cn(
              'flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all duration-200',
              showSavedSearches
                ? 'bg-brand-500/10 text-brand-500 border border-brand-500/20'
                : 'text-surface-500 hover:text-surface-600 hover:bg-surface-200/50 border border-transparent',
            )}
          >
            <Bookmark className={cn('h-3.5 w-3.5', showSavedSearches && 'fill-brand-500/20')} />
            Saved
            {savedSearches.length > 0 && (
              <span className="bg-surface-300/30 ml-0.5 rounded-full px-1.5 py-0.5 text-[9px]">
                {savedSearches.length}
              </span>
            )}
          </button>

          {/* Save Current Search */}
          {(query || hasActiveFilters) && (
            <button
              onClick={() => setShowSaveDialog(true)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-surface-500 hover:text-brand-500 hover:bg-brand-500/10 transition-all duration-200"
              title="Save current search"
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              Save
            </button>
          )}
        </div>
      </motion.div>

      {/* Saved Searches Dropdown */}
      {showSavedSearches && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-surface-300/20 bg-surface-100/80 rounded-2xl border p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-surface-500 text-xs font-semibold uppercase tracking-wider">
              Saved Searches
            </span>
            <span className="text-surface-400 text-[10px]">
              {savedSearches.length} {savedSearches.length === 1 ? 'search' : 'searches'}
            </span>
          </div>

          {savedSearchesLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="text-surface-400 h-4 w-4 animate-spin" />
            </div>
          ) : savedSearches.length === 0 ? (
            <div className="flex flex-col items-center py-4 text-center">
              <Bookmark className="text-surface-300 h-6 w-6 mb-1" />
              <p className="text-surface-500 text-xs">No saved searches yet</p>
              <p className="text-surface-400 mt-0.5 text-[10px]">
                Run a search and save it for quick access
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {savedSearches.map((saved) => (
                <div
                  key={saved.id}
                  className="group flex items-center justify-between rounded-xl px-3 py-2 hover:bg-surface-200/50 transition-all cursor-pointer"
                  onClick={() => applySavedSearch(saved)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Bookmark className="text-brand-500 h-3 w-3 fill-brand-500/20" />
                      <span className="text-surface-700 text-sm font-medium truncate">
                        {saved.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {saved.query && (
                        <span className="text-surface-400 text-[10px] truncate max-w-[160px]">
                          &ldquo;{saved.query}&rdquo;
                        </span>
                      )}
                      <span className="text-surface-400 text-[9px] uppercase font-medium">
                        {saved.type}
                      </span>
                      {saved.filters?.status && (
                        <span className="text-blue-400 text-[9px]">{saved.filters.status}</span>
                      )}
                      {saved.filters?.priority && (
                        <span className="text-amber-400 text-[9px]">{saved.filters.priority}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSavedSearch(saved.id);
                    }}
                    className="text-surface-400 hover:text-error opacity-0 group-hover:opacity-100 rounded-lg p-1 transition-all"
                    title="Delete saved search"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Save Dialog */}
      {showSaveDialog && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-brand-500/20 bg-brand-500/5 rounded-2xl border p-4"
        >
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              placeholder="Name this search..."
              className="border-surface-300/20 bg-surface-100/80 focus:border-brand-500 focus:ring-brand-500/20 flex-1 rounded-xl border px-3 py-2 text-sm transition-all focus:outline-none focus:ring-2"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveCurrentSearch();
                if (e.key === 'Escape') setShowSaveDialog(false);
              }}
            />
            <button
              onClick={saveCurrentSearch}
              disabled={!savingName.trim()}
              className="bg-brand-500 hover:bg-brand-400 disabled:opacity-50 flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-medium text-white shadow-sm transition-all disabled:cursor-not-allowed"
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              Save
            </button>
            <button
              onClick={() => setShowSaveDialog(false)}
              className="text-surface-400 hover:text-surface-600 hover:bg-surface-200/50 rounded-xl p-2 transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-surface-400 mt-2 text-[10px]">
            Saves: query &ldquo;{query}&rdquo;{filters.status && ` · status: ${filters.status}`}{filters.priority && ` · priority: ${filters.priority}`}
            {activeTab !== 'all' && ` · type: ${activeTab}`}
          </p>
        </motion.div>
      )}

      {/* Search Input + Filter Toggle */}
      <motion.div variants={itemVariants} className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
              {loading ? (
                <Loader2 className="text-brand-500 h-4 w-4 animate-spin" />
              ) : (
                <Search className="text-surface-400 h-4 w-4" />
              )}
            </div>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tasks, projects, people... (⌘K)"
              className={cn(
                'border-surface-300/30 bg-surface-100/80 ',
                'focus:border-brand-500 focus:ring-brand-500/20',
                'w-full rounded-2xl border py-3.5 pl-11 pr-12 text-base transition-all',
                'focus:outline-none focus:ring-2 focus:shadow-lg focus:shadow-brand-500/5',
                'placeholder:text-surface-400',
                query && 'pr-24',
              )}
            />
            {/* Clear button */}
            {query && (
              <button
                onClick={() => { setQuery(''); setResults(null); setHasSearched(false); inputRef.current?.focus(); }}
                className="text-surface-400 hover:text-surface-600 hover:bg-surface-200/50 absolute inset-y-0 right-0 flex items-center pr-3 transition-all"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {/* Keyboard hint */}
            <div className="pointer-events-none absolute inset-y-0 right-0 hidden items-center pr-3 sm:flex">
              {!query && (
                <kbd className="bg-surface-200/50 text-surface-400 flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-mono">
                  <Command className="h-2.5 w-2.5" />
                  K
                </kbd>
              )}
            </div>
          </div>

          {/* Filter Toggle Button */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'flex items-center gap-1.5 rounded-2xl border px-3.5 py-3.5 text-xs font-medium transition-all duration-200',
              showFilters || hasActiveFilters
                ? 'bg-brand-500/10 text-brand-500 border-brand-500/20'
                : 'text-surface-500 hover:text-surface-600 hover:bg-surface-200/50 border-surface-300/30 ',
            )}
            title="Toggle advanced filters"
          >
            <Filter className="h-4 w-4" />
            {hasActiveFilters && (
              <span className="bg-brand-500 text-white flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold">
                {(filters.status ? 1 : 0) + (filters.priority ? 1 : 0) + (filters.dateFrom || filters.dateTo ? 1 : 0)}
              </span>
            )}
          </button>
        </div>

        {/* Advanced Filters Panel */}
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-surface-300/20 bg-surface-100/80 grid grid-cols-2 gap-3 rounded-2xl border p-4 sm:grid-cols-4"
          >
            {/* Status Filter */}
            <div className="space-y-1.5">
              <label className="text-surface-500 block text-[10px] font-semibold uppercase tracking-wider">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                className="border-surface-300/20 bg-surface-100/80 hover:border-surface-400/30 focus:border-brand-500 focus:ring-brand-500/20 h-9 w-full rounded-xl border px-2.5 text-xs transition-all focus:outline-none focus:ring-2"
              >
                <option value="">All Statuses</option>
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Priority Filter */}
            <div className="space-y-1.5">
              <label className="text-surface-500 block text-[10px] font-semibold uppercase tracking-wider">Priority</label>
              <select
                value={filters.priority}
                onChange={(e) => setFilters((prev) => ({ ...prev, priority: e.target.value }))}
                className="border-surface-300/20 bg-surface-100/80 hover:border-surface-400/30 focus:border-brand-500 focus:ring-brand-500/20 h-9 w-full rounded-xl border px-2.5 text-xs transition-all focus:outline-none focus:ring-2"
              >
                <option value="">All Priorities</option>
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Date From */}
            <div className="space-y-1.5">
              <label className="text-surface-500 block text-[10px] font-semibold uppercase tracking-wider">From Date</label>
              <div className="relative">
                <Calendar className="text-surface-400 pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
                  className="border-surface-300/20 bg-surface-100/80 hover:border-surface-400/30 focus:border-brand-500 focus:ring-brand-500/20 h-9 w-full rounded-xl border pl-8 pr-2.5 text-xs transition-all focus:outline-none focus:ring-2"
                />
              </div>
            </div>

            {/* Date To */}
            <div className="space-y-1.5">
              <label className="text-surface-500 block text-[10px] font-semibold uppercase tracking-wider">To Date</label>
              <div className="relative">
                <Calendar className="text-surface-400 pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
                  className="border-surface-300/20 bg-surface-100/80 hover:border-surface-400/30 focus:border-brand-500 focus:ring-brand-500/20 h-9 w-full rounded-xl border pl-8 pr-2.5 text-xs transition-all focus:outline-none focus:ring-2"
                />
              </div>
            </div>

            {/* Clear Filters */}
            {hasActiveFilters && (
              <div className="col-span-full flex justify-end">
                <button
                  onClick={clearAllFilters}
                  className="text-surface-400 hover:text-surface-600 hover:bg-surface-200/50 flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-all"
                >
                  <X className="h-3 w-3" />
                  Clear all filters
                </button>
              </div>
            )}
          </motion.div>
        )}
      </motion.div>

      {/* Search Results */}
      {hasSearched && (
        <>
          {/* Type Tabs */}
          {results && results.total > 0 && (
            <motion.div variants={itemVariants}>
              <div
                className="bg-surface-200/50 inline-flex items-center gap-0.5 rounded-xl p-0.5"
                role="tablist"
              >
                {TAB_CONFIG.map((tab) => (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                      activeTab === tab.id
                        ? 'bg-surface-50 text-surface-900 shadow-sm'
                        : 'text-surface-500 hover:text-surface-700 ',
                    )}
                  >
                    {tab.label}
                    {tab.count > 0 && (
                      <span
                        className={cn(
                          'ml-1.5 rounded-full px-1.5 py-0.5 text-[9px]',
                          activeTab === tab.id
                            ? 'bg-brand-500/10 text-brand-500'
                            : 'bg-surface-300/30 ',
                        )}
                      >
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Results */}
          <motion.div variants={itemVariants}>
            <div className="neon-card relative overflow-hidden rounded-2xl">
              <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-400 to-brand-600 opacity-40" />

              {loading ? (
                <div className="space-y-3 p-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-start gap-3 py-2">
                      <div className="shimmer h-8 w-8 rounded-xl" />
                      <div className="flex-1 space-y-2">
                        <div className="shimmer h-4 w-2/3 rounded-lg" />
                        <div className="shimmer h-3 w-1/3 rounded-lg" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : results && results.total === 0 ? (
                <div className="flex flex-col items-center py-16">
                  <div className="border-surface-300/20 bg-surface-100/50 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border">
                    <Inbox className="text-surface-400 h-7 w-7" />
                  </div>
                  <h3 className="text-surface-900 text-base font-semibold">
                    No results found
                  </h3>
                  <p className="text-surface-500 mt-1.5 max-w-xs text-center text-sm">
                    We couldn&apos;t find anything matching &quot;{debouncedQuery}&quot;. Try different keywords or check your spelling.
                  </p>
                </div>
              ) : results ? (
                <div className="space-y-6 p-4">
                {renderSection('tasks', 'Tasks')}
                {renderSection('projects', 'Projects')}
                {renderSection('users', 'Users')}
                {renderSection('comments', 'Comments')}
                </div>
              ) : null}
            </div>
          </motion.div>

          {/* Search hint */}
          {results && results.total > 0 && (
            <motion.div variants={itemVariants} className="flex items-center justify-center gap-2 text-[10px] text-surface-400">
              <Sparkles className="h-3 w-3" />
              <span>Hover results to preview, click to navigate</span>
            </motion.div>
          )}
        </>
      )}

      {/* Empty state (no search yet) */}
      {!hasSearched && !loading && (
        <motion.div variants={itemVariants}>
          <div className="border-surface-300/20 bg-surface-100/80 relative overflow-hidden rounded-2xl border py-16">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-400 to-brand-600 opacity-20" />
            <div className="flex flex-col items-center">
              <div className="border-surface-300/20 bg-surface-100/50 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border">
                <Search className="text-surface-400 h-7 w-7" />
              </div>
              <h3 className="text-surface-900 text-base font-semibold">
                Search your workspace
              </h3>
              <p className="text-surface-500 mt-1.5 max-w-sm text-center text-sm">
                Type a query above to search across tasks, projects, and people. Use <kbd className="bg-surface-200/50 rounded px-1 py-0.5 font-mono text-[10px]">⌘K</kbd> to focus the search from anywhere.
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
