import { KIND_ICON_STYLE } from '../constants/graph.constants';
import type { DependencyGraph, GraphEdge, GraphEntity } from '../entities/graph.entity';
import { relationLabel } from './graph.util';

/** getDeepRelation 返回的可达节点。 */
export interface KgReachedNode {
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

/** getDeepRelation 返回的边。 */
export interface KgEdgeRecord {
  id?: string;
  type?: string;
  from_id?: string;
  to_id?: string;
}

/** getDeepRelation 完整结果。 */
export interface KgDeepRelationResult {
  rootId: string;
  nodes?: KgReachedNode[];
  edges?: KgEdgeRecord[];
}

/** 图谱边 type → 图上关系类型。 */
const RELATION_BY_EDGE: Record<string, string> = {
  blocks: 'block',
  blocked_by: 'blockedBy',
  causes: 'cause',
  caused_by: 'causedBy',
  clones: 'clone',
  cloned_by: 'clonedBy',
  duplicates: 'duplicate',
  mentions: 'mention',
  relates: 'relate',
};

/** 关联按对端 kind 分成不同关系，避免工作项和产品需求混在一起。 */
const RELATE_TYPE_BY_KIND: Record<string, string> = {
  work_item: 'relate:work_item',
  idea: 'relate:idea',
  ticket: 'relate:ticket',
  test_case: 'relate:test_case',
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

/** KG 深关系结果 → 领域图（含 hub 分组）。 */
export function toDependencyGraph(
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

  const grouped = groupRelationHubs(rootId, nodes, [...edges.values()]);
  return {
    rootId,
    depth,
    nodes: grouped.nodes,
    edges: grouped.edges,
  };
}

function toEntity(reached: KgReachedNode): GraphEntity | null {
  const node = reached.node;
  const id = node?.id;
  if (!id) {
    return null;
  }
  const detail = node.detail;
  const kindIcon = node.kind ? KIND_ICON_STYLE[node.kind] : undefined;
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
    icon: kindIcon?.icon ?? detail?.type_icon,
    iconColor: kindIcon?.color ?? detail?.type_color,
    navigationTarget: node.kind ? KIND_NAVIGATION[node.kind] : undefined,
    depth: reached.depth,
  };
}

function toEdge(
  edge: KgEdgeRecord,
  kindById: ReadonlyMap<string, string>,
  rootId: string,
): GraphEdge | null {
  if (!edge.id || !edge.from_id || !edge.to_id || !edge.type) {
    return null;
  }
  // parent_of：子 → 父。根是子则展示「父工作项」，根是父则展示「子工作项」。
  if (edge.type === 'parent_of') {
    const fromRoot = edge.from_id === rootId;
    const relationType = fromRoot ? 'parent' : 'child';
    return {
      id: edge.id,
      source: fromRoot ? edge.from_id : edge.to_id,
      target: fromRoot ? edge.to_id : edge.from_id,
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

/** 同一起点、同一种关系有多个对象时，收成一个隐形分叉点（relationHub）。 */
function groupRelationHubs(
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
