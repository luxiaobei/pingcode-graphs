import { graphNodeSize, GRAPH_NODE_SIZE } from '../constants/graph.constants';
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
/** 上/下与其它关系共存时，父卡相对中线错开，供父干单独直出（与 route parentStem 一致） */
export const PARENT_DUAL_EXIT_GAP = 56;

const LEFT_TYPES = ['relate:idea', 'relate:ticket'] as const;
const RIGHT_TYPES = ['relate:test_case'] as const;

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

function nodeExtent(node: GraphEntity | undefined): Extent {
  const size = graphNodeSize(node);
  return {
    left: -size.width / 2,
    right: size.width / 2,
    top: -size.height / 2,
    bottom: size.height / 2,
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

function groupsOf(graph: DependencyGraph, parentId: string): RelationGroup[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const groups = new Map<string, RelationGroup>();
  const children = graph.nodes
    .filter((node) => node.revealedByAnchorId === parentId && !node.relationHub)
    .sort(
      (a, b) =>
        Number(isFoldSummaryNode(a)) - Number(isFoldSummaryNode(b)) || a.id.localeCompare(b.id),
    );
  for (const child of children) {
    const type =
      child.foldSummary?.relationType ?? relationBetween(graph.edges, nodes, parentId, child.id);
    const group = groups.get(type) ?? { type, memberIds: [] };
    group.memberIds.push(child.id);
    groups.set(type, group);
  }
  return [...groups.values()];
}

/**
 * 在思维导图坐标上覆盖已有位置（保存坐标 / 拖拽 pin）。
 * skipIds：会话 pin / 换侧重锚结果勿用旧 saved 盖回（否则拖卡后收起再展开会弹回）。
 */
export function mergeLayoutPositions<T extends { x: number; y: number }>(
  arranged: ReadonlyMap<string, T>,
  overrides: ReadonlyMap<string, Partial<T>>,
  skipIds?: ReadonlySet<string> | null,
): Map<string, T> {
  const next = new Map(arranged);
  for (const [id, pos] of overrides) {
    if (skipIds?.has(id) || !next.has(id)) {
      continue;
    }
    next.set(id, { ...next.get(id)!, ...pos });
  }
  return next;
}

/**
 * 根节点默认四向分边（保持原逻辑）：
 * 父在上、子在下，产品需求/工单偏左，测试偏右，关联/重复/阻塞等在上。
 * preferred 来自折叠占位拖拽；父工作项卡拖拽也会写入 parent 偏好。
 */
export function sideOfType(type: string, preferred?: ReadonlyMap<string, Side> | null): Side {
  const override = preferred?.get(type);
  if (override) {
    return override;
  }
  if (type === 'child') {
    return 'bottom';
  }
  if (type === 'parent' || type === 'bundle') {
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

/**
 * 根按 sideOfType；嵌套默认沿父侧继续向外。
 * 有个人偏好时该关系类型跟偏好走（折叠占位 / 父工作项拖拽写入）。
 */
function effectiveSide(
  type: string,
  flow: Side | 'cross',
  preferred?: ReadonlyMap<string, Side> | null,
): Side {
  const override = preferred?.get(type);
  if (override) {
    return override;
  }
  if (flow !== 'cross') {
    return flow;
  }
  return sideOfType(type);
}

/** 相对父卡位移推断出线方位。 */
export function sideFromDelta(dx: number, dy: number): Side {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

/** 按贴边外侧程度定方位，角上比纯 dx/dy 更稳。 */
export function sideFromParent(
  parent: { x: number; y: number },
  child: { x: number; y: number },
  half = { w: GRAPH_NODE_SIZE.width / 2, h: GRAPH_NODE_SIZE.height / 2 },
): Side {
  const dx = child.x - parent.x;
  const dy = child.y - parent.y;
  const scores: { side: Side; value: number }[] = [
    { side: 'left', value: -(dx + half.w) },
    { side: 'right', value: dx - half.w },
    { side: 'top', value: -(dy + half.h) },
    { side: 'bottom', value: dy - half.h },
  ];
  scores.sort((a, b) => b.value - a.value || a.side.localeCompare(b.side));
  return scores[0]?.side ?? sideFromDelta(dx, dy);
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
    // 父靠内；其它关系 / 整体收起占位靠外
    return type === 'parent' ? 0 : 1;
  }
  return type === 'child' ? 0 : 1;
}

function orderedGroups(
  groups: RelationGroup[],
  side: Side,
  flow: Side | 'cross',
  preferred?: ReadonlyMap<string, Side> | null,
): RelationGroup[] {
  return groups
    .filter((group) => effectiveSide(group.type, flow, preferred) === side)
    .sort(
      (a, b) => groupRank(a.type, side) - groupRank(b.type, side) || a.type.localeCompare(b.type),
    );
}

function crossSize(side: Side): number {
  return side === 'left' || side === 'right'
    ? GRAPH_NODE_SIZE.width + H_GAP
    : GRAPH_NODE_SIZE.height + V_GAP;
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
    return vertical
      ? shiftPlaced(item.placed, along, delta)
      : shiftPlaced(item.placed, delta, along);
  });
}

/**
 * 同侧同时有「父」与其它关系时：父排在靠父卡的一圈，其它关系再往外一圈。
 * 避免父与关联/阻塞等并排共脊，便于其它关系日后整体收起。
 */
function stackSideSeparatingParent(
  graph: DependencyGraph,
  groups: RelationGroup[],
  side: Side,
  seen: Set<string>,
  preferred?: ReadonlyMap<string, Side> | null,
): Placed[] {
  const parentGroups = groups.filter((group) => group.type === 'parent');
  const otherGroups = groups.filter((group) => group.type !== 'parent');
  const parentMemberIds = parentGroups.flatMap((group) => group.memberIds);
  if (!parentGroups.length || !otherGroups.length) {
    const stacked = stackOnAxis(itemsOf(graph, groups, side, seen, preferred), side);
    // 仅父或仅其它：父成员仍贴中线，保证初始化父线竖直
    return parentMemberIds.length
      ? centerMemberCardsOnAxis(stacked, side, parentMemberIds)
      : stacked;
  }
  // 父卡先贴中线；上/下再错开 PARENT_DUAL_EXIT_GAP，与路由父干一致，避免和其它关系共中线
  let parentPlaced = centerMemberCardsOnAxis(
    stackOnAxis(itemsOf(graph, parentGroups, side, seen, preferred), side),
    side,
    parentMemberIds,
  );
  if (side === 'top' || side === 'bottom') {
    // 与 parentStemCenter 默认方向一致：中线被占用时父干取 axis - gap
    parentPlaced = parentPlaced.map((item) => shiftPlaced(item, -PARENT_DUAL_EXIT_GAP, 0));
  }
  let otherPlaced = stackOnAxis(itemsOf(graph, otherGroups, side, seen, preferred), side);
  const parentExt = unionExtent(parentPlaced.map((item) => item.extent));
  const otherExt = unionExtent(otherPlaced.map((item) => item.extent));
  // 把其它关系整体推到父带外侧
  if (side === 'top') {
    const dy = Math.min(0, parentExt.top - GROUP_GAP - otherExt.bottom);
    if (dy) {
      otherPlaced = otherPlaced.map((item) => shiftPlaced(item, 0, dy));
    }
  } else if (side === 'bottom') {
    const dy = Math.max(0, parentExt.bottom + GROUP_GAP - otherExt.top);
    if (dy) {
      otherPlaced = otherPlaced.map((item) => shiftPlaced(item, 0, dy));
    }
  } else if (side === 'left') {
    const dx = Math.min(0, parentExt.left - GROUP_GAP - otherExt.right);
    if (dx) {
      otherPlaced = otherPlaced.map((item) => shiftPlaced(item, dx, 0));
    }
  } else {
    const dx = Math.max(0, parentExt.right + GROUP_GAP - otherExt.left);
    if (dx) {
      otherPlaced = otherPlaced.map((item) => shiftPlaced(item, dx, 0));
    }
  }
  return [...parentPlaced, ...otherPlaced];
}

/** 指定成员卡片中心落到侧向轴上（arrange 相对父卡原点），父线可竖直/水平直出 */
function centerMemberCardsOnAxis(placedList: Placed[], side: Side, memberIds: string[]): Placed[] {
  if (!placedList.length || !memberIds.length) {
    return placedList;
  }
  const coords: number[] = [];
  for (const id of memberIds) {
    for (const placed of placedList) {
      const pos = placed.positions.get(id);
      if (!pos) {
        continue;
      }
      coords.push(side === 'left' || side === 'right' ? pos.y : pos.x);
      break;
    }
  }
  if (!coords.length) {
    return placedList;
  }
  const avg = coords.reduce((sum, value) => sum + value, 0) / coords.length;
  if (Math.abs(avg) < 1) {
    return placedList;
  }
  return side === 'left' || side === 'right'
    ? placedList.map((item) => shiftPlaced(item, 0, -avg))
    : placedList.map((item) => shiftPlaced(item, -avg, 0));
}

function withSide(placed: Placed, id: string, side: Side): Placed {
  const positions = new Map(placed.positions);
  const pos = positions.get(id);
  if (pos) {
    positions.set(id, { ...pos, side });
  }
  return { positions, extent: placed.extent };
}

function itemsOf(
  graph: DependencyGraph,
  groups: RelationGroup[],
  side: Side,
  seen: Set<string>,
  preferred?: ReadonlyMap<string, Side> | null,
): StackItem[] {
  const items: StackItem[] = [];
  groups.forEach((group, groupIndex) => {
    group.memberIds.forEach((memberId, index) => {
      const lastInGroup = index === group.memberIds.length - 1;
      const lastGroup = groupIndex === groups.length - 1;
      items.push({
        placed: withSide(arrangeNode(graph, memberId, side, seen, preferred), memberId, side),
        gapAfter: lastInGroup && !lastGroup ? GROUP_GAP : SIBLING_GAP,
      });
    });
  });
  return items;
}

function boxOf(node: GraphEntity | undefined, pos: { x: number; y: number }): Extent {
  const size = graphNodeSize(node);
  return {
    left: pos.x - size.width / 2,
    right: pos.x + size.width / 2,
    top: pos.y - size.height / 2,
    bottom: pos.y + size.height / 2,
  };
}

function mtvPreferred(
  a: Extent,
  b: Extent,
  preferred: Side,
  pad: number,
): { dx: number; dy: number } {
  const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left) + pad;
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) + pad;
  if (overlapX <= 0 || overlapY <= 0) {
    return { dx: 0, dy: 0 };
  }
  const options: { dx: number; dy: number; side: Side }[] = [
    { dx: -overlapX, dy: 0, side: 'left' },
    { dx: overlapX, dy: 0, side: 'right' },
    { dx: 0, dy: -overlapY, side: 'top' },
    { dx: 0, dy: overlapY, side: 'bottom' },
  ];
  options.sort(
    (p, q) =>
      Number(p.side !== preferred) - Number(q.side !== preferred) ||
      Math.abs(p.dx) + Math.abs(p.dy) - (Math.abs(q.dx) + Math.abs(q.dy)),
  );
  const best = options[0]!;
  return { dx: best.dx, dy: best.dy };
}

/**
 * 重锚子树对齐折叠占位后，相对已有节点做碰撞推开，避免展开盖住原卡。
 */
export function settleReanchoredSubtree<T extends { x: number; y: number; side?: Side }>(
  graph: DependencyGraph,
  layout: Map<string, T>,
  movingIds: ReadonlySet<string>,
  side: Side,
  anchor?: { x: number; y: number } | null,
): void {
  const moving = [...movingIds].filter((id) => layout.has(id));
  if (!moving.length) {
    return;
  }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
    const cx = moving.reduce((sum, id) => sum + layout.get(id)!.x, 0) / moving.length;
    const cy = moving.reduce((sum, id) => sum + layout.get(id)!.y, 0) / moving.length;
    const dx = anchor.x - cx;
    const dy = anchor.y - cy;
    if (dx || dy) {
      for (const id of moving) {
        const pos = layout.get(id)!;
        layout.set(id, { ...pos, x: pos.x + dx, y: pos.y + dy });
      }
    }
  }
  const obstacles = [...layout.keys()].filter((id) => !movingIds.has(id));
  for (let iter = 0; iter < 32; iter += 1) {
    const moveBox = unionExtent(moving.map((id) => boxOf(nodes.get(id), layout.get(id)!)));
    let worst: { dx: number; dy: number; area: number } | null = null;
    for (const id of obstacles) {
      const other = boxOf(nodes.get(id), layout.get(id)!);
      const overlapX =
        Math.min(moveBox.right, other.right) - Math.max(moveBox.left, other.left) + SIBLING_GAP;
      const overlapY =
        Math.min(moveBox.bottom, other.bottom) - Math.max(moveBox.top, other.top) + SIBLING_GAP;
      if (overlapX <= 0 || overlapY <= 0) {
        continue;
      }
      const { dx, dy } = mtvPreferred(moveBox, other, side, SIBLING_GAP);
      const area = overlapX * overlapY;
      if (!worst || area > worst.area) {
        worst = { dx, dy, area };
      }
    }
    if (!worst || (worst.dx === 0 && worst.dy === 0)) {
      break;
    }
    for (const id of moving) {
      const pos = layout.get(id)!;
      layout.set(id, { ...pos, x: pos.x + worst.dx, y: pos.y + worst.dy });
    }
  }
}

/**
 * 展开/收起：有 pin 的工作项与已拖动的 +N 保位；其余相对父卡按思维导图偏移补位。
 */
export function resolvePinnedExpandCollapse<T extends { x: number; y: number; side?: Side }>(
  graph: DependencyGraph,
  arranged: ReadonlyMap<string, T>,
  pins: ReadonlyMap<string, T>,
): Map<string, T> {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (node.relationHub || !node.revealedByAnchorId || !arranged.has(node.id)) {
      continue;
    }
    const list = childrenOf.get(node.revealedByAnchorId) ?? [];
    list.push(node.id);
    childrenOf.set(node.revealedByAnchorId, list);
  }

  const result = new Map<string, T>();
  const queue = arranged.has(graph.rootId) ? [graph.rootId] : [];

  while (queue.length) {
    const id = queue.shift()!;
    const arrangedPos = arranged.get(id);
    if (!arrangedPos) {
      continue;
    }
    const node = nodeById.get(id);
    // 工作项与折叠 +N 均尊重 pin（收起后拖占位、再展开继承 side）
    const pin = pins.get(id);
    if (pin) {
      result.set(id, { ...arrangedPos, x: pin.x, y: pin.y, side: pin.side ?? arrangedPos.side });
    } else {
      const parentId = node?.revealedByAnchorId;
      const parent = parentId ? result.get(parentId) : undefined;
      const arrangedParent = parentId ? arranged.get(parentId) : undefined;
      result.set(
        id,
        parent && arrangedParent
          ? {
              ...arrangedPos,
              x: parent.x + (arrangedPos.x - arrangedParent.x),
              y: parent.y + (arrangedPos.y - arrangedParent.y),
              side: arrangedPos.side ?? parent.side,
            }
          : arrangedPos,
      );
    }
    queue.push(...(childrenOf.get(id) ?? []));
  }

  for (const [id, pos] of arranged) {
    if (!result.has(id)) {
      result.set(id, pos);
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

function arrangeNode(
  graph: DependencyGraph,
  id: string,
  flow: Side | 'cross',
  seen: Set<string>,
  preferred?: ReadonlyMap<string, Side> | null,
): Placed {
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
  // 根四向；嵌套默认沿父侧。有 preferred 时再按偏好拆边。
  const sides: Side[] =
    flow === 'cross' || (preferred && preferred.size > 0)
      ? ['left', 'right', 'top', 'bottom']
      : [flow];
  const placedBySide = new Map<Side, Placed[]>();

  for (const side of sides) {
    const visible = orderedGroups(groups, side, flow, preferred);
    if (!visible.length) {
      continue;
    }
    // 下侧仍是子项直出；其它侧父与关联等分层，避免共脊
    placedBySide.set(
      side,
      side === 'bottom'
        ? stackOnAxis(itemsOf(graph, visible, side, seen, preferred), side)
        : stackSideSeparatingParent(graph, visible, side, seen, preferred),
    );
  }

  if (flow === 'cross') {
    const beside = [...(placedBySide.get('left') ?? []), ...(placedBySide.get('right') ?? [])];
    const besideExtent = unionExtent([selfExtent, ...beside.map((item) => item.extent)]);
    placedBySide.set('top', clearVertical(placedBySide.get('top') ?? [], 'top', besideExtent.top));
    placedBySide.set(
      'bottom',
      clearVertical(placedBySide.get('bottom') ?? [], 'bottom', besideExtent.bottom),
    );
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

/**
 * 根在中间。左产品需求/工单，右测试，上父项和其他，下子级。
 * preferredSides 覆盖关系类型默认方位（个人视图跨工作项共用）。
 */
export function arrangeGraph(
  graph: DependencyGraph,
  preferredSides?: ReadonlyMap<string, Side> | null,
): Map<string, { x: number; y: number; side?: Side }> {
  const root = arrangeNode(graph, graph.rootId, 'cross', new Set(), preferredSides);
  const positions = new Map(root.positions);
  const missing = graph.nodes.filter((node) => !positions.has(node.id) && !node.relationHub);
  let cursor = root.extent.right + H_GAP + GRAPH_NODE_SIZE.width / 2;
  for (const node of missing) {
    const half = graphNodeSize(node).width / 2;
    positions.set(node.id, { x: cursor, y: 0 });
    cursor += half * 2 + SIBLING_GAP;
  }
  return positions;
}
