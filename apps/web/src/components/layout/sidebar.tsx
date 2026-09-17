'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  ListTodo,
  FolderKanban,
  Users,
  UserRoundCog,
  BarChart3,
  Calendar,
  Settings,
  ChevronLeft,
  Plus,
  Sparkles,
  Menu,
  X,
  Clock,
  FileEdit,
  Bot,
  TrendingUp,
  Bell,
  Search as SearchIcon,
  Milestone,
  Layers,
  CalendarDays,
} from 'lucide-react';
import { useState, useEffect, useRef, useCallback, startTransition } from 'react';
import { motion, AnimatePresence, useTransform } from 'framer-motion';
import { useScrollShadow } from '@/lib/hooks/use-scroll-shadow';
import { useNotificationStore } from '@/stores/notification-store';

/**
 * Grouped navigation (Work / Team / Insights / System) for the redesigned
 * sidebar. `navItems` below is derived by flattening these groups so existing
 * consumers (the ⌘K command palette in search-command.tsx, tests) keep the
 * same flat list of every destination.
 */
export const navGroups = [
  {
    label: 'Work',
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard },
      { label: 'Tasks', href: '/tasks', icon: ListTodo },
      { label: 'Task Templates', href: '/task-templates', icon: Layers },
      { label: 'Projects', href: '/projects', icon: FolderKanban },
      { label: 'Milestones', href: '/milestones', icon: Milestone },
      { label: 'Time Tracking', href: '/timer', icon: Clock },
      { label: 'Calendar', href: '/calendar', icon: Calendar },
      { label: 'Gantt Chart', href: '/gantt', icon: CalendarDays },
    ],
  },
  {
    label: 'Team',
    items: [
      { label: 'Teams', href: '/teams', icon: Users },
      { label: 'People', href: '/users', icon: UserRoundCog },
      { label: 'Time Off', href: '/leave', icon: CalendarDays },
      { label: 'Corrections', href: '/corrections', icon: FileEdit },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Reports', href: '/reports', icon: BarChart3 },
      { label: 'Analytics', href: '/analytics', icon: TrendingUp },
      { label: 'Automation', href: '/automation', icon: Bot },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Search', href: '/search', icon: SearchIcon },
      { label: 'Notifications', href: '/notifications', icon: Bell },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

export const navItems = navGroups.flatMap((group) => group.items);

const sidebarItemVariants = {
  hidden: { opacity: 0, x: -16 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 120,
      damping: 20,
      delay: i * 0.03,
    },
  }),
} as const;

/** FAB for mobile — scroll-driven shadow deepens as content scrolls behind it. */
function MobileFabButton({ onClick }: { onClick: () => void }) {
  const { shadowSpring } = useScrollShadow({ mobileOnly: true });
  const fabShadow = useTransform(shadowSpring, [0, 1], [
    '0 4px 12px rgba(99,102,241,0.25)',  // subtle at top
    '0 6px 28px rgba(99,102,241,0.45)',  // deeper glow when content under it
  ]);

  return (
    <motion.button
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      whileHover={{ scale: 1.05, boxShadow: '0 8px 32px rgba(99,102,241,0.55)' }}
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      style={{ boxShadow: fabShadow }}
      className="bg-brand-500 fixed bottom-4 left-4 z-40 flex h-12 w-12 items-center justify-center rounded-2xl text-white transition-shadow duration-200 md:hidden"
      aria-label="Open menu"
    >
      <Menu className="h-5 w-5" />
    </motion.button>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(true); // Assume mobile until proven otherwise — prevents flash
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  useEffect(() => {
    const check = () => startTransition(() => setIsMobile(window.innerWidth < 768));
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Close mobile sidebar on navigation
  useEffect(() => {
    if (isMobile) startTransition(() => setMobileOpen(false));
  }, [pathname, isMobile]);

  // Handle browser back button to close sidebar
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = () => setMobileOpen(false);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [mobileOpen]);

  // Listen for custom event to open sidebar from bottom nav
  useEffect(() => {
    const handler = () => setMobileOpen(true);
    window.addEventListener('open-mobile-sidebar', handler);
    return () => window.removeEventListener('open-mobile-sidebar', handler);
  }, []);

  // Touch swipe to close drawer
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const currentX = e.touches[0]?.clientX ?? 0;
    const diff = currentX - touchStartX.current;
    // If swiped left more than 80px, close the drawer
    if (diff < -80) {
      setMobileOpen(false);
      touchStartX.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    touchStartX.current = null;
  }, []);

  const sidebarContent = (
    <aside
      className={cn(
        'border-surface-500/15 bg-surface-100/80 flex h-full flex-col border-r backdrop-blur-xl transition-all duration-300 ease-in-out',
        collapsed && !isMobile ? 'w-16' : 'w-60',
        isMobile && 'w-60',
      )}
    >
      {/* Logo */}
      <div className="border-surface-500/20 flex h-14 shrink-0 items-center justify-between border-b px-4">
        {(!collapsed || isMobile) && (
          <Link href="/" className="group flex items-center gap-2.5">
            <div className="from-brand-400 to-brand-600 group-hover:shadow-brand-500/20 flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm transition-all duration-200 group-hover:shadow-md">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="gradient-text text-sm font-bold">WorkManager</span>
          </Link>
        )}
        {collapsed && !isMobile && (
          <Link href="/" className="group mx-auto">
            <div className="from-brand-400 to-brand-600 flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm transition-all duration-200 group-hover:shadow-md">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
          </Link>
        )}
        {!isMobile && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              'text-surface-500 hover:bg-surface-200/70 hover:text-surface-600 rounded-lg p-1.5 transition-all duration-200',
              collapsed && 'mx-auto',
            )}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft
              className={cn('h-4 w-4 transition-transform duration-300', collapsed && 'rotate-180')}
            />
          </button>
        )}
        {isMobile && (
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="text-surface-500 hover:bg-surface-200/70 hover:text-surface-600 rounded-lg p-1.5 transition-all duration-200"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="scrollbar-thin flex-1 overflow-y-auto p-3">
        {(() => {
          let runningIndex = 0;
          return navGroups.map((group, groupIndex) => (
            <div key={group.label} className="space-y-0.5">
              {/* Group header — collapses to a divider on desktop */}
              {!collapsed || isMobile ? (
                <div
                  className={cn(
                    'text-surface-500 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em]',
                    groupIndex === 0 ? 'pt-1' : 'pt-4',
                  )}
                >
                  {group.label}
                </div>
              ) : (
                groupIndex > 0 && <div className="border-surface-500/15 mx-2 my-2 border-t" />
              )}

              {group.items.map((item) => {
                const index = runningIndex++;
                const isActive =
                  item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                const isHovered = hoveredItem === item.href;

                return (
                  <motion.div
                    key={item.href}
                    custom={index}
                    variants={sidebarItemVariants}
                    initial="hidden"
                    animate="visible"
                  >
                    <Link
                      href={item.href}
                      onMouseEnter={() => setHoveredItem(item.href)}
                      onMouseLeave={() => setHoveredItem(null)}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
                        isActive
                          ? 'from-brand-500/[0.16] to-brand-500/[0.04] text-brand-500 active-neon bg-gradient-to-r shadow-sm shadow-brand-500/10'
                          : 'text-surface-600 hover:bg-surface-200/60 hover:text-surface-800',
                      )}
                      title={collapsed && !isMobile ? item.label : undefined}
                    >
                      {/* Active indicator — a left accent rail (the canonical vertical-nav cue) */}
                      {isActive && (
                        <motion.span
                          layoutId="activeNavIndicator"
                          className="bg-brand-500 shadow-brand-500/50 absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full shadow-[0_0_6px]"
                          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        />
                      )}
                      <div className="relative">
                        <item.icon
                          className={cn(
                            'h-4 w-4 shrink-0 transition-all duration-200',
                            isActive && 'text-brand-500',
                            !isActive && 'group-hover:text-brand-500 group-hover:scale-110',
                          )}
                        />
                        {/* Ripple dot for active */}
                        {isActive && (
                          <span className="absolute -right-0.5 -top-0.5 flex h-1.5 w-1.5">
                            <span className="bg-brand-400 absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" />
                            <span className="bg-brand-500 relative inline-flex h-1.5 w-1.5 rounded-full" />
                          </span>
                        )}
                        {/* Unread notification badge on the Notifications icon */}
                        {item.href === '/notifications' && unreadCount > 0 && (
                          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gradient-to-r from-red-500 to-rose-500 px-1 text-[7px] font-bold text-white shadow-sm ring-1 ring-surface-50 ">
                            {unreadCount > 9 ? '9+' : unreadCount}
                          </span>
                        )}
                      </div>
                      {(!collapsed || isMobile) && (
                        <span className="relative">{item.label}</span>
                      )}

                      {/* Subtle glow on hover for active items */}
                      {isActive && isHovered && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="bg-brand-500/5 absolute inset-0 rounded-xl"
                        />
                      )}

                      {/* Tooltip for collapsed mode */}
                      {collapsed && !isMobile && (
                        <span className="bg-surface-200/95 text-surface-900 border-surface-400/20 pointer-events-none absolute left-full z-50 ml-2 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium opacity-0 shadow-lg backdrop-blur-sm transition-all duration-200 group-hover:opacity-100">
                          {item.label}
                        </span>
                      )}
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          ));
        })()}
      </nav>

      {/* Quick create */}
      <div className="border-surface-500/20 shrink-0 border-t p-3">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-quick-create'))}
          className={cn(
            'from-brand-500 to-brand-600 shadow-brand-500/20 hover:shadow-brand-500/30 hover:from-brand-400 hover:to-brand-500 btn-shine group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-300 hover:shadow-md active:scale-[0.97]',
            collapsed && !isMobile && 'px-0',
          )}
          title={collapsed && !isMobile ? 'New Task (⌘T)' : undefined}
        >
          {/* Animated shimmer background on hover */}
          <span className="absolute inset-0 -translate-x-full animate-none bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          <Plus className="h-4 w-4 transition-transform duration-200 group-hover:rotate-90" />
          {(!collapsed || isMobile) && <span>New Task</span>}

          {collapsed && !isMobile && (
            <span className="bg-surface-200/90 text-surface-900 border-surface-300/20 pointer-events-none absolute left-full z-50 ml-2 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium opacity-0 shadow-lg backdrop-blur-sm transition-all duration-200 group-hover:opacity-100">
              New Task (⌘T)
            </span>
          )}
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Mobile menu button - with scroll-driven shadow glow */}
      {isMobile && (
        <MobileFabButton onClick={() => setMobileOpen(true)} />
      )}

      {/* Desktop sidebar */}
      {!isMobile && <div className="shrink-0">{sidebarContent}</div>}

      {/* Mobile drawer overlay */}
      {isMobile && (
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
              onClick={() => setMobileOpen(false)}
            />
          )}
        </AnimatePresence>
      )}

      {/* Mobile drawer */}
      {isMobile && (
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed inset-y-0 left-0 z-50 w-60 md:hidden"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              {sidebarContent}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </>
  );
}
