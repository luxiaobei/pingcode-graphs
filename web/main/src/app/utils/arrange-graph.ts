import { FOLD_SUMMARY_SIZE, GRAPH_NODE_SIZE } from '../constants/graph.constants';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import { isFoldSummaryNode, relationBetween } from './graph.util';

/** 左右分支和父卡片之间的空白，留给关系名。 */
const H_GAP = 148;
/** 上下分支和父卡片之间的空白。 */
const V_GAP = 112;
/** 同一关系里相邻卡片的间距。 */
const SIBLING_GAP = 28;
/** 两种关系之间再隔开，主干不会粘在一起。 */
const GROUP_GAP = 56;
/** 折叠占位之间再拉开一点，边标签不易挤在一起。 */
const FOLD_GROUP_GAP = 80;

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

function nodeExtent(node: GraphEntity | undefined): Extent {
  if (isFoldSummaryNode(node)) {
    return {
      left: -FOLD_SUMMARY_SIZE.width / 2,
      right: FOLD_SUMMARY_SIZE.width / 2,
      top: -FOLD_SUMMARY_SIZE.height / 2,
      bottom: FOLD_SUMMARY_SIZE.height / 2,
    };
  }
  return cardExtent();
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

function groupsOf(graph: DependencyGraph, parentId: string): RelationGroup[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const groups = new Map<string, RelationGroup>();
  const children = graph.nodes
    .filter((node) => node.revealedByAnchorId === parentId && !node.relationHub)
    .sort((a, b) => {
      // 折叠占位排在同关系真实卡片之后，避免和展开态错位感过大
      const af = isFoldSummaryNode(a) ? 1 : 0;
      const bf = isFoldSummaryNode(b) ? 1 : 0;
      return af - bf || a.id.localeCompare(b.id);
    });
  for (const child of children) {
    const type = child.foldSummary?.relationType ?? relationBetween(graph.edges, nodes, parentId, child.id);
    const group = groups.get(type) ?? { type, memberIds: [] };
    group.memberIds.push(child.id);
    groups.set(type, group);
  }
  return [...groups.values()];
}

/** 在思维导图坐标上覆盖已有位置（保存坐标 / 拖拽 pin）。 */
export function mergeLayoutPositions<T extends { x: number; y: number }>(
  arranged: ReadonlyMap<string, T>,
  overrides: ReadonlyMap<string, Partial<T>>,
): Map<string, T> {
  const next = new Map(arranged);
  for (const [id, pos] of overrides) {
    if (next.has(id)) {
      next.set(id, { ...next.get(id)!, ...pos });
    }
  }
  return next;
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
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const items: StackItem[] = [];
  groups.forEach((group, groupIndex) => {
    group.memberIds.forEach((memberId, index) => {
      const lastInGroup = index === group.memberIds.length - 1;
      const lastGroup = groupIndex === groups.length - 1;
      const nextGroup = groups[groupIndex + 1];
      const foldGap =
        lastInGroup &&
        !lastGroup &&
        group.memberIds.every((id) => isFoldSummaryNode(nodeById.get(id))) &&
        nextGroup?.memberIds.every((id) => isFoldSummaryNode(nodeById.get(id)));
      items.push({
        placed: withSide(arrangeNode(graph, memberId, side, seen), memberId, side),
        gapAfter: lastInGroup && !lastGroup ? (foldGap ? FOLD_GROUP_GAP : GROUP_GAP) : SIBLING_GAP,
      });
    });
  });
  return items;
}

/**
 * 展开/收起落位：已拖拽/已 pin 的工作项卡片绝对保位；
 * 仅给新出现的节点（含 +N）按「相对父卡」的思维导图偏移补位。
 */
export function resolvePinnedExpandCollapse<T extends { x: number; y: number; side?: Side }>(
  graph: DependencyGraph,
  arranged: ReadonlyMap<string, T>,
  pins: ReadonlyMap<string, T>,
): Map<string, T> {
  const result = new Map<string, T>();

  // 1) 真实卡片：有 pin 则必须停在拖拽后的位置（忽略旧的 fold pin）
  for (const node of graph.nodes) {
    if (node.relationHub || isFoldSummaryNode(node)) {
      continue;
    }
    const pin = pins.get(node.id);
    const arrangedPos = arranged.get(node.id);
    if (pin) {
      result.set(node.id, {
        ...((arrangedPos ?? pin) as T),
        x: pin.x,
        y: pin.y,
        side: pin.side ?? arrangedPos?.side,
      });
    }
  }

  // 2) 其余可见节点（新展开的子卡 / 折叠占位）：相对父卡当前坐标补位
  const pending = graph.nodes.filter(
    (node) => !node.relationHub && !result.has(node.id) && arranged.has(node.id),
  );
  let guard = pending.length + 1;
  while (pending.length && guard > 0) {
    guard -= 1;
    let progressed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const node = pending[index]!;
      const arrangedPos = arranged.get(node.id)!;
      const parentId = node.revealedByAnchorId;
      const parentPos = parentId ? (result.get(parentId) ?? pins.get(parentId)) : undefined;
      const arrangedParent = parentId ? arranged.get(parentId) : undefined;
      if (parentPos && arrangedParent) {
        result.set(node.id, {
          ...arrangedPos,
          x: parentPos.x + (arrangedPos.x - arrangedParent.x),
          y: parentPos.y + (arrangedPos.y - arrangedParent.y),
          side: arrangedPos.side ?? parentPos.side,
        });
      } else if (!parentId || !arrangedParent) {
        result.set(node.id, arrangedPos);
      } else {
        continue;
      }
      pending.splice(index, 1);
      progressed = true;
    }
    if (!progressed) {
      for (const node of pending) {
        result.set(node.id, arranged.get(node.id)!);
      }
      break;
    }
  }

  return result;
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
  const self = graph.nodes.find((node) => node.id === id);
  const selfExtent = nodeExtent(self);
  if (seen.has(id)) {
    return { positions: new Map(), extent: selfExtent };
  }
  seen.add(id);

  // 折叠占位是叶子，不再向下排
  if (isFoldSummaryNode(self)) {
    return {
      positions: new Map([[id, { x: 0, y: 0 }]]),
      extent: selfExtent,
    };
  }

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
    const besideExtent = unionExtent([selfExtent, ...beside.map((item) => item.extent)]);
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
    extent: unionExtent([selfExtent, ...placed.map((item) => item.extent)]),
  };
}

/** 根在中间。左产品需求/工单，右目标/测试，上依赖和其他，下子级。每边相对中线对齐。 */
export function arrangeGraph(graph: DependencyGraph): Map<string, { x: number; y: number }> {
  const root = arrangeNode(graph, graph.rootId, 'cross', new Set());
  const positions = new Map(root.positions);
  const missing = graph.nodes.filter(
    (node) => !positions.has(node.id) && !node.relationHub,
  );
  let cursor = root.extent.right + H_GAP + GRAPH_NODE_SIZE.width / 2;
  for (const node of missing) {
    const half = isFoldSummaryNode(node) ? FOLD_SUMMARY_SIZE.width / 2 : GRAPH_NODE_SIZE.width / 2;
    positions.set(node.id, { x: cursor, y: 0 });
    cursor += half * 2 + SIBLING_GAP;
  }
  return positions;
}
