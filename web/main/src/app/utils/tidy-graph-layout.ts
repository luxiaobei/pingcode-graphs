import { FOLD_SUMMARY_SIZE, GRAPH_NODE_SIZE } from '../constants/graph.constants';
import type { DependencyGraph } from '../entities/graph.entity';
import {
  arrangeGraph,
  isAssocBundleRelation,
  preferredSideByNode,
  sideFromParent,
  type Side,
} from './arrange-graph';
import { BUNDLE_FOLD_TYPE, isFoldSummaryNode, relationBetween } from './graph.util';

type TidyNodePosition = { x: number; y: number; side?: Side };

/** 一键整理：pins 多数票定方位 → arrange → 钉根。不读/写 saved（初始化走 resolveBaseline）。 */
export function tidyGraphLayout(
  graph: DependencyGraph,
  pins: ReadonlyMap<string, TidyNodePosition>,
): Map<string, TidyNodePosition> {
  const relationSides = inferRelationSidesFromPins(graph, pins);
  const arranged = arrangeGraph(graph, relationSides);
  const sideByNode = preferredSideByNode(graph, relationSides);
  const rootPin = pins.get(graph.rootId);
  const arrangedRoot = arranged.get(graph.rootId);
  const dx = rootPin && arrangedRoot ? rootPin.x - arrangedRoot.x : 0;
  const dy = rootPin && arrangedRoot ? rootPin.y - arrangedRoot.y : 0;

  const next = new Map<string, TidyNodePosition>();
  for (const [id, pos] of arranged) {
    const side = sideByNode.get(id) ?? pos.side;
    next.set(id, side ? { x: pos.x + dx, y: pos.y + dy, side } : { x: pos.x + dx, y: pos.y + dy });
  }
  return next;
}

/** pins → 关系类型方位（多数票）；关联类汇总到 bundle。 */
function inferRelationSidesFromPins(
  graph: DependencyGraph,
  pins: ReadonlyMap<string, TidyNodePosition>,
): Map<string, Side> {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const votes = new Map<string, Map<Side, number>>();

  const vote = (type: string, side: Side): void => {
    const bucket = votes.get(type) ?? new Map<Side, number>();
    bucket.set(side, (bucket.get(side) ?? 0) + 1);
    votes.set(type, bucket);
  };

  for (const node of graph.nodes) {
    if (node.relationHub || !node.revealedByAnchorId || node.id === graph.rootId) {
      continue;
    }
    const type =
      node.foldSummary?.relationType ??
      relationBetween(graph.edges, nodes, node.revealedByAnchorId, node.id);
    const pin = pins.get(node.id);
    let side = pin?.side;
    if (!side) {
      const parent = pins.get(node.revealedByAnchorId) ?? { x: 0, y: 0 };
      const child = pin ?? { x: parent.x, y: parent.y - GRAPH_NODE_SIZE.height };
      const fold = isFoldSummaryNode(node);
      const half = fold
        ? { w: FOLD_SUMMARY_SIZE.width / 2, h: FOLD_SUMMARY_SIZE.height / 2 }
        : { w: GRAPH_NODE_SIZE.width / 2, h: GRAPH_NODE_SIZE.height / 2 };
      side = sideFromParent(parent, child, half);
    }
    vote(type, side);
    if (type !== BUNDLE_FOLD_TYPE && isAssocBundleRelation(type)) {
      vote(BUNDLE_FOLD_TYPE, side);
    }
  }

  const result = new Map<string, Side>();
  for (const [type, bucket] of votes) {
    let best: Side | undefined;
    let bestCount = -1;
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const count = bucket.get(side) ?? 0;
      if (count > bestCount) {
        best = side;
        bestCount = count;
      }
    }
    if (best) {
      result.set(type, best);
    }
  }
  return result;
}
