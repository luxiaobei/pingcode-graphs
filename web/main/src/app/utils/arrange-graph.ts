import { GRAPH_NODE_SIZE } from '../constants/graph.constants';
import type { DependencyGraph, GraphEdge, GraphEntity } from '../entities/graph.entity';

/** 左右分支和父卡片之间的空白，留给关系名。 */
const H_GAP = 148;
/** 上下分支和父卡片之间的空白。 */
const V_GAP = 112;
/** 同一关系里相邻卡片的间距。 */
const SIBLING_GAP = 28;
/** 两种关系之间再隔开，主干不会粘在一起。 */
const GROUP_GAP = 56;

const LEFT_TYPES = ['relate:idea', 'relate:ticket'] as const;
const RIGHT_TYPES = ['relate:objective', 'relate:test_case'] as const;

export type Side = 'left' | 'right' | 'top' | 'bottom';

interface Extent {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface NodePos {
  x: number;
  y: number;
  side?: Side;
}

interface Placed {
  positions: Map<string, NodePos>;
  extent: Extent;
}

interface RelationGroup {
  type: string;
  memberIds: string[];
}

interface StackItem {
  placed: Placed;
  gapAfter: number;
}

function cardExtent(): Extent {
  return {
    left: -GRAPH_NODE_SIZE.width / 2,
    right: GRAPH_NODE_SIZE.width / 2,
    top: -GRAPH_NODE_SIZE.height / 2,
    bottom: GRAPH_NODE_SIZE.height / 2,
  };
}

function shiftPlaced(placed: Placed, dx: number, dy: number): Placed {
  const positions = new Map<string, NodePos>();
  for (const [id, pos] of placed.positions) {
    positions.set(id, { x: pos.x + dx, y: pos.y + dy, side: pos.side });
  }
  return {
    positions,
    extent: {
      left: placed.extent.left + dx,
      right: placed.extent.right + dx,
      top: placed.extent.top + dy,
      bottom: placed.extent.bottom + dy,
    },
  };
}

function unionExtent(extents: Extent[]): Extent {
  return {
    left: Math.min(...extents.map((item) => item.left)),
    right: Math.max(...extents.map((item) => item.right)),
    top: Math.min(...extents.map((item) => item.top)),
    bottom: Math.max(...extents.map((item) => item.bottom)),
  };
}

function findLink(
  edges: GraphEdge[],
  nodes: ReadonlyMap<string, GraphEntity>,
  parentId: string,
  childId: string,
): string {
  const direct = edges.find(
    (edge) =>
      (edge.source === parentId && edge.target === childId) ||
      (edge.target === parentId && edge.source === childId),
  );
  if (direct) {
    return direct.relationType;
  }
  for (const edge of edges) {
    const hubId = edge.source === parentId ? edge.target : edge.target === parentId ? edge.source : undefined;
    const hub = hubId ? nodes.get(hubId) : undefined;
    if (!hub?.relationHub) {
      continue;
    }
    const linked = edges.some(
      (item) =>
        (item.source === hubId && item.target === childId) ||
        (item.target === hubId && item.source === childId),
    );
    if (linked) {
      return hub.relationHub;
    }
  }
  return 'relate';
}

function groupsOf(graph: DependencyGraph, parentId: string): RelationGroup[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const groups = new Map<string, RelationGroup>();
  const children = graph.nodes
    .filter((node) => node.revealedByAnchorId === parentId && !node.relationHub)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const child of children) {
    const type = findLink(graph.edges, nodes, parentId, child.id);
    const group = groups.get(type) ?? { type, memberIds: [] };
    group.memberIds.push(child.id);
    groups.set(type, group);
  }
  return [...groups.values()];
}

/** 根节点四向分边。子级沿着这一侧继续向外，避免穿回中心。 */
export function sideOfType(type: string): Side {
  if (type === 'child') {
    return 'bottom';
  }
  if (type === 'parent') {
    return 'top';
  }
  if ((LEFT_TYPES as readonly string[]).includes(type)) {
    return 'left';
  }
  if ((RIGHT_TYPES as readonly string[]).includes(type)) {
    return 'right';
  }
  return 'top';
}

export function groupRank(type: string, side: Side): number {
  if (side === 'left') {
    const index = LEFT_TYPES.indexOf(type as (typeof LEFT_TYPES)[number]);
    return index === -1 ? LEFT_TYPES.length : index;
  }
  if (side === 'right') {
    const index = RIGHT_TYPES.indexOf(type as (typeof RIGHT_TYPES)[number]);
    return index === -1 ? RIGHT_TYPES.length : index;
  }
  if (side === 'top') {
    return type === 'depend' || type === 'parent' ? 0 : 1;
  }
  return type === 'child' ? 0 : 1;
}

function orderedGroups(groups: RelationGroup[], side: Side): RelationGroup[] {
  return groups
    .filter((group) => sideOfType(group.type) === side)
    .sort((a, b) => groupRank(a.type, side) - groupRank(b.type, side) || a.type.localeCompare(b.type));
}

function crossSize(side: Side): number {
  return side === 'left' || side === 'right' ? GRAPH_NODE_SIZE.width + H_GAP : GRAPH_NODE_SIZE.height + V_GAP;
}

/**
 * 子工作项等距排开，奇数条时中间一张对准父卡片。间距取相邻子树所需的最大空隙，避免重叠。
 */
function stackChildren(items: StackItem[], along: number): Placed[] {
  let step = 0;
  for (let index = 0; index < items.length - 1; index += 1) {
    const current = items[index];
    const next = items[index + 1];
    if (!current || !next) {
      continue;
    }
    const distance = current.placed.extent.right - next.placed.extent.left + current.gapAfter;
    step = Math.max(step, distance);
  }
  const mid = (items.length - 1) / 2;
  return items.map((item, index) => shiftPlaced(item.placed, (index - mid) * step, along));
}

/** 同一侧排成一条，整条相对父卡片的中线对齐。 */
function stackOnAxis(items: StackItem[], side: Side): Placed[] {
  if (!items.length) {
    return [];
  }
  const along = (side === 'right' || side === 'bottom' ? 1 : -1) * crossSize(side);
  if (side === 'bottom') {
    return stackChildren(items, along);
  }
  const vertical = side === 'left' || side === 'right';
  const sizes = items.map((item) =>
    vertical
      ? item.placed.extent.bottom - item.placed.extent.top
      : item.placed.extent.right - item.placed.extent.left,
  );
  const gapSum = items.slice(0, -1).reduce((sum, item) => sum + item.gapAfter, 0);
  const total = sizes.reduce((sum, size) => sum + size, 0) + gapSum;
  let cursor = -total / 2;
  return items.map((item, index) => {
    const size = sizes[index] ?? 0;
    const center = vertical
      ? (item.placed.extent.top + item.placed.extent.bottom) / 2
      : (item.placed.extent.left + item.placed.extent.right) / 2;
    const delta = cursor + size / 2 - center;
    cursor += size + item.gapAfter;
    return vertical ? shiftPlaced(item.placed, along, delta) : shiftPlaced(item.placed, delta, along);
  });
}

function withSide(placed: Placed, id: string, side: Side): Placed {
  const positions = new Map(placed.positions);
  const pos = positions.get(id);
  if (pos) {
    positions.set(id, { ...pos, side });
  }
  return { positions, extent: placed.extent };
}

function itemsOf(graph: DependencyGraph, groups: RelationGroup[], side: Side, seen: Set<string>): StackItem[] {
  const items: StackItem[] = [];
  groups.forEach((group, groupIndex) => {
    group.memberIds.forEach((memberId, index) => {
      const lastInGroup = index === group.memberIds.length - 1;
      const lastGroup = groupIndex === groups.length - 1;
      items.push({
        placed: withSide(arrangeNode(graph, memberId, side, seen), memberId, side),
        gapAfter: lastInGroup && !lastGroup ? GROUP_GAP : SIBLING_GAP,
      });
    });
  });
  return items;
}

/** 上下分支让开左右两列，同时保持相对根节点水平居中。 */
function clearVertical(placed: Placed[], side: 'top' | 'bottom', limit: number): Placed[] {
  if (!placed.length) {
    return [];
  }
  const extent = unionExtent(placed.map((item) => item.extent));
  const dy =
    side === 'top'
      ? Math.min(0, limit - V_GAP - extent.bottom)
      : Math.max(0, limit + V_GAP - extent.top);
  return dy === 0 ? placed : placed.map((item) => shiftPlaced(item, 0, dy));
}

function arrangeNode(graph: DependencyGraph, id: string, flow: Side | 'cross', seen: Set<string>): Placed {
  if (seen.has(id)) {
    return { positions: new Map(), extent: cardExtent() };
  }
  seen.add(id);

  const positions = new Map<string, { x: number; y: number }>([[id, { x: 0, y: 0 }]]);
  const groups = groupsOf(graph, id);
  const sides: Side[] = flow === 'cross' ? ['left', 'right', 'top', 'bottom'] : [flow];
  const placedBySide = new Map<Side, Placed[]>();

  for (const side of sides) {
    const visible =
      flow === 'cross'
        ? orderedGroups(groups, side)
        : [...groups].sort((a, b) => a.type.localeCompare(b.type));
    placedBySide.set(side, stackOnAxis(itemsOf(graph, visible, side, seen), side));
  }

  if (flow === 'cross') {
    const beside = [...(placedBySide.get('left') ?? []), ...(placedBySide.get('right') ?? [])];
    const besideExtent = unionExtent([cardExtent(), ...beside.map((item) => item.extent)]);
    placedBySide.set('top', clearVertical(placedBySide.get('top') ?? [], 'top', besideExtent.top));
    placedBySide.set('bottom', clearVertical(placedBySide.get('bottom') ?? [], 'bottom', besideExtent.bottom));
  }

  const placed = [...placedBySide.values()].flat();
  for (const item of placed) {
    for (const [nodeId, pos] of item.positions) {
      positions.set(nodeId, pos);
    }
  }
  return {
    positions,
    extent: unionExtent([cardExtent(), ...placed.map((item) => item.extent)]),
  };
}

/** 根在中间。左产品需求/工单，右目标/测试，上依赖和其他，下子级。每边相对中线对齐。 */
export function arrangeGraph(graph: DependencyGraph): Map<string, { x: number; y: number }> {
  const root = arrangeNode(graph, graph.rootId, 'cross', new Set());
  const positions = new Map(root.positions);
  const missing = graph.nodes.filter((node) => !positions.has(node.id) && !node.relationHub);
  let cursor = root.extent.right + H_GAP + GRAPH_NODE_SIZE.width / 2;
  for (const node of missing) {
    positions.set(node.id, { x: cursor, y: 0 });
    cursor += GRAPH_NODE_SIZE.width + SIBLING_GAP;
  }
  return positions;
}
