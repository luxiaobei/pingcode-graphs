import type { GraphData, NodeData } from '@antv/g6';
import type { DependencyGraph, FoldMark, GraphEntity, RelationFold } from '../entities/graph.entity';
import { GRAPH_NODE_SIZE } from '../constants/graph.constants';
import { groupRank, sideOfType, type Side } from './arrange-graph';
import { trunkEdges, type GraphNodePosition } from './route-graph-edges';

export type { GraphNodePosition } from './route-graph-edges';

const HALF_W = GRAPH_NODE_SIZE.width / 2;
const HALF_H = GRAPH_NODE_SIZE.height / 2;
/** 同一侧多种关系的展开收起沿边拉开，避免叠在同一个起点。 */
const BADGE_GAP = 28;

/** 领域图 → G6 节点/边。展开收起画在关系分叉处。 */
export function toG6Data(
  graph: DependencyGraph,
  positions?: ReadonlyMap<string, GraphNodePosition>,
): GraphData {
  const { edges, forks } = trunkEdges(graph, positions);
  const cards = graph.nodes.filter((item) => !item.relationHub);
  return {
    nodes: cards.map((item) => toG6Node(item, positions, graph.rootId, forks)),
    edges,
  };
}

/** 业务卡片。关系按钮的坐标相对这张卡片。 */
function toG6Node(
  item: GraphEntity,
  positions: ReadonlyMap<string, GraphNodePosition> | undefined,
  rootId: string,
  forks: ReadonlyMap<string, { x: number; y: number }>,
): NodeData {
  const position = positions?.get(item.id) ?? item.position;
  const node: NodeData = {
    id: item.id,
    type: 'work-item-card',
    data: {
      foldMarks: foldMarks(item, position, rootId, forks),
      item,
      root: item.id === rootId,
      width: item.relationHub ? 1 : GRAPH_NODE_SIZE.width,
      height: item.relationHub ? 1 : GRAPH_NODE_SIZE.height,
    },
  };
  if (position) {
    node.style = { ...node.style, x: position.x, y: position.y };
  }
  return node;
}

function foldMarks(
  item: GraphEntity,
  position: GraphNodePosition | undefined,
  rootId: string,
  forks?: ReadonlyMap<string, { x: number; y: number }>,
): FoldMark[] {
  const marks: FoldMark[] = [];
  const collapsed = new Map<Side, RelationFold[]>();
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    for (const fold of foldsOnSide(item.folds, side, item.id === rootId, position?.side)) {
      const at = fold.expanded ? forks?.get(fold.key) : undefined;
      if (at && position) {
        marks.push({
          key: fold.key,
          text: '−',
          left: HALF_W + at.x - position.x,
          top: HALF_H + at.y - position.y,
        });
        continue;
      }
      if (!fold.expanded) {
        const list = collapsed.get(side) ?? [];
        list.push(fold);
        collapsed.set(side, list);
      }
    }
  }
  for (const [side, list] of collapsed) {
    list.forEach((fold, index) => {
      const point = badgeOnCard(side, index, list.length);
      marks.push({
        key: fold.key,
        text: String(fold.count),
        left: point.left,
        top: point.top,
      });
    });
  }
  return marks;
}

function foldsOnSide(
  folds: RelationFold[] | undefined,
  side: Side,
  isRoot: boolean,
  nodeSide?: Side,
): RelationFold[] {
  return (folds ?? [])
    .filter(
      (fold) =>
        (isRoot ? sideOfType(fold.relationType) : (nodeSide ?? sideOfType(fold.relationType))) ===
        side,
    )
    .sort(
      (a, b) =>
        groupRank(a.relationType, side) - groupRank(b.relationType, side) ||
        a.relationType.localeCompare(b.relationType),
    );
}

function badgeOnCard(side: Side, index: number, count: number): { left: number; top: number } {
  const shift = (index - (count - 1) / 2) * BADGE_GAP;
  if (side === 'top') {
    return { left: HALF_W + shift, top: 0 };
  }
  if (side === 'bottom') {
    return { left: HALF_W + shift, top: GRAPH_NODE_SIZE.height };
  }
  if (side === 'left') {
    return { left: 0, top: HALF_H + shift };
  }
  return { left: GRAPH_NODE_SIZE.width, top: HALF_H + shift };
}
