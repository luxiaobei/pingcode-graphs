import type { DependencyGraph, GraphEdge, GraphEntity, RelationFold } from '../entities/graph.entity';
import { sideOfType } from './arrange-graph';
import {
  BUNDLE_FOLD_TYPE,
  foldSummaryNodeId,
  isBundleRelationType,
  isFoldSummaryNode,
  relationBundleFoldKey,
  relationFoldKey,
  relationLabel,
} from './graph.util';

/** 默认落在上侧、走公共脊的其它关系（关联/阻塞/重复等，不含父） */
function isTopBundleRelation(type: string): boolean {
  return isBundleRelationType(type) && sideOfType(type) === 'top';
}

/** 无向邻接表：source/target 互为邻居 */
function neighborMap(edges: GraphEdge[]): Map<string, Set<string>> {
  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    const from = neighbors.get(edge.source) ?? new Set<string>();
    const to = neighbors.get(edge.target) ?? new Set<string>();
    from.add(edge.target);
    to.add(edge.source);
    neighbors.set(edge.source, from);
    neighbors.set(edge.target, to);
  }
  return neighbors;
}

/** 工作项相对根的跳数。关系分叉点与上一级同级，不单独占一跳。 */
function attachHopDepth(graph: DependencyGraph): DependencyGraph {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const neighbors = neighborMap(graph.edges);
  const hop = new Map<string, number>([[graph.rootId, 0]]);
  const queue = [graph.rootId];

  while (queue.length) {
    const current = queue.shift()!;
    const nextHop = (hop.get(current) ?? 0) + 1;
    for (const neighbor of neighbors.get(current) ?? []) {
      const node = nodeById.get(neighbor);
      if (!node || hop.has(neighbor)) {
        continue;
      }
      if (node.relationHub) {
        hop.set(neighbor, hop.get(current) ?? 0);
        for (const child of neighbors.get(neighbor) ?? []) {
          if (child !== current && !hop.has(child)) {
            hop.set(child, nextHop);
            queue.push(child);
          }
        }
        continue;
      }
      hop.set(neighbor, nextHop);
      queue.push(neighbor);
    }
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, depth: hop.get(node.id) ?? node.depth })),
  };
}

interface OutwardStep {
  hubId?: string;
  nodeId: string;
  relationType: string;
}

/**
 * 未收起的关系全部展示。收起按「父节点 + 关系类型」，不影响这张卡片上的其他关系。
 */
export function buildVisibleGraph(
  source: DependencyGraph,
  collapsedIds: ReadonlySet<string>,
): DependencyGraph {
  const graph = attachHopDepth(source);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const neighbors = neighborMap(graph.edges);
  const depthOf = (id: string) => nodeById.get(id)?.depth ?? Number.MAX_SAFE_INTEGER;

  const edgeType = (parentId: string, childId: string): string => {
    const edge = graph.edges.find(
      (item) =>
        (item.source === parentId && item.target === childId) ||
        (item.target === parentId && item.source === childId),
    );
    return edge?.relationType ?? 'relate';
  };

  const outward = (id: string): OutwardStep[] => {
    const steps: OutwardStep[] = [];
    for (const neighbor of neighbors.get(id) ?? []) {
      const node = nodeById.get(neighbor);
      if (!node) {
        continue;
      }
      if (node.relationHub) {
        const relationType = node.relationHub;
        for (const child of neighbors.get(neighbor) ?? []) {
          if (child !== id && depthOf(child) > depthOf(id)) {
            steps.push({ hubId: neighbor, nodeId: child, relationType });
          }
        }
        continue;
      }
      if (depthOf(neighbor) > depthOf(id)) {
        steps.push({ nodeId: neighbor, relationType: edgeType(id, neighbor) });
      }
    }
    return steps.sort(
      (a, b) => depthOf(a.nodeId) - depthOf(b.nodeId) || a.relationType.localeCompare(b.relationType) || a.nodeId.localeCompare(b.nodeId),
    );
  };

  const visibleIds = new Set<string>([graph.rootId]);
  const parentOf = new Map<string, string>();
  const queue = [graph.rootId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const step of outward(current)) {
      // 上方位其它关系：整体收起；父/子/左右仍按类型收起
      if (
        isTopBundleRelation(step.relationType) &&
        collapsedIds.has(relationBundleFoldKey(current))
      ) {
        continue;
      }
      if (collapsedIds.has(relationFoldKey(current, step.relationType))) {
        continue;
      }
      if (step.hubId) {
        visibleIds.add(step.hubId);
      }
      if (visibleIds.has(step.nodeId)) {
        continue;
      }
      visibleIds.add(step.nodeId);
      parentOf.set(step.nodeId, current);
      queue.push(step.nodeId);
    }
  }

  const foldsOf = (id: string): RelationFold[] | undefined => {
    const groups = new Map<string, number>();
    for (const step of outward(id)) {
      groups.set(step.relationType, (groups.get(step.relationType) ?? 0) + 1);
    }
    if (!groups.size) {
      return undefined;
    }
    const folds: RelationFold[] = [];
    const topBundleEntries = [...groups.entries()].filter(([type]) => isTopBundleRelation(type));
    if (topBundleEntries.length) {
      const bundleKey = relationBundleFoldKey(id);
      const bundleCount = topBundleEntries.reduce((sum, [, count]) => sum + count, 0);
      // 仅一种时边上仍用该关系名；多种时用「关联」
      const bundleType =
        topBundleEntries.length === 1
          ? (topBundleEntries[0]?.[0] ?? BUNDLE_FOLD_TYPE)
          : BUNDLE_FOLD_TYPE;
      folds.push({
        key: bundleKey,
        relationType: bundleType,
        count: bundleCount,
        expanded: !collapsedIds.has(bundleKey),
      });
    }
    for (const [relationType, count] of groups.entries()) {
      if (isTopBundleRelation(relationType)) {
        // 上方位其它关系只保留整体收起
        continue;
      }
      const key = relationFoldKey(id, relationType);
      folds.push({ key, relationType, count, expanded: !collapsedIds.has(key) });
    }
    return folds.length ? folds : undefined;
  };

  const visible: DependencyGraph = {
    rootId: graph.rootId,
    depth: graph.depth,
    nodes: graph.nodes
      .filter((node) => visibleIds.has(node.id))
      .map((node) => ({
        ...node,
        folds: node.relationHub ? undefined : foldsOf(node.id),
        revealedByAnchorId: parentOf.get(node.id),
      })),
    edges: graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
  };
  return withFoldSummaries(visible);
}

/** 收起的关系每种变成一个「+ N」占位节点，边上带关系名与数量。 */
function withFoldSummaries(graph: DependencyGraph): DependencyGraph {
  const extras: GraphEntity[] = [];
  const extraEdges: GraphEdge[] = [];

  for (const node of graph.nodes) {
    if (node.relationHub || isFoldSummaryNode(node) || !node.folds?.length) {
      continue;
    }
    for (const fold of node.folds) {
      if (fold.expanded) {
        continue;
      }
      const id = foldSummaryNodeId(fold.key);
      extras.push({
        id,
        title: `+ ${fold.count}`,
        foldSummary: fold,
        revealedByAnchorId: node.id,
        depth: (node.depth ?? 0) + 1,
      });
      extraEdges.push({
        id: `${id}:link`,
        source: node.id,
        target: id,
        relationType: fold.relationType,
        label: relationLabel(fold.relationType),
      });
    }
  }

  if (!extras.length) {
    return graph;
  }
  return {
    ...graph,
    nodes: [...graph.nodes, ...extras],
    edges: [...graph.edges, ...extraEdges],
  };
}
