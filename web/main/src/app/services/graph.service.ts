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
      type_icon?: string;
      type_color?: string;
      state_name?: string;
      state_type?: string;
      priority?: string;
      assignee_name?: string;
      assignee_avatar?: string;
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
  'parent_of',
] as const;

/**
 * 图谱边类型 → 图上的关系类型。
 * 与已有筛选值对齐：blocks → block，mentions → mention。
 * parent_of 的方向是子项指向父项，在 toEdge 里分成「父」和「子」。
 */
const RELATION_BY_EDGE: Record<string, string> = {
  blocks: 'block',
  causes: 'cause',
  depends_on: 'depend',
  duplicates: 'duplicate',
  mentions: 'mention',
  clones: 'clone',
  relates: 'relate',
};

/** 关联按对端 kind 分成不同关系，避免工作项和产品需求混在一起。 */
const RELATE_TYPE_BY_KIND: Record<string, string> = {
  work_item: 'relate:work_item',
  idea: 'relate:idea',
  ticket: 'relate:ticket',
  test_case: 'relate:test_case',
  objective: 'relate:objective',
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

/** 出边只取直接关系，其中 parent_of 是当前项指向的直属父项。 */
const RELATION_DEPTH = 1;

/** 子项经 parent_of 指向父项。incoming 顺着这条边展开子树。 */
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
    const mapped = toEdge(edge, kindById, rootId);
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

  const grouped = groupRelationNodes(rootId, nodes, [...edges.values()]);
  return {
    rootId,
    depth,
    nodes: grouped.nodes,
    edges: grouped.edges,
  };
}

/** 从根往外，每个对象第一次被走到的那条边保留原 id，再次出现则复制一份。 */
function primaryEdgeIds(rootId: string, edges: GraphEdge[]): Map<string, string> {
  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
  }

  const primary = new Map<string, string>();
  const seen = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of outgoing.get(current) ?? []) {
      if (seen.has(edge.target)) {
        continue;
      }
      seen.add(edge.target);
      primary.set(edge.target, edge.id);
      queue.push(edge.target);
    }
  }
  return primary;
}

/** 同一起点、同一种关系有多个对象时，收成一个隐形分叉点。 */
function groupRelationNodes(
  rootId: string,
  entities: ReadonlyMap<string, GraphEntity>,
  edges: GraphEdge[],
): { nodes: GraphEntity[]; edges: GraphEdge[] } {
  const primary = primaryEdgeIds(rootId, edges);
  const nodes = new Map<string, GraphEntity>();
  const root = entities.get(rootId);
  if (root) {
    nodes.set(rootId, root);
  }

  const groups = new Map<string, Map<string, GraphEdge[]>>();
  for (const edge of edges) {
    const source = entities.get(edge.source);
    if (source) {
      nodes.set(edge.source, source);
    }
    const byType = groups.get(edge.source) ?? new Map<string, GraphEdge[]>();
    const list = byType.get(edge.relationType) ?? [];
    list.push(edge);
    byType.set(edge.relationType, list);
    groups.set(edge.source, byType);
  }

  const nextEdges: GraphEdge[] = [];
  for (const [source, byType] of groups) {
    for (const [relationType, group] of byType) {
      const label = relationLabel(relationType);
      const hubId = `rel:${source}:${relationType}`;
      const fork = group.length > 1;
      const from = fork ? hubId : source;
      if (fork) {
        nodes.set(hubId, { id: hubId, title: label, relationHub: relationType });
        nextEdges.push({ id: `${hubId}:link`, source, target: hubId, relationType, label });
      }
      for (const edge of group) {
        const keepId = primary.get(edge.target) === edge.id;
        const targetId = keepId ? edge.target : `${hubId}:${edge.target}`;
        const entity = entities.get(edge.target);
        if (entity) {
          nodes.set(targetId, keepId ? entity : { ...entity, id: targetId });
        }
        nextEdges.push({
          id: edge.id,
          source: from,
          target: targetId,
          relationType,
          label: fork ? '' : label,
        });
      }
    }
  }

  return { nodes: [...nodes.values()], edges: nextEdges };
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
    assignee:
      detail?.assignee_name || detail?.assignee_avatar
        ? {
            display_name: detail.assignee_name,
            name: detail.assignee_name,
            avatar: detail.assignee_avatar,
          }
        : undefined,
    icon: detail?.type_icon,
    iconColor: detail?.type_color,
    navigationTarget: node.kind ? KIND_NAVIGATION[node.kind] : undefined,
    depth: reached.depth,
  };
}

function toEdge(edge: KgEdgeRecord, kindById: ReadonlyMap<string, string>, rootId: string): GraphEdge | null {
  if (!edge.id || !edge.from_id || !edge.to_id || !edge.type) {
    return null;
  }
  if (edge.type === 'parent_of') {
    const toParent = edge.from_id === rootId;
    const source = toParent ? edge.from_id : edge.to_id;
    const target = toParent ? edge.to_id : edge.from_id;
    const relationType = toParent ? 'parent' : 'child';
    return {
      id: edge.id,
      source,
      target,
      relationType,
      label: relationLabel(relationType),
    };
  }
  const mapped = RELATION_BY_EDGE[edge.type] ?? edge.type;
  const relationType = mapped === 'relate' ? relateType(edge.to_id, kindById) : mapped;
  return {
    id: edge.id,
    source: edge.from_id,
    target: edge.to_id,
    relationType,
    label: relationLabel(relationType),
  };
}

/** 对端 kind 决定关联关系；kind 缺失时从节点 id 前缀读取。 */
function relateType(nodeId: string, kindById: ReadonlyMap<string, string>): string {
  const kind = kindById.get(nodeId) ?? nodeId.slice(0, nodeId.indexOf(':'));
  return RELATE_TYPE_BY_KIND[kind] ?? 'relate';
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

