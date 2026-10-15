import type { GraphData, NodeData } from '@antv/g6';
import type { DependencyGraph, FoldMark, GraphEntity, RelationFold } from '../entities/graph.entity';
import { FOLD_SUMMARY_SIZE, GRAPH_NODE_SIZE } from '../constants/graph.constants';
import { groupRank, sideOfType, type Side } from './arrange-graph';
import { isFoldSummaryNode } from './graph.util';
import { trunkEdges, type GraphNodePosition } from './route-graph-edges';

export type { GraphNodePosition } from './route-graph-edges';

const HALF_W = GRAPH_NODE_SIZE.width / 2;
const HALF_H = GRAPH_NODE_SIZE.height / 2;

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
  const fold = isFoldSummaryNode(item);
  const size = fold ? FOLD_SUMMARY_SIZE : GRAPH_NODE_SIZE;
  const node: NodeData = {
    id: item.id,
    type: 'work-item-card',
    data: {
      // 收起入口只保留「+ N」占位；卡片上仅展示展开态的「−」
      foldMarks: fold ? [] : foldMarks(item, position, rootId, forks),
      item,
      root: item.id === rootId,
      width: size.width,
      height: size.height,
    },
  };
  if (position) {
    node.style = { ...node.style, x: position.x, y: position.y };
  }
  return node;
}

/** 仅展开态：在分叉处画「−」。收起态入口是「+ N」占位，不再画卡片边 chevron。 */
function foldMarks(
  item: GraphEntity,
  position: GraphNodePosition | undefined,
  rootId: string,
  forks?: ReadonlyMap<string, { x: number; y: number }>,
): FoldMark[] {
  if (!position || !forks) {
    return [];
  }
  const marks: FoldMark[] = [];
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    for (const fold of foldsOnSide(item.folds, side, item.id === rootId, position.side)) {
      if (!fold.expanded) {
        continue;
      }
      const at = forks.get(fold.key);
      if (!at) {
        continue;
      }
      marks.push({
        key: fold.key,
        text: '−',
        left: HALF_W + at.x - position.x,
        top: HALF_H + at.y - position.y,
      });
    }
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
