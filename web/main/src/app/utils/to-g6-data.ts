import type { EdgeData, GraphData, NodeData } from '@antv/g6';
import type { DependencyGraph, GraphEdge, GraphEntity } from '../entities/graph.entity';
import { GRAPH_NODE_SIZE } from '../constants/graph.constants';
import { relationColor } from './graph.util';

export type GraphNodePosition = { x: number; y: number };
export type FoldPlacement = 'right' | 'left' | 'top' | 'bottom';

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
      toG6Node(item, childrenOf.get(item.id) ?? [], positions, foldSideHint),
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

/** 业务节点 → HTML 卡片。+/- 画在卡片上。 */
function toG6Node(
  item: GraphEntity,
  childIds: readonly string[],
  positions?: ReadonlyMap<string, GraphNodePosition>,
  foldSideHint?: ReadonlyMap<string, FoldPlacement>,
): NodeData {
  const position = positions?.get(item.id) ?? item.position;
  const foldPlacement = resolveFoldPlacement(item, childIds, positions, foldSideHint);
  const node: NodeData = {
    id: item.id,
    type: 'work-item-card',
    data: {
      expandToggle: item.expandToggle,
      foldPlacement,
      item,
      width: item.relationHub ? 1 : GRAPH_NODE_SIZE.width,
      height: item.relationHub ? 1 : GRAPH_NODE_SIZE.height,
    },
  };
  if (position) {
    node.style = { ...node.style, x: position.x, y: position.y };
  }
  return node;
}

/** 业务边 → 折线。分叉主干不画箭头，关系名在有文字的那段线上。 */
function toG6Edge(edge: GraphEdge): EdgeData {
  const trunk = edge.id.endsWith(':link');
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: {
      relationType: edge.relationType,
      label: edge.label,
      color: relationColor(edge.relationType),
      endArrow: !trunk,
    },
  };
}
