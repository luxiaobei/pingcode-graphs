import type { EdgeData, GraphData, NodeData } from '@antv/g6';
import type { DependencyGraph, FoldMark, GraphEntity } from '../entities/graph.entity';
import {
  DEFAULT_EDGE_COLOR,
  FOLD_SUMMARY_SIZE,
  GRAPH_NODE_SIZE,
  KIND_ICON_STYLE,
} from '../constants/graph.constants';
import type { LineColorMode } from '../settings/display-settings';
import { isFoldSummaryNode } from './graph.util';
import { trunkEdges, type GraphNodePosition } from './route-graph-edges';

export type { GraphNodePosition } from './route-graph-edges';

const HALF_W = GRAPH_NODE_SIZE.width / 2;
const HALF_H = GRAPH_NODE_SIZE.height / 2;

/** 领域图 → G6 节点/边。展开收起画在关系分叉处；收起时每种关系一个「+ N」。 */
export function toG6Data(
  graph: DependencyGraph,
  positions?: ReadonlyMap<string, GraphNodePosition>,
  lineColorMode: LineColorMode = 'default',
): GraphData {
  const { edges, forks } = trunkEdges(graph, positions);
  const cards = graph.nodes.filter((item) => !item.relationHub);
  const nodesById = new Map(graph.nodes.map((item) => [item.id, item]));
  return {
    nodes: cards.map((item) => toG6Node(item, positions, graph.rootId, forks)),
    edges:
      lineColorMode === 'item' ? edges.map((edge) => colorEdgeByItem(edge, nodesById)) : edges,
  };
}

/** 按目标事项类型色（或关系专属色）描边；透明占位边不动。 */
function colorEdgeByItem(
  edge: EdgeData,
  nodesById: ReadonlyMap<string, GraphEntity>,
): EdgeData {
  if (edge.data?.['labelOnly'] === true || edge.style?.['stroke'] === 'transparent') {
    return edge;
  }
  const color = resolveItemEdgeColor(edge, nodesById);
  return {
    ...edge,
    style: {
      ...edge.style,
      stroke: color,
      labelFill: color,
    },
  };
}

function resolveItemEdgeColor(
  edge: EdgeData,
  nodesById: ReadonlyMap<string, GraphEntity>,
): string {
  const target = nodesById.get(String(edge.target));
  if (target?.iconColor) {
    return target.iconColor;
  }
  const relationType = String(edge.data?.['relationType'] ?? '');
  if (relationType === 'relate:idea') {
    return KIND_ICON_STYLE['idea'].color;
  }
  if (relationType === 'relate:ticket') {
    return KIND_ICON_STYLE['ticket'].color;
  }
  if (relationType === 'relate:test_case') {
    return KIND_ICON_STYLE['test_case'].color;
  }
  return DEFAULT_EDGE_COLOR;
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

/**
 * 仅展开态：在分叉处画「−」。
 * 位置完全跟 trunkEdges 的 forks 走，不用非根 nodeSide 过滤（左拖后否则会挂错）。
 */
function foldMarks(
  item: GraphEntity,
  position: GraphNodePosition | undefined,
  _rootId: string,
  forks?: ReadonlyMap<string, { x: number; y: number }>,
): FoldMark[] {
  if (!position || !forks) {
    return [];
  }
  const marks: FoldMark[] = [];
  for (const fold of item.folds ?? []) {
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
  return marks;
}
