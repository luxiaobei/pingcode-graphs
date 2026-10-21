import { FOLD_SUMMARY_SIZE, GRAPH_NODE_SIZE } from '../constants/graph.constants';
import {
  LAYOUT_GROUP_GAP,
  LAYOUT_H_GAP,
  LAYOUT_SIBLING_GAP,
  LAYOUT_V_BESIDE_ROUTE_CLEAR,
  LAYOUT_V_GAP,
} from '../constants/layout.constants';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import { BUNDLE_FOLD_TYPE, isBundleRelationType, isFoldSummaryNode, relationBetween } from './graph.util';

const LEFT_TYPES = ['relate:idea', 'relate:ticket'] as const;
const RIGHT_TYPES = ['relate:test_case'] as const;

export type Side = 'left' | 'right' | 'top' | 'bottom';

/** 可并入「关联」整体收起的关系（不含父/子与左右专属类型）。 */
export function isAssocBundleRelation(type: string): boolean {
  if (type === BUNDLE_FOLD_TYPE) {
    return true;
  }
  if (!isBundleRelationType(type)) {
    return false;
  }
  if ((LEFT_TYPES as readonly string[]).includes(type)) {
    return false;
  }
  if ((RIGHT_TYPES as readonly string[]).includes(type)) {
    return false;
  }
  return true;
}

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
  const size = isFoldSummaryNode(node) ? FOLD_SUMMARY_SIZE : GRAPH_NODE_SIZE;
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

/** 用 overrides 盖 arrange；skipIds 跳过（会话 pin / 换侧重锚）。 */
export function mergeLayoutPositions<T extends { x: number; y: number; side?: Side }>(
  arranged: ReadonlyMap<string, T>,
  overrides: ReadonlyMap<string, Partial<T> & { side?: Side }>,
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

/** 留存 side 与明确偏好是否一致（无偏好则视为一致）。 */
function sideMatchesPreference(retained?: Side, preferred?: Side): boolean {
  if (!preferred) {
    return true;
  }
  if (!retained) {
    return true;
  }
  return retained === preferred;
}

/** 节点 → 其关系类型上的明确方位偏好（含关联类跟 bundle）。 */
export function preferredSideByNode(
  graph: DependencyGraph,
  relationSides: ReadonlyMap<string, Side> | null | undefined,
): Map<string, Side> {
  const result = new Map<string, Side>();
  if (!relationSides?.size) {
    return result;
  }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const node of graph.nodes) {
    if (node.relationHub || !node.revealedByAnchorId) {
      continue;
    }
    const type =
      node.foldSummary?.relationType ??
      relationBetween(graph.edges, nodes, node.revealedByAnchorId, node.id);
    const preferred =
      relationSides.get(type) ??
      (type !== BUNDLE_FOLD_TYPE && isAssocBundleRelation(type)
        ? relationSides.get(BUNDLE_FOLD_TYPE)
        : undefined);
    if (preferred) {
      result.set(node.id, preferred);
    }
  }
  return result;
}

/** 只保留 side 与明确方位偏好一致（或无 side / 无偏好）的坐标。 */
export function retainPositionsForPreferredSide<T extends { side?: Side }>(
  positions: ReadonlyMap<string, T>,
  preferredByNode: ReadonlyMap<string, Side>,
): Map<string, T> {
  const next = new Map<string, T>();
  for (const [id, pos] of positions) {
    if (sideMatchesPreference(pos.side, preferredByNode.get(id))) {
      next.set(id, pos);
    }
  }
  return next;
}

/** 关系类型默认方位；preferred 可覆盖（关联类可跟 bundle）。 */
export function sideOfType(type: string, preferred?: ReadonlyMap<string, Side> | null): Side {
  const override =
    preferred?.get(type) ??
    (type !== BUNDLE_FOLD_TYPE && isAssocBundleRelation(type)
      ? preferred?.get(BUNDLE_FOLD_TYPE)
      : undefined);
  if (override) {
    return override;
  }
  if (type === 'child') {
    return 'bottom';
  }
  if (type === 'parent' || type === BUNDLE_FOLD_TYPE) {
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

/** 根用 sideOfType；嵌套沿父侧；有偏好则跟偏好。 */
function effectiveSide(
  type: string,
  flow: Side | 'cross',
  preferred?: ReadonlyMap<string, Side> | null,
): Side {
  const hasPreferred =
    preferred?.has(type) ||
    (Boolean(preferred?.has(BUNDLE_FOLD_TYPE)) && isAssocBundleRelation(type));
  if (hasPreferred) {
    return sideOfType(type, preferred);
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

function groupRank(type: string, side: Side): number {
  if (side === 'left') {
    const index = LEFT_TYPES.indexOf(type as (typeof LEFT_TYPES)[number]);
    return index === -1 ? LEFT_TYPES.length : index;
  }
  if (side === 'right') {
    const index = RIGHT_TYPES.indexOf(type as (typeof RIGHT_TYPES)[number]);
    return index === -1 ? RIGHT_TYPES.length : index;
  }
  if (side === 'top') {
    // 父靠内、关联整体其次，便于同脊 T 分叉；其余稳定靠后
    return type === 'parent' ? 0 : type === BUNDLE_FOLD_TYPE ? 1 : 2;
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
    .sort((a, b) => groupRank(a.type, side) - groupRank(b.type, side) || a.type.localeCompare(b.type));
}

function crossSize(side: Side): number {
  return side === 'left' || side === 'right'
    ? GRAPH_NODE_SIZE.width + LAYOUT_H_GAP
    : GRAPH_NODE_SIZE.height + LAYOUT_V_GAP;
}

/** 子项等距排开，中间对准父卡。 */
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
        gapAfter: lastInGroup && !lastGroup ? LAYOUT_GROUP_GAP : LAYOUT_SIBLING_GAP,
      });
    });
  });
  return items;
}

function boxOf(node: GraphEntity | undefined, pos: { x: number; y: number }): Extent {
  const size = isFoldSummaryNode(node) ? FOLD_SUMMARY_SIZE : GRAPH_NODE_SIZE;
  return {
    left: pos.x - size.width / 2,
    right: pos.x + size.width / 2,
    top: pos.y - size.height / 2,
    bottom: pos.y + size.height / 2,
  };
}

function mtvPreferred(a: Extent, b: Extent, preferred: Side, pad: number): { dx: number; dy: number } {
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

/** 重锚子树对齐折叠占位后，碰撞推开避免盖住原卡。 */
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
        Math.min(moveBox.right, other.right) - Math.max(moveBox.left, other.left) + LAYOUT_SIBLING_GAP;
      const overlapY =
        Math.min(moveBox.bottom, other.bottom) - Math.max(moveBox.top, other.top) + LAYOUT_SIBLING_GAP;
      if (overlapX <= 0 || overlapY <= 0) {
        continue;
      }
      const { dx, dy } = mtvPreferred(moveBox, other, side, LAYOUT_SIBLING_GAP);
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

/** 展开/收起保位：有 pin 用 pin；否则按父卡偏移补位。 */
export function resolvePinnedExpandCollapse<T extends { x: number; y: number; side?: Side }>(
  graph: DependencyGraph,
  arranged: ReadonlyMap<string, T>,
  pins: ReadonlyMap<string, T>,
  preferredByNode?: ReadonlyMap<string, Side> | null,
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
    const pin = pins.get(id);
    const preferred = preferredByNode?.get(id);
    if (pin) {
      result.set(id, {
        ...arrangedPos,
        x: pin.x,
        y: pin.y,
        side: pin.side ?? preferred ?? arrangedPos.side,
      });
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
              side: preferred ?? arrangedPos.side ?? parent.side,
            }
          : { ...arrangedPos, side: preferred ?? arrangedPos.side },
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

/** 上下分支相对左右列顶/底再拉开（含出线带宽）。 */
function clearVertical(placed: Placed[], side: 'top' | 'bottom', limit: number): Placed[] {
  if (!placed.length) {
    return [];
  }
  const gap = LAYOUT_V_GAP + LAYOUT_V_BESIDE_ROUTE_CLEAR;
  const extent = unionExtent(placed.map((item) => item.extent));
  const dy =
    side === 'top'
      ? Math.min(0, limit - gap - extent.bottom)
      : Math.max(0, limit + gap - extent.top);
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
    placedBySide.set(side, stackOnAxis(itemsOf(graph, visible, side, seen, preferred), side));
  }

  if (flow === 'cross') {
    const beside = [...(placedBySide.get('left') ?? []), ...(placedBySide.get('right') ?? [])];
    const besideExtent = unionExtent([selfExtent, ...beside.map((item) => item.extent)]);
    // 上/下相对左右列再拉开，不外推左右
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

/** 四向思维导图排布；preferredSides 覆盖默认方位。 */
export function arrangeGraph(
  graph: DependencyGraph,
  preferredSides?: ReadonlyMap<string, Side> | null,
): Map<string, { x: number; y: number; side?: Side }> {
  return finalizeArrange(graph, arrangeNode(graph, graph.rootId, 'cross', new Set(), preferredSides));
}

function finalizeArrange(
  graph: DependencyGraph,
  root: Placed,
): Map<string, { x: number; y: number; side?: Side }> {
  const positions = new Map(root.positions);
  const missing = graph.nodes.filter(
    (node) => !positions.has(node.id) && !node.relationHub,
  );
  let cursor = root.extent.right + LAYOUT_H_GAP + GRAPH_NODE_SIZE.width / 2;
  for (const node of missing) {
    const half = isFoldSummaryNode(node) ? FOLD_SUMMARY_SIZE.width / 2 : GRAPH_NODE_SIZE.width / 2;
    positions.set(node.id, { x: cursor, y: 0 });
    cursor += half * 2 + LAYOUT_SIBLING_GAP;
  }
  return positions;
}
