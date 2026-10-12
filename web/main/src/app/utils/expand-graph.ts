import type { DependencyGraph, GraphEdge, GraphEntity } from '../entities/graph.entity';

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
}

/**
 * 未收起的子层级全部展示。关系分叉点不显示 +/-，展开收起落在工作项上。
 */
export function buildVisibleGraph(
  source: DependencyGraph,
  collapsedIds: ReadonlySet<string>,
): DependencyGraph {
  const graph = attachHopDepth(source);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const neighbors = neighborMap(graph.edges);
  const depthOf = (id: string) => nodeById.get(id)?.depth ?? Number.MAX_SAFE_INTEGER;

  const outward = (id: string): OutwardStep[] => {
    const steps: OutwardStep[] = [];
    for (const neighbor of neighbors.get(id) ?? []) {
      const node = nodeById.get(neighbor);
      if (!node) {
        continue;
      }
      if (node.relationHub) {
        for (const child of neighbors.get(neighbor) ?? []) {
          if (child !== id && depthOf(child) > depthOf(id)) {
            steps.push({ hubId: neighbor, nodeId: child });
          }
        }
        continue;
      }
      if (depthOf(neighbor) > depthOf(id)) {
        steps.push({ nodeId: neighbor });
      }
    }
    return steps.sort(
      (a, b) => depthOf(a.nodeId) - depthOf(b.nodeId) || a.nodeId.localeCompare(b.nodeId),
    );
  };

  const visibleIds = new Set<string>([graph.rootId]);
  const parentOf = new Map<string, string>();
  const queue = [graph.rootId];
  while (queue.length) {
    const current = queue.shift()!;
    if (collapsedIds.has(current)) {
      continue;
    }
    for (const step of outward(current)) {
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

  const expandToggleOf = (id: string): GraphEntity['expandToggle'] => {
    const children = outward(id);
    if (!children.length) {
      return undefined;
    }
    if (collapsedIds.has(id) || children.some((step) => !visibleIds.has(step.nodeId))) {
      return 'collapsed';
    }
    return 'expanded';
  };

  return {
    rootId: graph.rootId,
    depth: graph.depth,
    nodes: graph.nodes
      .filter((node) => visibleIds.has(node.id))
      .map((node) => ({
        ...node,
        expandToggle: node.relationHub ? undefined : expandToggleOf(node.id),
        revealedByAnchorId: parentOf.get(node.id),
      })),
    edges: graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
  };
}
