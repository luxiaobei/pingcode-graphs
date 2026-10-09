import { invoke, NavigationTarget, view } from '@pc-nexus/bridge';
import type { DependencyGraph, GraphEdge, GraphEntity } from '../entities/graph.entity';
import type { RelationType } from '../enums/graph.enum';

interface ServerNode extends Omit<GraphEntity, 'scope' | 'navigationTarget' | 'depth'> {
  project?: GraphEntity['scope'];
  scope?: GraphEntity['scope'];
  navigationTarget?: string;
}

interface ServerGraph {
  rootId: string;
  depth: number;
  nodes: ServerNode[];
  edges: GraphEdge[];
  criticalPath: string[];
}

export async function loadDependencyGraph(
  depth: 1 | 2 | 3,
  relationTypes: RelationType[],
): Promise<DependencyGraph> {
  const workitemId = await readContextWorkItemId();
  const payload: { depth: number; relationTypes: RelationType[]; workitemId?: string } = {
    depth,
    relationTypes: [...relationTypes],
  };
  if (workitemId) {
    payload.workitemId = workitemId;
  }
  const data = await invoke<typeof payload, ServerGraph>('getDependencyGraph', payload);
  return toDependencyGraph(data);
}

function toDependencyGraph(data: ServerGraph): DependencyGraph {
  const depths = hopDepths(data.rootId, data.edges);
  return {
    rootId: data.rootId,
    depth: data.depth,
    nodes: data.nodes.map((node) => toEntity(node, depths.get(node.id))),
    edges: data.edges,
    criticalPath: data.criticalPath ?? [],
  };
}

function toEntity(node: ServerNode, depth: number | undefined): GraphEntity {
  const entity: GraphEntity = {
    id: node.id,
    navigationTarget: node.navigationTarget ?? NavigationTarget.Workitem,
  };
  assign(entity, 'identifier', node.identifier);
  assign(entity, 'title', node.title);
  assign(entity, 'type', node.type);
  assign(entity, 'state', node.state);
  assign(entity, 'priority', node.priority);
  assign(entity, 'assignee', node.assignee);
  assign(entity, 'scope', node.scope ?? node.project);
  assign(entity, 'depth', depth);
  return entity;
}

function hopDepths(rootId: string, edges: GraphEdge[]): Map<string, number> {
  const neighbors = new Map<string, string[]>();
  for (const edge of edges) {
    pushNeighbor(neighbors, edge.source, edge.target);
    pushNeighbor(neighbors, edge.target, edge.source);
  }

  const depths = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift()!;
    const level = depths.get(current) ?? 0;
    for (const next of neighbors.get(current) ?? []) {
      if (depths.has(next)) {
        continue;
      }
      depths.set(next, level + 1);
      queue.push(next);
    }
  }
  return depths;
}

function pushNeighbor(neighbors: Map<string, string[]>, from: string, to: string): void {
  const list = neighbors.get(from) ?? [];
  list.push(to);
  neighbors.set(from, list);
}

function assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

async function readContextWorkItemId(): Promise<string | undefined> {
  const context = await view.getContext<{ workitem?: { id?: string } }>();
  const id = context.extension?.data?.workitem?.id;
  return id || undefined;
}
