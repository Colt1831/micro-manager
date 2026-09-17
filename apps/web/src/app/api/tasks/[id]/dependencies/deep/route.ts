import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db, schema, handleApiError, canAccessDept } from '@/lib/api/db';
import { withAuth, requirePermission } from '@/lib/auth/api-auth';
import { eq, and, isNull } from 'drizzle-orm';
import { getTaskIdFromPath } from '@/lib/api/task-helpers';

export const runtime = 'nodejs';

// ─── Types ───────────────────────────────────────────────────

interface GraphNode {
  id: string;
  title: string;
  taskIdDisplay: string;
  status: string;
  priority: string;
}

interface GraphEdge {
  id: string;
  source: string;   // depends_on_task_id
  target: string;   // task_id
  dependencyType: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    maxDepth: number;
    cycles: boolean;
  };
}

// ─── Recursive Traversal (request-scoped state) ─────────────

const MAX_DEPTH = 5;
const MAX_NODES = 100;

interface TraversalContext {
  nodeDepths: Map<string, number>;
  hasCycle: boolean;
}

function recordDepth(ctx: TraversalContext, nodeId: string, depth: number) {
  const existing = ctx.nodeDepths.get(nodeId);
  if (existing === undefined || depth > existing) {
    ctx.nodeDepths.set(nodeId, depth);
  }
}

async function traverseUpstream(
  taskId: string,
  orgId: string,
  visiting: Set<string>,
  visited: Set<string>,
  depth: number,
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
  ctx: TraversalContext,
): Promise<void> {
  if (depth > MAX_DEPTH || nodes.size >= MAX_NODES) return;

  if (visiting.has(taskId)) {
    ctx.hasCycle = true;
    return;
  }

  if (visited.has(taskId)) return;

  visiting.add(taskId);
  recordDepth(ctx, taskId, depth);

  const blockedBy = await db()
    .select({
      id: schema.taskDependencies.id,
      taskId: schema.taskDependencies.taskId,
      dependsOnTaskId: schema.taskDependencies.dependsOnTaskId,
      dependencyType: schema.taskDependencies.dependencyType,
    })
    .from(schema.taskDependencies)
    .innerJoin(schema.tasks, eq(schema.taskDependencies.dependsOnTaskId, schema.tasks.id))
    .where(
      and(
        eq(schema.taskDependencies.taskId, taskId),
        eq(schema.tasks.organizationId, orgId),
        isNull(schema.tasks.deletedAt),
      ),
    );

  for (const dep of blockedBy) {
    edges.push({
      id: dep.id,
      source: dep.dependsOnTaskId,
      target: dep.taskId,
      dependencyType: dep.dependencyType ?? 'blocks',
    });

    if (!nodes.has(dep.dependsOnTaskId)) {
      const [depTask] = await db()
        .select({
          id: schema.tasks.id,
          title: schema.tasks.title,
          taskIdDisplay: schema.tasks.taskIdDisplay,
          status: schema.tasks.status,
          priority: schema.tasks.priority,
        })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, dep.dependsOnTaskId), isNull(schema.tasks.deletedAt)))
        .limit(1);

      if (depTask) {
        nodes.set(depTask.id, {
          id: depTask.id,
          title: depTask.title,
          taskIdDisplay: depTask.taskIdDisplay,
          status: depTask.status,
          priority: depTask.priority ?? 'medium',
        });
        await traverseUpstream(depTask.id, orgId, visiting, visited, depth + 1, nodes, edges, ctx);
      }
    }
  }

  visiting.delete(taskId);
  visited.add(taskId);
}

async function traverseDownstream(
  taskId: string,
  orgId: string,
  visiting: Set<string>,
  visited: Set<string>,
  depth: number,
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
  ctx: TraversalContext,
): Promise<void> {
  if (depth > MAX_DEPTH || nodes.size >= MAX_NODES) return;

  if (visiting.has(taskId)) {
    ctx.hasCycle = true;
    return;
  }

  if (visited.has(taskId)) return;

  visiting.add(taskId);
  recordDepth(ctx, taskId, depth);

  const blocking = await db()
    .select({
      id: schema.taskDependencies.id,
      taskId: schema.taskDependencies.taskId,
      dependsOnTaskId: schema.taskDependencies.dependsOnTaskId,
      dependencyType: schema.taskDependencies.dependencyType,
    })
    .from(schema.taskDependencies)
    .innerJoin(schema.tasks, eq(schema.taskDependencies.taskId, schema.tasks.id))
    .where(
      and(
        eq(schema.taskDependencies.dependsOnTaskId, taskId),
        eq(schema.tasks.organizationId, orgId),
        isNull(schema.tasks.deletedAt),
      ),
    );

  for (const dep of blocking) {
    edges.push({
      id: dep.id,
      source: dep.dependsOnTaskId,
      target: dep.taskId,
      dependencyType: dep.dependencyType ?? 'blocks',
    });

    if (!nodes.has(dep.taskId)) {
      const [blockingTask] = await db()
        .select({
          id: schema.tasks.id,
          title: schema.tasks.title,
          taskIdDisplay: schema.tasks.taskIdDisplay,
          status: schema.tasks.status,
          priority: schema.tasks.priority,
        })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, dep.taskId), isNull(schema.tasks.deletedAt)))
        .limit(1);

      if (blockingTask) {
        nodes.set(blockingTask.id, {
          id: blockingTask.id,
          title: blockingTask.title,
          taskIdDisplay: blockingTask.taskIdDisplay,
          status: blockingTask.status,
          priority: blockingTask.priority ?? 'medium',
        });
        await traverseDownstream(blockingTask.id, orgId, visiting, visited, depth + 1, nodes, edges, ctx);
      }
    }
  }

  visiting.delete(taskId);
  visited.add(taskId);
}

// ─── GET ─────────────────────────────────────────────────────

export const GET = withAuth(
  async (request: NextRequest, { user, orgId, scope }) => {
    try {
      const taskId = getTaskIdFromPath(request);
      await requirePermission(user.id, 'task:view');

      // Fetch the root task (include organizationId for org-scope check)
      const [rootTask] = await db()
        .select({
          id: schema.tasks.id,
          organizationId: schema.tasks.organizationId,
          title: schema.tasks.title,
          taskIdDisplay: schema.tasks.taskIdDisplay,
          status: schema.tasks.status,
          priority: schema.tasks.priority,
          departmentId: schema.tasks.departmentId,
        })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, taskId), isNull(schema.tasks.deletedAt)))
        .limit(1);

      if (!rootTask) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Task not found' } },
          { status: 404 },
        );
      }

      if (rootTask.organizationId !== orgId) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Access denied' } },
          { status: 403 },
        );
      }

      // Department wall: the graph walk fans out from this root, so a walled
      // caller outside its department must be refused here — otherwise the
      // traversal leaks the titles and structure of another dept's work.
      if (!canAccessDept(scope, rootTask.departmentId)) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Task not found' } },
          { status: 404 },
        );
      }

      // ── Request-scoped state (never module-level) ────────────
      const ctx: TraversalContext = {
        nodeDepths: new Map<string, number>(),
        hasCycle: false,
      };

      // ── Traverse both directions ──────────────────────────────
      const nodes = new Map<string, GraphNode>();
      nodes.set(rootTask.id, {
        id: rootTask.id,
        title: rootTask.title,
        taskIdDisplay: rootTask.taskIdDisplay,
        status: rootTask.status,
        priority: rootTask.priority ?? 'medium',
      });

      const edges: GraphEdge[] = [];

      await Promise.all([
        traverseUpstream(taskId, orgId!, new Set(), new Set(), 0, nodes, edges, ctx),
        traverseDownstream(taskId, orgId!, new Set(), new Set(), 0, nodes, edges, ctx),
      ]);

      const maxDepth = Math.max(0, ...Array.from(ctx.nodeDepths.values()));

      const graphData: GraphData = {
        nodes: Array.from(nodes.values()),
        edges,
        stats: {
          totalNodes: nodes.size,
          totalEdges: edges.length,
          maxDepth,
          cycles: ctx.hasCycle,
        },
      };

      return NextResponse.json(graphData);
    } catch (error) {
      const { error: err, status } = handleApiError(error, 'Failed to fetch dependency graph');
      return NextResponse.json(err, { status });
    }
  },
  { windowMs: 60_000, max: 30, namespace: 'dependencies:deep' },
);
