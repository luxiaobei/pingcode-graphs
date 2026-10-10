import type { EdgeData, GraphData, NodeData } from '@antv/g6';
import type { DependencyGraph, GraphEdge, GraphEntity } from '../entities/graph.entity';
import { entityTypeName, relationColor, truncate } from './graph.util';

export type GraphNodePosition = { x: number; y: number };
export type FoldPlacement = 'right' | 'left' | 'top' | 'bottom';

const BADGE_OFFSET: Record<FoldPlacement, { offsetX: number; offsetY: number }> = {
  left: { offsetX: -4, offsetY: 0 },
  right: { offsetX: 4, offsetY: 0 },
  top: { offsetX: 0, offsetY: -4 },
  bottom: { offsetX: 0, offsetY: 4 },
};

/** 领域图 → G6 节点/边，并带上坐标与 +/- 方位 */
export function toG6Data(
  graph: DependencyGraph,
  positions?: ReadonlyMap<string, GraphNodePosition>,
  foldSideHint?: ReadonlyMap<string, FoldPlacement>,
): GraphData {
  const childrenOf = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!node.revealedByAnchorId) {
      continue;
    }
    const list = childrenOf.get(node.revealedByAnchorId) ?? [];
    list.push(node.id);
    childrenOf.set(node.revealedByAnchorId, list);
  }

  return {
    nodes: graph.nodes.map((item) =>
      toG6Node(item, graph.rootId, childrenOf.get(item.id) ?? [], positions, foldSideHint),
    ),
    edges: graph.edges.map(toG6Edge),
  };
}

/** +/- 跟可见子项平均方位；收起后沿用上次所在侧 */
export function resolveFoldPlacement(
  item: GraphEntity,
  childIds: readonly string[],
  positions?: ReadonlyMap<string, GraphNodePosition>,
  foldSideHint?: ReadonlyMap<string, FoldPlacement>,
): FoldPlacement {
  const self = positions?.get(item.id) ?? item.position;
  if (self && positions && childIds.length) {
    let dx = 0;
    let dy = 0;
    let count = 0;
    for (const childId of childIds) {
      const pos = positions.get(childId);
      if (!pos) {
        continue;
      }
      dx += pos.x - self.x;
      dy += pos.y - self.y;
      count += 1;
    }
    if (count) {
      dx /= count;
      dy /= count;
      return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';
    }
  }
  return foldSideHint?.get(item.id) ?? 'right';
}

/** 卡片 +/- 徽标样式；无可展开子项则不显示 */
function expandBadge(item: GraphEntity, placement: FoldPlacement): NonNullable<NodeData['style']> {
  if (!item.expandToggle) {
    return { badge: false, badges: [] };
  }
  return {
    badge: true,
    badges: [
      {
        text: item.expandToggle === 'collapsed' ? '+' : '−',
        placement,
        ...BADGE_OFFSET[placement],
        fontSize: 12,
        fontWeight: 700,
        fill: '#334155',
        padding: [1, 5],
        backgroundFill: '#ffffff',
        backgroundStroke: '#94a3b8',
        backgroundLineWidth: 1,
        backgroundRadius: 10,
      },
    ],
  };
}

/** 业务节点 → G6 rect */
function toG6Node(
  item: GraphEntity,
  rootId: string,
  childIds: readonly string[],
  positions?: ReadonlyMap<string, GraphNodePosition>,
  foldSideHint?: ReadonlyMap<string, FoldPlacement>,
): NodeData {
  const position = positions?.get(item.id) ?? item.position;
  const foldPlacement = resolveFoldPlacement(item, childIds, positions, foldSideHint);
  const node: NodeData = {
    id: item.id,
    type: 'rect',
    data: {
      label: buildEntityLabel(item),
      expandToggle: item.expandToggle,
      foldPlacement,
      item,
    },
    style: expandBadge(item, foldPlacement),
  };
  if (position) {
    node.style = { ...node.style, x: position.x, y: position.y };
  }
  return node;
}

/** 业务边 → G6 直线虚线 */
function toG6Edge(edge: GraphEdge): EdgeData {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: {
      relationType: edge.relationType,
      label: edge.label,
      color: relationColor(edge.relationType),
    },
  };
}

/** 卡片文案：标识 / 标题 / 类型 */
function buildEntityLabel(item: GraphEntity): string {
  return [item.identifier ?? '', truncate(item.title ?? '未命名', 28), entityTypeName(item)]
    .filter(Boolean)
    .join('\n');
}
