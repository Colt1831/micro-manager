import { MeiliSearch } from 'meilisearch';

// ─── Meilisearch Client (lazy singleton) ───────────────────────

let searchClient: MeiliSearch | null = null;

function getSearchClient(): MeiliSearch {
  if (!searchClient) {
    const host = process.env.MEILISEARCH_HOST;
    const apiKey = process.env.MEILISEARCH_API_KEY;

    if (!host) {
      throw new Error('MEILISEARCH_HOST is not configured');
    }

    searchClient = new MeiliSearch({
      host,
      apiKey: apiKey || undefined,
    });
  }
  return searchClient;
}

// ─── Index Names ───────────────────────────────────────────────

const INDEXES = {
  TASKS: 'tasks',
  PROJECTS: 'projects',
  USERS: 'users',
} as const;

// ─── Task Document Types ───────────────────────────────────────

export interface TaskSearchDocument {
  id: string;
  title: string;
  description: string | null;
  taskIdDisplay: string;
  status: string;
  priority: string;
  assignedTo: string | null;
  projectId: string | null;
  organizationId: string;
  labels: string[] | null;
  tags: string[] | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Project Document Types ────────────────────────────────────

export interface ProjectSearchDocument {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: string;
  ownerId: string;
  organizationId: string;
  tags: string[] | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Initialize Indexes ────────────────────────────────────────

export async function initializeSearchIndexes(): Promise<void> {
  const client = getSearchClient();

  // Ensure indexes exist with explicit primary key before updating settings.
  // Meilisearch requires a primary key to store documents; calling updateSettings
  // on a non-existent index creates it without a primary key, causing silent failures.
  await client.createIndex(INDEXES.TASKS, { primaryKey: 'id' }).catch(() => {});
  await client.createIndex(INDEXES.PROJECTS, { primaryKey: 'id' }).catch(() => {});
  await client.createIndex(INDEXES.USERS, { primaryKey: 'id' }).catch(() => {});

  // Update the tasks index settings
  const taskIndex = client.index(INDEXES.TASKS);
  await taskIndex.updateSettings({
    searchableAttributes: ['title', 'description', 'taskIdDisplay', 'labels', 'tags'],
    filterableAttributes: ['status', 'priority', 'organizationId', 'assignedTo', 'projectId'],
    sortableAttributes: ['createdAt', 'updatedAt', 'priority'],
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
  });

  // Update the projects index settings
  const projectIndex = client.index(INDEXES.PROJECTS);
  await projectIndex.updateSettings({
    searchableAttributes: ['name', 'code', 'description', 'tags'],
    filterableAttributes: ['organizationId', 'status', 'ownerId'],
    sortableAttributes: ['createdAt', 'name'],
  });

  // Update the users index settings
  const userIndex = client.index(INDEXES.USERS);
  await userIndex.updateSettings({
    searchableAttributes: ['name', 'email', 'displayName', 'designation'],
    filterableAttributes: ['organizationId', 'employmentStatus', 'departmentId'],
    sortableAttributes: ['createdAt', 'name'],
  });
}

// ─── Index a Single Task ───────────────────────────────────────

export async function indexTask(task: TaskSearchDocument): Promise<void> {
  try {
    const client = getSearchClient();
    await client.index(INDEXES.TASKS).addDocuments([task]);
  } catch (error) {
    console.error('[search] Failed to index task:', error instanceof Error ? error.message : error);
  }
}

// ─── Index Multiple Tasks ──────────────────────────────────────

export async function indexTasks(tasks: TaskSearchDocument[]): Promise<void> {
  try {
    const client = getSearchClient();
    await client.index(INDEXES.TASKS).addDocuments(tasks);
  } catch (error) {
    console.error(
      '[search] Failed to index tasks:',
      error instanceof Error ? error.message : error,
    );
  }
}

// ─── Remove Task from Index ────────────────────────────────────

export async function removeTaskFromIndex(taskId: string): Promise<void> {
  try {
    const client = getSearchClient();
    await client.index(INDEXES.TASKS).deleteDocument(taskId);
  } catch (error) {
    console.error(
      '[search] Failed to remove task from index:',
      error instanceof Error ? error.message : error,
    );
  }
}

// ─── Stale-doc purge (per-org, multi-tenant safe) ──────────────

/**
 * Return the IDs of all documents currently indexed for one organization in the
 * given index. Pages through Meilisearch with the org filter so we never touch
 * another tenant's docs. Used by the reindex sweep to diff against live DB rows.
 */
async function getIndexedDocIds(indexName: string, organizationId: string): Promise<string[]> {
  const client = getSearchClient();
  const index = client.index(indexName);
  const ids: string[] = [];
  const pageSize = 1000;
  let offset = 0;

  // getDocuments supports a filter; page until we've drained the org's docs.
  for (;;) {
    const res = await index.getDocuments({
      fields: ['id'],
      filter: `organizationId = ${organizationId}`,
      limit: pageSize,
      offset,
    });
    const batch = (res.results ?? []) as Array<{ id: string }>;
    for (const d of batch) ids.push(d.id);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return ids;
}

/**
 * Delete documents that are indexed for an org but no longer active in the DB.
 * `activeIds` are the live DB IDs for that org; anything indexed for the org and
 * NOT in that set is removed. Scoped by org filter — never deletes cross-org
 * (no global deleteAllDocuments). Returns the count removed.
 */
export async function purgeStaleTasks(
  organizationId: string,
  activeIds: string[],
): Promise<number> {
  return purgeStale(INDEXES.TASKS, organizationId, activeIds);
}

export async function purgeStaleProjects(
  organizationId: string,
  activeIds: string[],
): Promise<number> {
  return purgeStale(INDEXES.PROJECTS, organizationId, activeIds);
}

async function purgeStale(
  indexName: string,
  organizationId: string,
  activeIds: string[],
): Promise<number> {
  const indexed = await getIndexedDocIds(indexName, organizationId);
  const activeSet = new Set(activeIds);
  const stale = indexed.filter((id) => !activeSet.has(id));
  if (stale.length === 0) return 0;
  const client = getSearchClient();
  await client.index(indexName).deleteDocuments(stale);
  return stale.length;
}

export interface SearchOptions {
  query: string;
  organizationId: string;
  limit?: number;
  offset?: number;
  filter?: Record<string, string>;
}

export interface SearchResult<T> {
  hits: T[];
  total: number;
  estimatedTotal: number;
  limit: number;
  offset: number;
}

export async function searchTasks(
  options: SearchOptions,
): Promise<SearchResult<TaskSearchDocument>> {
  const client = getSearchClient();

  const filterParts: string[] = [`organizationId = ${options.organizationId}`];

  if (options.filter) {
    for (const [key, value] of Object.entries(options.filter)) {
      if (value) filterParts.push(`${key} = ${value}`);
    }
  }

  const result = await client.index(INDEXES.TASKS).search(options.query, {
    limit: options.limit ?? 20,
    offset: options.offset ?? 0,
    filter: filterParts,
  });

  return {
    hits: result.hits as TaskSearchDocument[],
    total: result.estimatedTotalHits ?? 0,
    estimatedTotal: result.estimatedTotalHits ?? 0,
    limit: result.limit ?? 20,
    offset: result.offset ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════════
//  PROJECT INDEXING
// ═══════════════════════════════════════════════════════════════

// ─── Index a Single Project ───────────────────────────────────

export async function indexProject(project: ProjectSearchDocument): Promise<void> {
  try {
    const client = getSearchClient();
    await client.index(INDEXES.PROJECTS).addDocuments([project]);
  } catch (error) {
    console.error('[search] Failed to index project:', error instanceof Error ? error.message : error);
  }
}

// ─── Index Multiple Projects ───────────────────────────────────

export async function indexProjects(projects: ProjectSearchDocument[]): Promise<void> {
  try {
    const client = getSearchClient();
    await client.index(INDEXES.PROJECTS).addDocuments(projects);
  } catch (error) {
    console.error(
      '[search] Failed to index projects:',
      error instanceof Error ? error.message : error,
    );
  }
}

// ─── Remove Project from Index ─────────────────────────────────

export async function removeProjectFromIndex(projectId: string): Promise<void> {
  try {
    const client = getSearchClient();
    await client.index(INDEXES.PROJECTS).deleteDocument(projectId);
  } catch (error) {
    console.error(
      '[search] Failed to remove project from index:',
      error instanceof Error ? error.message : error,
    );
  }
}

// ─── Search Projects ──────────────────────────────────────────

export async function searchProjects(
  options: SearchOptions,
): Promise<SearchResult<ProjectSearchDocument>> {
  const client = getSearchClient();

  const filterParts: string[] = [`organizationId = ${options.organizationId}`];

  if (options.filter) {
    for (const [key, value] of Object.entries(options.filter)) {
      if (value) filterParts.push(`${key} = ${value}`);
    }
  }

  const result = await client.index(INDEXES.PROJECTS).search(options.query, {
    limit: options.limit ?? 20,
    offset: options.offset ?? 0,
    filter: filterParts,
  });

  return {
    hits: result.hits as ProjectSearchDocument[],
    total: result.estimatedTotalHits ?? 0,
    estimatedTotal: result.estimatedTotalHits ?? 0,
    limit: result.limit ?? 20,
    offset: result.offset ?? 0,
  };
}
