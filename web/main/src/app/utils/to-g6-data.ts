import type { GraphData, NodeData } from '@antv/g6';
import type { DependencyGraph, FoldMark, GraphEntity, RelationFold } from '../entities/graph.entity';
import { FOLD_SUMMARY_SIZE, GRAPH_NODE_SIZE } from '../constants/graph.constants';
import { groupRank, sideOfType, type Side } from './arrange-graph';
import { trunkEdges, type GraphNodePosition } from './route-graph-edges';

export type { GraphNodePosition } from './route-graph-edges';

const HALF_W = GRAPH_NODE_SIZE.width / 2;
const HALF_H = GRAPH_NODE_SIZE.height / 2;
/** 同一侧多种关系的展开收起沿边拉开，避免叠在同一个起点。 */
const BADGE_GAP = 28;

/** 领域图 → G6 节点/边。展开收起画在关系分叉处；收起时每种关系一个「+ N」。 */
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

/** 业务卡片或折叠占位。关系按钮的坐标相对这张卡片。 */
function toG6Node(
  item: GraphEntity,
  positions: ReadonlyMap<string, GraphNodePosition> | undefined,
  rootId: string,
  forks: ReadonlyMap<string, { x: number; y: number }>,
): NodeData {
  const position = positions?.get(item.id) ?? item.position;
  const fold = item.foldSummary;
  const width = fold ? FOLD_SUMMARY_SIZE.width : GRAPH_NODE_SIZE.width;
  const height = fold ? FOLD_SUMMARY_SIZE.height : GRAPH_NODE_SIZE.height;
  const node: NodeData = {
    id: item.id,
    type: 'work-item-card',
    data: {
      foldMarks: fold ? [] : foldMarks(item, position, rootId, forks),
      item,
      root: item.id === rootId,
      width,
      height,
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
  // 收起：卡片边上只留展开箭头；数量在「+ N」占位与边标签上
  for (const [side, list] of collapsed) {
    list.forEach((fold, index) => {
      const point = badgeOnCard(side, index, list.length);
      marks.push({
        key: fold.key,
        text: chevronOf(side),
        left: point.left,
        top: point.top,
      });
    });
  }
  return marks;
}

function chevronOf(side: Side): string {
  if (side === 'top') {
    return '▴';
  }
  if (side === 'bottom') {
    return '▾';
  }
  if (side === 'left') {
    return '◂';
  }
  return '▸';
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
