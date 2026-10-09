import type { DependencyGraph, GraphEdge, GraphEntity } from '../entities/graph.entity';

export interface ExpandGraphOptions {
  expandedIds?: ReadonlySet<string>;
  collapsedIds?: ReadonlySet<string>;
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

/** 相对根节点 BFS 跳数；服务端不下发 depth 时必须由前端计算 */
export function attachHopDepth(graph: DependencyGraph): DependencyGraph {
  const neighbors = neighborMap(graph.edges);
  const hop = new Map<string, number>([[graph.rootId, 0]]);
  const queue = [graph.rootId];

  while (queue.length) {
    const current = queue.shift()!;
    const nextHop = (hop.get(current) ?? 0) + 1;
    for (const neighbor of neighbors.get(current) ?? []) {
      if (hop.has(neighbor)) {
        continue;
      }
      hop.set(neighbor, nextHop);
      queue.push(neighbor);
    }
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      depth: hop.get(node.id) ?? node.depth,
    })),
  };
}

/**
 * 禅道卡片 ：
 * ka+/- 更深邻居视为子项；收起隐藏整棵向外子树。
 */
export function buildVisibleGraph(
  source: DependencyGraph,
  depth: number,
  options: ExpandGraphOptions = {},
): DependencyGraph {
  const graph = attachHopDepth(source);
  const expandedIds = options.expandedIds ?? new Set<string>();
  const collapsedIds = options.collapsedIds ?? new Set<string>();
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const neighbors = neighborMap(graph.edges);
  /** 节点相对根的跳数 */
  const depthOf = (id: string) => nodeById.get(id)?.depth ?? Number.MAX_SAFE_INTEGER;

  /** 比当前节点更深的邻居，视为可收起的子项 */
  const outward = (id: string): string[] =>
    [...(neighbors.get(id) ?? [])]
      .filter((nid) => nodeById.has(nid) && depthOf(nid) > depthOf(id))
      .sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b));

  const visibleIds = new Set<string>([graph.rootId]);
  const parentOf = new Map<string, string>();
  const queue = [graph.rootId];

  while (queue.length) {
    const current = queue.shift()!;
    if (collapsedIds.has(current)) {
      continue;
    }
    const includeBeyond = expandedIds.has(current);
    for (const child of outward(current)) {
      if (depthOf(child) > depth && !includeBeyond) {
        continue;
      }
      if (visibleIds.has(child)) {
        continue;
      }
      visibleIds.add(child);
      parentOf.set(child, current);
      queue.push(child);
    }
  }

  /** 有隐藏子项显示 +，子项都可见显示 − */
  const expandToggleOf = (id: string): GraphEntity['expandToggle'] => {
    const children = outward(id);
    if (!children.length) {
      return undefined;
    }
    const hidden = children.some((cid) => !visibleIds.has(cid));
    if (collapsedIds.has(id) || hidden) {
      return 'collapsed';
    }
    return 'expanded';
  };

  const nodes = graph.nodes
    .filter((node) => visibleIds.has(node.id))
    .map((node) => ({
      ...node,
      expandToggle: expandToggleOf(node.id),
      revealedByAnchorId: parentOf.get(node.id),
    }));

  const edges = graph.edges.filter(
    (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
  );
  const criticalPath = graph.criticalPath.filter((id) => visibleIds.has(id));

  return {
    rootId: graph.rootId,
    depth,
    nodes,
    edges,
    criticalPath: criticalPath.length ? criticalPath : [graph.rootId],
  };
}
