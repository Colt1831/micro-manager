'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// ─── Types ──────────────────────────────────────────────────

export type Task = {
  id: string;
  title: string;
  description: string | null;
  taskIdDisplay: string;
  status: string;
  priority: string;
  assignedTo: string | null;
  assignedToName?: string | null;
  projectId: string | null;
  departmentId: string | null;
  teamId: string | null;
  createdBy: string;
  updatedBy: string | null;
  dueDate: string | null;
  startDate: string | null;
  estimatedHours: string | null;
  actualHours: string | null;
  labels: string[] | null;
  tags: string[] | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  updatedByName: string | null;
  sortOrder: string | null;
};

export type Comment = {
  id: string;
  taskId: string;
  userId: string;
  content: string;
  isInternalNote: boolean;
  parentId: string | null;
  isEdited: boolean;
  editedAt: string | null;
  createdAt: string;
  user: { id: string; name: string | null; avatarUrl: string | null } | null;
};

export type TimeEntry = {
  id: string;
  taskId: string;
  userId: string;
  startTime: string;
  endTime: string | null;
  durationMinutes: number | null;
  entryType: string;
  description: string | null;
  createdAt: string;
  user: { id: string; name: string | null; avatarUrl: string | null } | null;
};

export type Attachment = {
  id: string;
  taskId: string;
  userId: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  createdAt: string;
  user: { id: string; name: string | null } | null;
};

export type Dependency = {
  id: string;
  taskId: string;
  dependsOnTaskId: string;
  dependencyType: string;
  createdAt: string;
  dependsOnTask?: { id: string; title: string; taskIdDisplay: string; status: string };
  blockingTask?: { id: string; title: string; taskIdDisplay: string; status: string };
};

export type ChecklistItem = {
  id: string;
  taskId: string;
  content: string;
  isChecked: boolean;
  checkedBy: string | null;
  checkedAt: string | null;
  sortOrder: number;
  createdAt: string;
};

// ─── Filters ────────────────────────────────────────────────

export interface TaskFilters {
  search: string;
  status: string;
  priority: string;
  projectId: string;
  assignedTo: string;
  watchedOnly: boolean;
  showTrash: boolean;
  deletedBy: string;
}

export const defaultFilters: TaskFilters = {
  search: '',
  status: '',
  priority: '',
  projectId: '',
  assignedTo: '',
  watchedOnly: false,
  showTrash: false,
  deletedBy: '',
};

// ─── UI State ───────────────────────────────────────────────

export interface TasksUIState {
  view: 'list' | 'board';
  page: number;
  pageSize: number;
  selectedIds: Set<string>;
  allSelectedMode: boolean;
  allMatchingIds: string[];
  showFilters: boolean;
}

// ─── Store Interface ────────────────────────────────────────

interface TaskStore {
  // Task list state
  tasks: Task[];
  totalCount: number;
  loading: boolean;
  error: string | null;

  // Current task detail
  currentTask: Task | null;
  comments: Comment[];
  attachments: Attachment[];
  timeEntries: TimeEntry[];
  blockedBy: Dependency[];
  blocking: Dependency[];
  checklistItems: ChecklistItem[];
  loadingDetail: boolean;
  detailError: string | null;

  // Filters & UI
  filters: TaskFilters;
  ui: TasksUIState;

  // Actions — Task List
  setTasks: (tasks: Task[]) => void;
  setTotalCount: (count: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  fetchTasks: (params?: string) => Promise<void>;
  updateTaskInList: (taskId: string, updates: Partial<Task>) => void;
  removeTaskFromList: (taskId: string) => void;

  // Actions — Task Detail
  setCurrentTask: (task: Task | null) => void;
  setComments: (comments: Comment[]) => void;
  addComment: (comment: Comment) => void;
  removeComment: (commentId: string) => void;
  setAttachments: (attachments: Attachment[]) => void;
  addAttachment: (attachment: Attachment) => void;
  removeAttachment: (attachmentId: string) => void;
  setTimeEntries: (entries: TimeEntry[]) => void;
  addTimeEntry: (entry: TimeEntry) => void;
  removeTimeEntry: (entryId: string) => void;
  setDependencies: (blockedBy: Dependency[], blocking: Dependency[]) => void;
  addDependency: (dependency: Dependency) => void;
  removeDependency: (dependencyId: string) => void;
  setChecklistItems: (items: ChecklistItem[]) => void;
  addChecklistItem: (item: ChecklistItem) => void;
  updateChecklistItem: (itemId: string, updates: Partial<ChecklistItem>) => void;
  removeChecklistItem: (itemId: string) => void;
  setLoadingDetail: (loading: boolean) => void;
  setDetailError: (error: string | null) => void;
  fetchTaskDetail: (taskId: string) => Promise<void>;
  updateCurrentTask: (updates: Partial<Task>) => void;

  // Actions — Filters & UI
  setFilters: (filters: Partial<TaskFilters>) => void;
  resetFilters: () => void;
  setView: (view: 'list' | 'board') => void;
  setPage: (page: number) => void;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setShowFilters: (show: boolean) => void;
}

// ─── Store ──────────────────────────────────────────────────

export const useTaskStore = create<TaskStore>()(
  devtools(
    (set) => ({
      // ── Initial State ──────────────────────────────────

      tasks: [],
      totalCount: 0,
      loading: false,
      error: null,

      currentTask: null,
      comments: [],
      attachments: [],
      timeEntries: [],
      blockedBy: [],
      blocking: [],
      checklistItems: [],
      loadingDetail: false,
      detailError: null,

      filters: { ...defaultFilters },
      ui: {
        view: 'list',
        page: 0,
        pageSize: 25,
        selectedIds: new Set(),
        allSelectedMode: false,
        allMatchingIds: [],
        showFilters: false,
      },

      // ── Task List Actions ─────────────────────────────

      setTasks: (tasks) => set({ tasks }),
      setTotalCount: (count) => set({ totalCount: count }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),

      fetchTasks: async (params) => {
        set({ loading: true, error: null });
        try {
          const res = await fetch(`/api/tasks${params ? `?${params}` : ''}`);
          if (!res.ok) throw new Error('Failed to fetch tasks');
          const data = await res.json();
          set({ tasks: data.tasks ?? [], totalCount: data.total ?? 0, loading: false });
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Failed to fetch tasks',
            loading: false,
          });
        }
      },

      updateTaskInList: (taskId, updates) => {
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)),
        }));
      },

      removeTaskFromList: (taskId) => {
        set((state) => ({
          tasks: state.tasks.filter((t) => t.id !== taskId),
        }));
      },

      // ── Task Detail Actions ───────────────────────────

      setCurrentTask: (task) => set({ currentTask: task }),
      setComments: (comments) => set({ comments }),
      addComment: (comment) => set((state) => ({ comments: [comment, ...state.comments] })),
      removeComment: (commentId) =>
        set((state) => ({ comments: state.comments.filter((c) => c.id !== commentId) })),
      setAttachments: (attachments) => set({ attachments }),
      addAttachment: (attachment) =>
        set((state) => ({ attachments: [attachment, ...state.attachments] })),
      removeAttachment: (attachmentId) =>
        set((state) => ({ attachments: state.attachments.filter((a) => a.id !== attachmentId) })),
      setTimeEntries: (entries) => set({ timeEntries: entries }),
      addTimeEntry: (entry) => set((state) => ({ timeEntries: [...state.timeEntries, entry] })),
      removeTimeEntry: (entryId) =>
        set((state) => ({ timeEntries: state.timeEntries.filter((e) => e.id !== entryId) })),
      setDependencies: (blockedBy, blocking) => set({ blockedBy, blocking }),
      addDependency: (dependency) =>
        set((state) => ({ blockedBy: [...state.blockedBy, dependency] })),
      removeDependency: (dependencyId) =>
        set((state) => ({
          blockedBy: state.blockedBy.filter((d) => d.id !== dependencyId),
          blocking: state.blocking.filter((d) => d.id !== dependencyId),
        })),
      setChecklistItems: (items) => set({ checklistItems: items }),
      addChecklistItem: (item) =>
        set((state) => ({ checklistItems: [...state.checklistItems, item] })),
      updateChecklistItem: (itemId, updates) =>
        set((state) => ({
          checklistItems: state.checklistItems.map((i) =>
            i.id === itemId ? { ...i, ...updates } : i,
          ),
        })),
      removeChecklistItem: (itemId) =>
        set((state) => ({
          checklistItems: state.checklistItems.filter((i) => i.id !== itemId),
        })),
      setLoadingDetail: (loading) => set({ loadingDetail: loading }),
      setDetailError: (error) => set({ detailError: error }),

      fetchTaskDetail: async (taskId) => {
        set({ loadingDetail: true, detailError: null });
        try {
          const [taskRes, commentsRes, attachmentsRes, depsRes, timeRes] = await Promise.all([
            fetch(`/api/tasks/${taskId}`),
            fetch(`/api/tasks/${taskId}/comments`),
            fetch(`/api/tasks/${taskId}/attachments`),
            fetch(`/api/tasks/${taskId}/dependencies`),
            fetch(`/api/tasks/${taskId}/time-entries`),
          ]);

          if (!taskRes.ok) {
            throw new Error(taskRes.status === 404 ? 'Task not found' : 'Failed to load task');
          }

          const taskData = await taskRes.json();
          const commentsData = commentsRes.ok ? await commentsRes.json() : { comments: [] };
          const attachmentsData = attachmentsRes.ok
            ? await attachmentsRes.json()
            : { attachments: [] };
          const depsData = depsRes.ok ? await depsRes.json() : { blockedBy: [], blocking: [] };
          const timeData = timeRes.ok ? await timeRes.json() : { entries: [] };

          set({
            currentTask: taskData.task,
            comments: commentsData.comments ?? [],
            attachments: attachmentsData.attachments ?? [],
            blockedBy: depsData.blockedBy ?? [],
            blocking: depsData.blocking ?? [],
            timeEntries: timeData.entries ?? [],
            loadingDetail: false,
          });
        } catch (err) {
          set({
            detailError: err instanceof Error ? err.message : 'Failed to load task',
            loadingDetail: false,
          });
        }
      },

      updateCurrentTask: (updates) => {
        set((state) => ({
          currentTask: state.currentTask ? { ...state.currentTask, ...updates } : null,
        }));
      },

      // ── Filters & UI Actions ──────────────────────────

      setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),

      resetFilters: () => set({ filters: { ...defaultFilters } }),

      setView: (view) => set((state) => ({ ui: { ...state.ui, view, page: 0 } })),

      setPage: (page) => set((state) => ({ ui: { ...state.ui, page } })),

      toggleSelect: (id) =>
        set((state) => {
          const next = new Set(state.ui.selectedIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { ui: { ...state.ui, selectedIds: next } };
        }),

      selectAll: () =>
        set((state) => ({
          ui: {
            ...state.ui,
            selectedIds: new Set(state.tasks.map((t) => t.id)),
          },
        })),

      clearSelection: () =>
        set((state) => ({
          ui: {
            ...state.ui,
            selectedIds: new Set(),
            allSelectedMode: false,
            allMatchingIds: [],
          },
        })),

      setShowFilters: (show) => set((state) => ({ ui: { ...state.ui, showFilters: show } })),
    }),
    { name: 'task-store' },
  ),
);
