import type { EdgeData, GraphData, NodeData } from '@antv/g6';
import type { DependencyGraph, FoldMark, GraphEntity } from '../entities/graph.entity';
import {
  EDGE_COLOR_OPACITY,
  EDGE_LABEL_COLOR_OPACITY,
  FOLD_SUMMARY_SIZE,
  GRAPH_NODE_SIZE,
  fadeColorOnWhite,
  relationEdgeColor,
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
  const colorMode = lineColorMode === 'item';
  const { edges, forks } = trunkEdges(graph, positions, { unstack: !colorMode });
  const cards = graph.nodes.filter((item) => !item.relationHub);
  const painted = edges.map((edge) => applyLineColorMode(edge, lineColorMode));
  // 彩色：关联干先画，具体关系后画盖住共用段
  if (colorMode) {
    painted.sort((a, b) => edgePaintOrder(a) - edgePaintOrder(b));
  }
  return {
    nodes: cards.map((item) => toG6Node(item, positions, graph.rootId, forks)),
    edges: painted,
  };
}

/** 越大越后画。 */
function edgePaintOrder(edge: EdgeData): number {
  const type = String(edge.data?.['relationType'] ?? '');
  if (type === 'bundle' || type === 'relate' || type === 'relate:work_item') {
    return 0;
  }
  if (type.startsWith('relate:')) {
    return 1;
  }
  return 2;
}

/** 彩色模式写入兑白后的边/文案色；默认色不写。 */
function applyLineColorMode(edge: EdgeData, mode: LineColorMode): EdgeData {
  if (
    mode !== 'item' ||
    edge.data?.['labelOnly'] === true ||
    edge.style?.['stroke'] === 'transparent'
  ) {
    return edge;
  }
  const solid = relationEdgeColor(String(edge.data?.['relationType'] ?? ''));
  const faded = fadeColorOnWhite(solid, EDGE_COLOR_OPACITY);
  const labelFaded = fadeColorOnWhite(solid, EDGE_LABEL_COLOR_OPACITY);
  return {
    ...edge,
    data: {
      ...edge.data,
      edgeColorSolid: solid,
      edgeColorFaded: faded,
      edgeColor: faded,
      labelColor: labelFaded,
    },
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
