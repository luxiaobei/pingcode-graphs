import type { EdgeData, GraphData, NodeData } from '@antv/g6';
import type { DependencyGraph, GraphEdge, GraphEntity } from '../entities/graph.entity';
import { GraphNodeKind } from '../enums/graph.enum';
import { entityTypeName, relationColor, truncate } from './graph.util';

export type GraphNodePosition = { x: number; y: number };

/** Domain → G6 唯一映射入口。positions 优先于节点自带 position。 */
export function toG6Data(
  graph: DependencyGraph,
  positions?: ReadonlyMap<string, GraphNodePosition>,
): GraphData {
  return {
    nodes: graph.nodes.map((item) => toG6Node(item, graph.rootId, positions)),
    edges: graph.edges.map(toG6Edge),
  };
}

function toG6Node(
  item: GraphEntity,
  rootId: string,
  positions?: ReadonlyMap<string, GraphNodePosition>,
): NodeData {
  const kind = item.kind ?? GraphNodeKind.Entity;
  const isMore = kind === GraphNodeKind.More;
  const count = item.hiddenNeighborCount ?? 0;
  const position = positions?.get(item.id) ?? item.position;

  const node: NodeData = {
    id: item.id,
    type: 'rect',
    data: {
      kind,
      label: isMore ? `${count} more` : buildEntityLabel(item),
      hiddenNeighborCount: count,
      isRoot: item.id === rootId,
      ...(isMore ? {} : { item }),
    },
  };

  if (position) {
    node.style = {
      x: position.x,
      y: position.y,
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

function buildEntityLabel(item: GraphEntity): string {
  return [item.identifier ?? '', truncate(item.title ?? '未命名', 28), entityTypeName(item)]
    .filter(Boolean)
    .join('\n');
}
