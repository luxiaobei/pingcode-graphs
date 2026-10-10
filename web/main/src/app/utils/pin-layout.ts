import { GRAPH_NODE_SLOT } from '../constants/graph.constants';
import type { DependencyGraph } from '../entities/graph.entity';
import type { GraphNodePosition } from './to-g6-data';

/** 目标点是否与已有可见节点重叠 */
function collides(
  x: number,
  y: number,
  visibleIds: ReadonlySet<string>,
  pins: ReadonlyMap<string, GraphNodePosition>,
): boolean {
  const { width, height } = GRAPH_NODE_SLOT;
  for (const id of visibleIds) {
    const pos = pins.get(id);
    if (pos && Math.abs(pos.x - x) < width && Math.abs(pos.y - y) < height) {
      return true;
    }
  }
  return false;
}

/** 在锚点四周找一个不重叠的落点 */
export function findOpenPosition(
  base: GraphNodePosition,
  index: number,
  visibleIds: ReadonlySet<string>,
  pins: ReadonlyMap<string, GraphNodePosition>,
): GraphNodePosition {
  const { width, height } = GRAPH_NODE_SLOT;
  const rings = [
    { x: width + 24, y: 0 },
    { x: -(width + 24), y: 0 },
    { x: 0, y: height + 16 },
    { x: 0, y: -(height + 16) },
    { x: width + 24, y: height + 16 },
    { x: -(width + 24), y: height + 16 },
    { x: width + 24, y: -(height + 16) },
    { x: -(width + 24), y: -(height + 16) },
  ];

  const candidates: GraphNodePosition[] = [];
  for (let ring = 1; ring <= 3; ring++) {
    for (const dir of rings) {
      candidates.push({ x: base.x + dir.x * ring, y: base.y + dir.y * ring });
    }
  }

  const start = index % candidates.length;
  const rotated = [...candidates.slice(start), ...candidates.slice(0, start)];
  for (const pos of rotated) {
    if (!collides(pos.x, pos.y, visibleIds, pins)) {
      return pos;
    }
  }
  return {
    x: base.x + (index % 4) * width,
    y: base.y + (Math.floor(index / 4) + 1) * height,
  };
}

/** 仅为从未出现过的节点补点；已收起节点坐标保留，展开原位恢复 */
export function seedMissingPositions(
  data: DependencyGraph,
  pins: Map<string, GraphNodePosition>,
): void {
  const visibleIds = new Set(data.nodes.map((node) => node.id));
  let seedIndex = 0;

  for (const node of data.nodes) {
    if (pins.has(node.id)) {
      continue;
    }

    const parentPos = node.revealedByAnchorId
      ? pins.get(node.revealedByAnchorId)
      : undefined;
    const linked = data.edges.find(
      (edge) =>
        (edge.source === node.id && pins.has(edge.target)) ||
        (edge.target === node.id && pins.has(edge.source)),
    );
    const otherId = linked
      ? linked.source === node.id
        ? linked.target
        : linked.source
      : undefined;
    const base = parentPos ?? (otherId ? pins.get(otherId) : undefined);
    if (!base) {
      continue;
    }

    const pos = findOpenPosition(base, seedIndex, visibleIds, pins);
    pins.set(node.id, pos);
    visibleIds.add(node.id);
    seedIndex += 1;
  }
}

/** 当前可见节点坐标：已有 pin 原位恢复，缺的再补点 */
export function visiblePositions(
  data: DependencyGraph,
  pins: Map<string, GraphNodePosition>,
): Map<string, GraphNodePosition> {
  seedMissingPositions(data, pins);

  const visible = new Map<string, GraphNodePosition>();
  for (const node of data.nodes) {
    const pos = pins.get(node.id);
    if (pos) {
      visible.set(node.id, pos);
    }
  }
  if (visible.size === data.nodes.length) {
    return visible;
  }

  const rootPos = pins.get(data.rootId) ?? { x: 0, y: 0 };
  const visibleIds = new Set(visible.keys());
  let seedIndex = visible.size;
  for (const node of data.nodes) {
    if (visible.has(node.id)) {
      continue;
    }
    const pos = findOpenPosition(rootPos, seedIndex, visibleIds, pins);
    pins.set(node.id, pos);
    visible.set(node.id, pos);
    visibleIds.add(node.id);
    seedIndex += 1;
  }
  return visible;
}
