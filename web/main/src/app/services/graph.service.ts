import { invoke, view } from '@pc-nexus/bridge';
import type { DependencyGraph, GetDependencyGraphPayload, GraphEdge, GraphEntity } from '../entities/graph.entity';
import { relationLabel } from '../utils/graph.util';

/** 与后端 getDeepRelation 的 payload 对齐。 */
interface GetDeepRelationPayload {
  nodeId: string;
  type: string[];
  depth: number;
  direction?: 'outgoing' | 'incoming' | 'both';
}

interface KgReachedNode {
  depth?: number;
  node?: {
    id?: string;
    kind?: string;
    name?: string;
    identifier?: string;
    detail?: {
      type_name?: string;
      state_name?: string;
      state_type?: string;
      priority?: string;
    };
  };
}

interface KgEdgeRecord {
  id?: string;
  type?: string;
  from_id?: string;
  to_id?: string;
}

interface KgDeepRelationResult {
  rootId: string;
  nodes?: KgReachedNode[];
  edges?: KgEdgeRecord[];
}

/** 一次查出的出边，对应 pc-kg-edge 中的关联类边。 */
const OUTGOING_EDGE_TYPES = [
  'blocks',
  'causes',
  'depends_on',
  'duplicates',
  'mentions',
  'clones',
  'relates',
] as const;

/**
 * 图谱边类型 → 图上的关系类型。
 * 与已有筛选值对齐：blocks → block，mentions → mention。
 * parent_of 画成从父项指向子项，所以关系类型是 child。
 */
const RELATION_BY_EDGE: Record<string, string> = {
  blocks: 'block',
  causes: 'cause',
  depends_on: 'depend',
  duplicates: 'duplicate',
  mentions: 'mention',
  clones: 'clone',
  relates: 'relate',
  parent_of: 'child',
};

/** 关联边文案看对端节点 kind。 */
const RELATE_LABEL_BY_KIND: Record<string, string> = {
  work_item: '关联工作项',
  idea: '关联产品需求',
  ticket: '关联工单',
  test_case: '关联测试',
  objective: '关联目标',
};

const KIND_NAVIGATION: Record<string, string> = {
  work_item: 'workitem',
  test_case: 'testcase',
  idea: 'idea',
  ticket: 'ticket',
  page: 'page',
  project: 'project',
  library: 'library',
  space: 'space',
  product: 'product',
};

/** 关联出边只取直接关系。 */
const RELATION_DEPTH = 1;

/** 子项经 parent_of 指向父项；incoming 展开子树。 */
const CHILD_DEPTH = 5;

/** 按当前工作项拉取真实关系图。 */
export async function getDependencyGraph(
  payload: GetDependencyGraphPayload = {},
): Promise<DependencyGraph> {
  const context = await view.getContext<{ workitem?: { id?: string } }>();
  const workitemId = payload.workitemId || context.extension?.data?.workitem?.id;
  if (!workitemId) {
    throw new Error('缺少当前工作项，无法加载关系图');
  }
  const nodeId = workitemId.includes(':') ? workitemId : `work_item:${workitemId}`;
  const [relations, children] = await Promise.all([
    fetchRelation(nodeId, [...OUTGOING_EDGE_TYPES], RELATION_DEPTH, 'outgoing'),
    fetchRelation(nodeId, ['parent_of'], CHILD_DEPTH, 'incoming'),
  ]);
  return toDependencyGraph(nodeId, CHILD_DEPTH, mergeResults(relations, children));
}

function fetchRelation(
  nodeId: string,
  type: string[],
  depth: number,
  direction: GetDeepRelationPayload['direction'],
): Promise<KgDeepRelationResult> {
  return invoke<GetDeepRelationPayload, KgDeepRelationResult>('getDeepRelation', {
    nodeId,
    type,
    depth,
    direction,
  });
}

function mergeResults(...results: KgDeepRelationResult[]): KgDeepRelationResult {
  const nodes = new Map<string, KgReachedNode>();
  const edges = new Map<string, KgEdgeRecord>();
  for (const result of results) {
    for (const reached of result.nodes ?? []) {
      const id = reached.node?.id;
      if (!id) {
        continue;
      }
      const existing = nodes.get(id);
      if (!existing || (reached.depth ?? 0) < (existing.depth ?? 0)) {
        nodes.set(id, reached);
      }
    }
    for (const edge of result.edges ?? []) {
      if (edge.id) {
        edges.set(edge.id, edge);
      }
    }
  }
  return {
    rootId: results[0]?.rootId ?? '',
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}

function toDependencyGraph(
  rootId: string,
  depth: number,
  result: KgDeepRelationResult,
): DependencyGraph {
  const nodes = new Map<string, GraphEntity>();
  const kindById = new Map<string, string>();

  for (const reached of result.nodes ?? []) {
    const entity = toEntity(reached);
    if (!entity) {
      continue;
    }
    nodes.set(entity.id, entity);
    const kind = reached.node?.kind;
    if (kind) {
      kindById.set(entity.id, kind);
    }
  }

  const edges = new Map<string, GraphEdge>();
  for (const edge of result.edges ?? []) {
    const mapped = toEdge(edge, kindById);
    if (!mapped) {
      continue;
    }
    edges.set(mapped.id, mapped);
    ensureNode(nodes, mapped.source);
    ensureNode(nodes, mapped.target);
  }

  if (!nodes.has(rootId)) {
    nodes.set(rootId, {
      id: rootId,
      title: '当前工作项',
      navigationTarget: 'workitem',
      depth: 0,
    });
  }

  const edgeList = [...edges.values()];
  return {
    rootId,
    depth,
    nodes: [...nodes.values()],
    edges: edgeList,
    criticalPath: findCriticalPath(rootId, edgeList),
  };
}

function toEntity(reached: KgReachedNode): GraphEntity | null {
  const node = reached.node;
  const id = node?.id;
  if (!id) {
    return null;
  }
  const detail = node.detail;
  return {
    id,
    identifier: node.identifier,
    title: node.name,
    type: detail?.type_name ? { name: detail.type_name } : undefined,
    state:
      detail?.state_name || detail?.state_type
        ? { name: detail.state_name, type: detail.state_type }
        : undefined,
    priority: detail?.priority ? { name: detail.priority } : undefined,
    navigationTarget: node.kind ? KIND_NAVIGATION[node.kind] : undefined,
    depth: reached.depth,
  };
}

function toEdge(edge: KgEdgeRecord, kindById: ReadonlyMap<string, string>): GraphEdge | null {
  if (!edge.id || !edge.from_id || !edge.to_id || !edge.type) {
    return null;
  }
  const relationType = RELATION_BY_EDGE[edge.type] ?? edge.type;
  const childEdge = relationType === 'child';
  const source = childEdge ? edge.to_id : edge.from_id;
  const target = childEdge ? edge.from_id : edge.to_id;
  return {
    id: edge.id,
    source,
    target,
    relationType,
    label: relationType === 'relate' ? relateLabel(target, kindById) : relationLabel(relationType),
  };
}

/** 出边指向的节点决定关联文案；kind 缺失时从节点 id 前缀读取。 */
function relateLabel(nodeId: string, kindById: ReadonlyMap<string, string>): string {
  const kind = kindById.get(nodeId) ?? nodeId.slice(0, nodeId.indexOf(':'));
  return RELATE_LABEL_BY_KIND[kind] ?? relationLabel('relate');
}

function ensureNode(nodes: Map<string, GraphEntity>, id: string): void {
  if (nodes.has(id)) {
    return;
  }
  nodes.set(id, {
    id,
    title: id,
    navigationTarget: id.startsWith('work_item:') ? 'workitem' : undefined,
  });
}

function findCriticalPath(rootId: string, edges: GraphEdge[]): string[] {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.relationType !== 'block') {
      continue;
    }
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge.target);
    outgoing.set(edge.source, list);
  }
  if (!outgoing.size) {
    return [rootId];
  }

  let bestPath = [rootId];
  const visit = (nodeId: string, path: string[], seen: Set<string>) => {
    if (path.length > bestPath.length) {
      bestPath = [...path];
    }
    for (const next of outgoing.get(nodeId) ?? []) {
      if (seen.has(next)) {
        continue;
      }
      seen.add(next);
      path.push(next);
      visit(next, path, seen);
      path.pop();
      seen.delete(next);
    }
  };
  visit(rootId, [rootId], new Set([rootId]));
  return bestPath;
}
