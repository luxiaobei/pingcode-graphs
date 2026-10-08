import type { GraphData, NodeData, EdgeData } from '@antv/g6';
import {
  DependencyGraph,
  GraphEdge,
  GraphWorkItem,
  relationColor,
  workItemTypeName,
} from './graph.types';

/** Domain → G6 唯一映射入口。 */
export function toG6Data(graph: DependencyGraph): GraphData {
  return {
    nodes: graph.nodes.map((item) => toG6Node(item, graph.rootId)),
    edges: graph.edges.map(toG6Edge),
  };
}

function toG6Node(item: GraphWorkItem, rootId: string): NodeData {
  const kind = item.kind ?? 'workitem';
  const isMore = kind === 'more';
  const count = item.hiddenNeighborCount ?? 0;

  const node: NodeData = {
    id: item.id,
    type: 'rect',
    data: {
      kind,
      label: isMore ? `${count} more` : buildWorkItemLabel(item),
      hiddenNeighborCount: count,
      isRoot: item.id === rootId,
      ...(isMore ? {} : { item }),
    },
  };

  if (item.position) {
    node.style = {
      x: item.position.x,
      y: item.position.y,
    };
  }

  return node;
}

function toG6Edge(edge: GraphEdge): EdgeData {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: {
      relationType: edge.relationType,
      label: edge.label,
      color: relationColor(edge.relationType),
    },
  };
}

function buildWorkItemLabel(item: GraphWorkItem): string {
  return [
    item.identifier ?? '',
    truncate(item.title ?? '未命名', 28),
    workItemTypeName(item),
  ]
    .filter(Boolean)
    .join('\n');
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}
