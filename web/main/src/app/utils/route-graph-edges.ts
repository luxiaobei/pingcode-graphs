import type { EdgeData } from '@antv/g6';
import { foldSummarySize, GRAPH_NODE_SIZE } from '../constants/graph.constants';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import { PARENT_DUAL_EXIT_GAP, type Side } from './arrange-graph';
import { unstackSharedStrokes } from './unstack-strokes';
import {
  isBundleRelationType,
  isFoldSummaryId,
  isFoldSummaryNode,
  relationBetween,
  relationBundleFoldKey,
  relationFoldKey,
  relationLabel,
} from './graph.util';

export type GraphNodePosition = { x: number; y: number; side?: Side };

const HALF_W = GRAPH_NODE_SIZE.width / 2;
const HALF_H = GRAPH_NODE_SIZE.height / 2;
const SPINE_PAD = 28;
const FORK_PAD = 36;

function halfOf(node: GraphEntity | undefined): { w: number; h: number } {
  if (!isFoldSummaryNode(node)) {
    return { w: HALF_W, h: HALF_H };
  }
  const size = foldSummarySize(node?.foldSummary?.count ?? 0);
  return { w: size.width / 2, h: size.height / 2 };
}

interface TrunkMember {
  parentId: string;
  childId: string;
  relationType: string;
  label: string;
}

interface LaneGroup {
  members: TrunkMember[];
  parent: GraphNodePosition;
  placed: { member: TrunkMember; child: GraphNodePosition }[];
  side: Side;
}

/**
 * − 钉在分岔口（干/类型线与叉线交点），与 controlPoints 角点一致。
 * 勿取路径段中点——同类型多卡时中点会落在横梁上跑偏。
 */
function foldJunction(
  parent: GraphNodePosition,
  side: Side,
  fork: number,
  spine: number,
  axis: number,
  mode: 'layer' | 'parent' | 'bundle',
): { x: number; y: number } {
  if (mode === 'layer') {
    return side === 'left' || side === 'right'
      ? { x: fork, y: parent.y }
      : { x: parent.x, y: fork };
  }
  if (mode === 'parent') {
    return side === 'left' || side === 'right'
      ? { x: spine, y: axis }
      : { x: axis, y: spine };
  }
  return side === 'left' || side === 'right'
    ? { x: fork, y: axis }
    : { x: axis, y: fork };
}

/** 先沿父卡片走出关系类型，再从类型线另开一条分支接到这组卡片。类型只是线上的名字。 */
export function trunkEdges(
  graph: DependencyGraph,
  positions?: ReadonlyMap<string, GraphNodePosition>,
): { edges: EdgeData[]; forks: Map<string, { x: number; y: number }> } {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const groups = new Map<string, TrunkMember[]>();

  for (const child of graph.nodes) {
    if (child.relationHub || !child.revealedByAnchorId) {
      continue;
    }
    const fold = child.foldSummary;
    const relationType =
      fold?.relationType ??
      relationBetween(graph.edges, nodes, child.revealedByAnchorId, child.id);
    const member: TrunkMember = {
      parentId: child.revealedByAnchorId,
      childId: child.id,
      relationType,
      // 数量只在 +N 占位上展示，边标签只保留关系名
      label: relationLabel(relationType),
    };
    const key = relationFoldKey(member.parentId, relationType);
    const list = groups.get(key) ?? [];
    list.push(member);
    groups.set(key, list);
  }

  const lanes = new Map<string, LaneGroup[]>();
  const loose: TrunkMember[] = [];
  for (const members of groups.values()) {
    const parent = positions?.get(members[0]?.parentId ?? '');
    const placed = members.flatMap((member) => {
      const child = positions?.get(member.childId);
      return child ? [{ member, child }] : [];
    });
    if (!parent || !placed.length) {
      loose.push(...members);
      continue;
    }
    const placedIds = new Set(placed.map((item) => item.member.childId));
    loose.push(...members.filter((member) => !placedIds.has(member.childId)));
    // 只认声明的 pin.side；全无时才几何兜底（arrange 漏写）
    const declared = placed.map((item) => item.child.side).find(Boolean);
    const side =
      declared ??
      sideOf(
        parent,
        placed.map((item) => item.child),
      );
    const key = `${members[0]?.parentId}::${side}`;
    const lane = lanes.get(key) ?? [];
    lane.push({ members, parent, placed, side });
    lanes.set(key, lane);
  }

  const edges: EdgeData[] = loose.map((member) => straightEdge(member));
  const forks = new Map<string, { x: number; y: number }>();
  for (const lane of lanes.values()) {
    const parent = lane[0]?.parent;
    const side = lane[0]?.side;
    if (!parent || !side) {
      continue;
    }
    const skip = new Set(lane.flatMap((group) => group.members.map((member) => member.childId)));
    skip.add(lane[0]?.members[0]?.parentId ?? '');
    const others = otherNodes(positions, skip);
    // B 私有干(parent) + C 公共脊(其它) / 子中线；同侧凡有「非父」即双出线
    const bundleKids = lane
      .filter((group) => {
        const type = group.members[0]?.relationType ?? '';
        return type !== 'parent' && (isBundleRelationType(type) || type === 'bundle');
      })
      .flatMap((group) => group.placed.map((item) => item.child));
    const childKids = lane
      .filter((group) => group.members[0]?.relationType === 'child')
      .flatMap((group) => group.placed.map((item) => item.child));
    const parentKids = lane
      .filter((group) => group.members[0]?.relationType === 'parent')
      .flatMap((group) => group.placed.map((item) => item.child));
    // 中线占用者：其它关系公共脊 或 子工作项直出（下/左/右与父共存时也要错开）
    const midlineKids = bundleKids.length ? bundleKids : childKids;
    const spines = splitParentBundleSpines(parent, side, parentKids, bundleKids, others);
    const dualExit = Boolean(parentKids.length && midlineKids.length);
    const midlineAxis = midlineKids.length ? axisCenter(midlineKids, side) : undefined;
    const parentKidsAxis = parentKids.length ? axisCenter(parentKids, side) : undefined;
    const parentId = lane[0]?.members[0]?.parentId ?? '';
    // 双出线：上下父干错开；左右父走中线直出、关系出线错开（避免卡心斜切到错开点）
    const horizontal = side === 'left' || side === 'right';
    const parentAxis = horizontal ? parent.y : parent.x;
    const parentStem = dualExit
      ? horizontal
        ? parentAxis
        : clampStemOnCardEdge(
            parent,
            side,
            parentStemCenter(parent, midlineAxis ?? parentAxis, side, parentKidsAxis),
          )
      : parentAxis;
    // 左右错开必须落在卡边内，否则出线点跑到卡外会把关系线挤成折角
    const bundleLeave = dualExit && horizontal
      ? clampStemOnCardEdge(
          parent,
          side,
          parentStemCenter(parent, parentAxis, side, midlineAxis),
        )
      : parentAxis;
    lane.forEach((group) => {
      const kids = group.placed.map((item) => item.child);
      const foldOnly = group.members.every((member) => isFoldSummaryId(member.childId));
      const center = axisCenter(kids, side);
      const fork = forkAt(
        group.placed.map((item) => ({
          pos: item.child,
          half: halfOf(nodes.get(item.member.childId)),
        })),
        side,
      );
      const labelOwner = closestMember(parent, group.placed, side);
      const relationType = group.members[0]?.relationType ?? '';
      // A 直出(child) / B 私有干(parent) / C 公共脊(其它，含整体收起占位)
      const straight = relationType === 'child' && !foldOnly;
      const parentOwn = relationType === 'parent';
      // 单父贴父干：双出线时父干已错开，勿再走中线 layerRoute（会与其它关系共干）
      const stemAligned =
        parentOwn &&
        kids.length === 1 &&
        (horizontal
          ? Math.abs(kids[0].y - parentStem) < 1
          : Math.abs(kids[0].x - parentStem) < 1);
      const alone = stemAligned && Math.abs(parentStem - parentAxis) < 1;
      const stemCenter = parentOwn ? parentStem : center;
      const spine = parentOwn
        ? (spines.parent ?? fork)
        : (spines.bundle ?? spines.parent ?? fork);
      // 中线直出用 layer；双出线父干错开时 fold 钉在父干上
      const foldMode = straight || alone ? 'layer' : parentOwn ? 'parent' : 'bundle';
      const foldAxis = straight || alone
        ? parentAxis
        : parentOwn
          ? stemCenter
          : horizontal && dualExit
            ? bundleLeave
            : stemCenter;
      const foldAnchor = foldJunction(parent, side, fork, spine, foldAxis, foldMode);
      for (const item of group.placed) {
        const showLabel = item.member.childId === labelOwner;
        // 双出线：父从错开干直出（stemAligned 时竖直直线）；不与其它关系共中线
        const controlPoints = straight || alone
          ? layerRoute(parent, item.child, side, fork)
          : parentOwn
            ? parentSeparateRoute(parent, item.child, side, spine, fork, stemCenter)
            : routeOf(parent, item.child, side, spine, fork, center, bundleLeave);
        const style: EdgeData['style'] = { controlPoints };
        if (showLabel) {
          const corner = labelCorner(side, relationType === 'child');
          const spot = pointOnPath(
            [leavePoint(parent, side), ...controlPoints, rootEnterPoint(item.child, side)],
            [foldAnchor.x, foldAnchor.y],
          );
          style.labelPlacement = spot.ratio;
          style.labelOffsetX = foldAnchor.x + corner.dx - spot.at[0];
          style.labelOffsetY = foldAnchor.y + corner.dy - spot.at[1];
          style.labelTextAlign = corner.align;
          style.labelTextBaseline = corner.baseline;
        }
        edges.push(straightEdge(item.member, style, showLabel));
      }
      forks.set(relationFoldKey(parentId, relationType), foldAnchor);
    });
    // 上方位其它关系整体收起 −：钉在公共脊与中线出线的 T 口
    if (side === 'top' && bundleKids.length && spines.bundle != null && parentId) {
      forks.set(relationBundleFoldKey(parentId), { x: parent.x, y: spines.bundle });
    }
  }
  unstackSharedStrokes(edges, positions, nodes);
  return { edges, forks };
}

function straightEdge(
  member: TrunkMember,
  style?: EdgeData['style'],
  showLabel = true,
): EdgeData {
  return {
    id: `${member.parentId}:${member.relationType}:${member.childId}`,
    source: member.parentId,
    target: member.childId,
    data: {
      relationType: member.relationType,
      label: showLabel ? member.label : '',
      endArrow: true,
    },
    ...(style ? { style } : {}),
  };
}

function otherNodes(
  positions: ReadonlyMap<string, GraphNodePosition> | undefined,
  skip: ReadonlySet<string>,
): GraphNodePosition[] {
  if (!positions) {
    return [];
  }
  const list: GraphNodePosition[] = [];
  for (const [id, pos] of positions) {
    if (!skip.has(id)) {
      list.push(pos);
    }
  }
  return list;
}

function sideOf(parent: GraphNodePosition, children: GraphNodePosition[]): Side {
  let dx = 0;
  let dy = 0;
  for (const child of children) {
    dx += child.x - parent.x;
    dy += child.y - parent.y;
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

function closestMember(
  parent: GraphNodePosition,
  placed: { member: TrunkMember; child: GraphNodePosition }[],
  side: Side,
): string | undefined {
  const ranked = [...placed].sort((a, b) => {
    const da =
      side === 'left' || side === 'right'
        ? Math.abs(a.child.y - parent.y)
        : Math.abs(a.child.x - parent.x);
    const db =
      side === 'left' || side === 'right'
        ? Math.abs(b.child.y - parent.y)
        : Math.abs(b.child.x - parent.x);
    return da - db || a.member.childId.localeCompare(b.member.childId);
  });
  return ranked[0]?.member.childId;
}

/** 这组卡片外侧的分叉线，只盖住本组，不连到旁边的关系。 */
function forkAt(
  children: { pos: GraphNodePosition; half: { w: number; h: number } }[],
  side: Side,
): number {
  if (side === 'right') {
    return Math.min(...children.map((child) => child.pos.x - child.half.w)) - FORK_PAD;
  }
  if (side === 'left') {
    return Math.max(...children.map((child) => child.pos.x + child.half.w)) + FORK_PAD;
  }
  if (side === 'bottom') {
    return Math.min(...children.map((child) => child.pos.y - child.half.h)) - FORK_PAD;
  }
  return Math.max(...children.map((child) => child.pos.y + child.half.h)) + FORK_PAD;
}

/** 父脊与关联等公共脊至少隔开这么多，避免画成一条横线。 */
const SPINE_SPLIT = 56;

/**
 * 父内侧脊 + 其它关系外侧公共脊。
 * 只挪父脊去躲开公共脊，绝不改 bundle 脊——否则拖父工作项会带动整条公共干。
 */
function splitParentBundleSpines(
  parent: GraphNodePosition,
  side: Side,
  parentKids: GraphNodePosition[],
  bundleKids: GraphNodePosition[],
  others: GraphNodePosition[],
): { parent?: number; bundle?: number } {
  let parentSpine = parentKids.length ? spineAt(parent, parentKids, side, others) : undefined;
  const bundleSpine = bundleKids.length ? spineAt(parent, bundleKids, side, others) : undefined;
  if (parentSpine == null || bundleSpine == null) {
    return { parent: parentSpine, bundle: bundleSpine };
  }
  if (side === 'top') {
    const near = parent.y - HALF_H - SPINE_PAD;
    parentSpine = Math.min(near, Math.max(parentSpine, bundleSpine + SPINE_SPLIT));
  } else if (side === 'bottom') {
    const near = parent.y + HALF_H + SPINE_PAD;
    parentSpine = Math.max(near, Math.min(parentSpine, bundleSpine - SPINE_SPLIT));
  } else if (side === 'left') {
    const near = parent.x - HALF_W - SPINE_PAD;
    parentSpine = Math.min(near, Math.max(parentSpine, bundleSpine + SPINE_SPLIT));
  } else {
    const near = parent.x + HALF_W + SPINE_PAD;
    parentSpine = Math.max(near, Math.min(parentSpine, bundleSpine - SPINE_SPLIT));
  }
  return { parent: parentSpine, bundle: bundleSpine };
}

/** 父卡片外侧的公共脊柱。让开左右（或上下）已经占住的卡片，避免横穿。 */
function spineAt(
  parent: GraphNodePosition,
  children: GraphNodePosition[],
  side: Side,
  others: GraphNodePosition[],
): number {
  const fork = forkAt(
    children.map((pos) => ({ pos, half: { w: HALF_W, h: HALF_H } })),
    side,
  );
  if (side === 'right') {
    let x = parent.x + HALF_W + SPINE_PAD;
    for (const node of others) {
      const near = node.x - HALF_W;
      if (near > parent.x && near < fork) {
        x = Math.max(x, near + SPINE_PAD);
      }
    }
    return Math.min(x, fork - 24);
  }
  if (side === 'left') {
    let x = parent.x - HALF_W - SPINE_PAD;
    for (const node of others) {
      const near = node.x + HALF_W;
      if (near < parent.x && near > fork) {
        x = Math.min(x, near - SPINE_PAD);
      }
    }
    return Math.max(x, fork + 24);
  }
  if (side === 'bottom') {
    let y = parent.y + HALF_H + SPINE_PAD;
    for (const node of others) {
      const near = node.y - HALF_H;
      if (near > parent.y && near < fork) {
        y = Math.max(y, near + SPINE_PAD);
      }
    }
    return Math.min(y, fork - 24);
  }
  let y = parent.y - HALF_H - SPINE_PAD;
  for (const node of others) {
    const near = node.y - HALF_H;
    if (near < parent.y && near > fork) {
      y = Math.min(y, near - SPINE_PAD);
    }
  }
  return Math.max(y, fork + 24);
}

function onAxis(
  parent: GraphNodePosition,
  child: GraphNodePosition | undefined,
  side: Side,
): boolean {
  if (!child) {
    return false;
  }
  return side === 'left' || side === 'right'
    ? Math.abs(child.y - parent.y) < 1
    : Math.abs(child.x - parent.x) < 1;
}

function axisCenter(children: GraphNodePosition[], side: Side): number {
  if (side === 'left' || side === 'right') {
    const ys = children.map((child) => child.y);
    return (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  const xs = children.map((child) => child.x);
  return (Math.min(...xs) + Math.max(...xs)) / 2;
}

/** 子工作项：沿父卡片中线笔直落到下一层，再分到子卡片。 */
function layerRoute(
  parent: GraphNodePosition,
  child: GraphNodePosition,
  side: Side,
  fork: number,
): [number, number][] {
  if (side === 'left' || side === 'right') {
    if (Math.abs(child.y - parent.y) < 1) {
      return [[fork, parent.y]];
    }
    return [
      [fork, parent.y],
      [fork, child.y],
    ];
  }
  if (Math.abs(child.x - parent.x) < 1) {
    return [[parent.x, fork]];
  }
  return [
    [parent.x, fork],
    [child.x, fork],
  ];
}

/**
 * 父卡片 → 脊柱 → 类型线（名字在这一段）→ 本组自己的分叉 → 卡片。
 * 左右双出线时 leaveAxis 可错开，把中线留给父工作项直出。
 */
function routeOf(
  parent: GraphNodePosition,
  child: GraphNodePosition,
  side: Side,
  spine: number,
  fork: number,
  center: number,
  leaveAxis?: number,
): [number, number][] {
  if (side === 'right') {
    const edge = parent.x + HALF_W;
    const leave = leaveAxis ?? parent.y;
    return dedupePoints([
      [edge, leave],
      [spine, leave],
      [spine, center],
      [fork, center],
      [fork, child.y],
    ]);
  }
  if (side === 'left') {
    const edge = parent.x - HALF_W;
    const leave = leaveAxis ?? parent.y;
    return dedupePoints([
      [edge, leave],
      [spine, leave],
      [spine, center],
      [fork, center],
      [fork, child.y],
    ]);
  }
  return dedupePoints([
    [parent.x, spine],
    [center, spine],
    [center, fork],
    [child.x, fork],
  ]);
}

/**
 * 双出线时相对中线错开。
 * 左右用较小间距并配合 clampStemOnCardEdge，避免出线点落到卡外。
 */
function parentStemCenter(
  parent: GraphNodePosition,
  midlineCenter: number,
  side: Side,
  preferCenter?: number,
): number {
  const horizontal = side === 'left' || side === 'right';
  const axis = horizontal ? parent.y : parent.x;
  // 卡半高 34，左右最多错开约 24，才能仍落在左右边上
  const gap = horizontal ? 24 : PARENT_DUAL_EXIT_GAP;
  if (
    preferCenter != null &&
    Math.abs(preferCenter - axis) >= gap * 0.5 &&
    Math.abs(preferCenter - midlineCenter) >= gap * 0.5
  ) {
    return preferCenter;
  }
  return midlineCenter >= axis ? axis - gap : axis + gap;
}

/** 出线 stem 限制在对应卡边内侧，防止控制点跑出卡片把折线挤变形 */
function clampStemOnCardEdge(parent: GraphNodePosition, side: Side, stem: number): number {
  const pad = 10;
  if (side === 'left' || side === 'right') {
    return Math.min(parent.y + HALF_H - pad, Math.max(parent.y - HALF_H + pad, stem));
  }
  return Math.min(parent.x + HALF_W - pad, Math.max(parent.x - HALF_W + pad, stem));
}

/**
 * 父完全单出：卡边从 stem 出，干不经过中线。
 * 左右尽量「中线式」少折：先出到 fork 再落到子卡。
 */
function parentSeparateRoute(
  parent: GraphNodePosition,
  child: GraphNodePosition,
  side: Side,
  spine: number,
  fork: number,
  stem: number,
): [number, number][] {
  if (side === 'top') {
    const edge = parent.y - HALF_H;
    const rise = Math.min(spine, fork);
    return dedupePoints([
      [stem, edge],
      [stem, rise],
      [child.x, rise],
      [child.x, fork],
    ]);
  }
  if (side === 'bottom') {
    const edge = parent.y + HALF_H;
    const drop = Math.max(spine, fork);
    return dedupePoints([
      [stem, edge],
      [stem, drop],
      [child.x, drop],
      [child.x, fork],
    ]);
  }
  if (side === 'left') {
    const edge = parent.x - HALF_W;
    if (Math.abs(child.y - stem) < 1) {
      return dedupePoints([
        [edge, stem],
        [fork, stem],
      ]);
    }
    return dedupePoints([
      [edge, stem],
      [fork, stem],
      [fork, child.y],
    ]);
  }
  const edge = parent.x + HALF_W;
  if (Math.abs(child.y - stem) < 1) {
    return dedupePoints([
      [edge, stem],
      [fork, stem],
    ]);
  }
  return dedupePoints([
    [edge, stem],
    [fork, stem],
    [fork, child.y],
  ]);
}

function dedupePoints(raw: [number, number][]): [number, number][] {
  const points: [number, number][] = [];
  for (const point of raw) {
    const prev = points[points.length - 1];
    if (prev && Math.abs(prev[0] - point[0]) < 1 && Math.abs(prev[1] - point[1]) < 1) {
      continue;
    }
    points.push(point);
  }
  return points;
}

function leavePoint(parent: GraphNodePosition, side: Side): [number, number] {
  if (side === 'right') {
    return [parent.x + HALF_W, parent.y];
  }
  if (side === 'left') {
    return [parent.x - HALF_W, parent.y];
  }
  if (side === 'bottom') {
    return [parent.x, parent.y + HALF_H];
  }
  return [parent.x, parent.y - HALF_H];
}

function rootEnterPoint(child: GraphNodePosition, side: Side): [number, number] {
  if (side === 'right') {
    return [child.x - HALF_W, child.y];
  }
  if (side === 'left') {
    return [child.x + HALF_W, child.y];
  }
  if (side === 'bottom') {
    return [child.x, child.y - HALF_H];
  }
  return [child.x, child.y + HALF_H];
}

/** 收起圆半径 8，文案再让开一截，避免压线和挡住按钮。 */
const LABEL_GAP = 14;

/**
 * 子工作项在交叉点右上方。
 * 其它关系：按钮在主卡片左侧时，文案在按钮右上方；在右侧时，文案在按钮左上方。
 */
function labelCorner(
  side: Side,
  child: boolean,
): { dx: number; dy: number; align: 'left' | 'right'; baseline: 'top' | 'bottom' } {
  if (child || side === 'left' || side === 'bottom') {
    return { dx: LABEL_GAP, dy: -LABEL_GAP, align: 'left', baseline: 'bottom' };
  }
  if (side === 'right') {
    return { dx: -LABEL_GAP, dy: -LABEL_GAP, align: 'right', baseline: 'bottom' };
  }
  return { dx: LABEL_GAP, dy: LABEL_GAP, align: 'left', baseline: 'top' };
}

/** 折线上离目标最近的点，以及它在整段路径上的比例。 */
function pointOnPath(
  points: [number, number][],
  target: [number, number],
): { ratio: number; at: [number, number] } {
  const fallback = points[0] ?? target;
  let total = 0;
  const spans: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const span = from && to ? Math.hypot(to[0] - from[0], to[1] - from[1]) : 0;
    spans.push(span);
    total += span;
  }
  if (total < 1) {
    return { ratio: 0.5, at: fallback };
  }
  let best = Number.POSITIVE_INFINITY;
  let along = 0;
  let at = fallback;
  let cursor = 0;
  for (let index = 0; index < spans.length; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const span = spans[index] ?? 0;
    if (!from || !to) {
      cursor += span;
      continue;
    }
    const t = span < 1 ? 0 : clamp01(project(from, to, target));
    const point: [number, number] = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    const distance = Math.hypot(point[0] - target[0], point[1] - target[1]);
    if (distance < best) {
      best = distance;
      along = cursor + span * t;
      at = point;
    }
    cursor += span;
  }
  return { ratio: Math.min(0.98, Math.max(0.02, along / total)), at };
}

function project(from: [number, number], to: [number, number], target: [number, number]): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const span = dx * dx + dy * dy;
  if (span < 1) {
    return 0;
  }
  return ((target[0] - from[0]) * dx + (target[1] - from[1]) * dy) / span;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
