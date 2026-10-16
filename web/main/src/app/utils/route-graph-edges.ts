import type { EdgeData } from '@antv/g6';
import { FOLD_SUMMARY_SIZE, GRAPH_NODE_SIZE } from '../constants/graph.constants';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import { PARENT_DUAL_EXIT_GAP, type Side } from './arrange-graph';
import {
  isBundleRelationType,
  isFoldSummaryId,
  isFoldSummaryNode,
  relationBetween,
  relationBundleFoldKey,
  relationColor,
  relationFoldKey,
  relationLabel,
} from './graph.util';

export type GraphNodePosition = { x: number; y: number; side?: Side };

const HALF_W = GRAPH_NODE_SIZE.width / 2;
const HALF_H = GRAPH_NODE_SIZE.height / 2;
const FOLD_HALF_W = FOLD_SUMMARY_SIZE.width / 2;
const FOLD_HALF_H = FOLD_SUMMARY_SIZE.height / 2;
const SPINE_PAD = 28;
const FORK_PAD = 36;

function halfOf(node: GraphEntity | undefined): { w: number; h: number } {
  return isFoldSummaryNode(node) ? { w: FOLD_HALF_W, h: FOLD_HALF_H } : { w: HALF_W, h: HALF_H };
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
    const labelStagger = (index: number): number =>
      lane.length <= 1 ? 0 : (index - (lane.length - 1) / 2) * 16;
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
    lane.forEach((group, groupIndex) => {
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
      // 文案落在本组类型线（子卡轴向），勿用共干 leave，否则多关系叠在同一段
      const labelCenter = straight || alone ? parentAxis : stemCenter;
      const leaveAxisForLabel = horizontal ? bundleLeave : parentAxis;
      const onSharedStem = Math.abs(labelCenter - leaveAxisForLabel) < 1;
      // 同侧多关系：共干或类型线过近时，文案改到分岔后独占段，避免叠字
      const peerCrowded =
        !straight &&
        !alone &&
        !foldOnly &&
        lane.length > 1 &&
        lane.some((peer, peerIndex) => {
          if (peerIndex === groupIndex) {
            return false;
          }
          const peerType = peer.members[0]?.relationType ?? '';
          if (peerType === 'child') {
            return false;
          }
          const peerCenter = axisCenter(
            peer.placed.map((item) => item.child),
            side,
          );
          return Math.abs(peerCenter - labelCenter) < 28;
        });
      const preferAfterFork = (onSharedStem || peerCrowded) && lane.length > 1 && !straight && !alone;
      const stagger = foldOnly || preferAfterFork || !onSharedStem ? 0 : labelStagger(groupIndex);
      const offsetX = foldOnly || straight || alone || preferAfterFork ? 0 : 16;
      const offsetY = foldOnly || straight || alone || preferAfterFork ? 0 : -12;
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
        const style: EdgeData['style'] = {
          controlPoints,
          labelPlacement: showLabel
            ? labelRatio(
                parent,
                item.child,
                side,
                controlPoints,
                labelCenter,
                straight || foldOnly || stemAligned,
                foldOnly ? 1 : 8,
                preferAfterFork,
              )
            : 'center',
          labelOffsetX: showLabel && (side === 'top' || side === 'bottom') ? offsetX + stagger : 0,
          labelOffsetY: showLabel && (side === 'left' || side === 'right') ? offsetY + stagger : 0,
        };
        if ((straight || alone || stemAligned || foldOnly) && showLabel) {
          style.labelTextAlign = 'center';
          style.labelTextBaseline = 'middle';
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
      color: relationColor(member.relationType),
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

/** 子工作项：沿父卡片中线笔直落到下一层，再分到子卡片。类型名在这段直线上。 */
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

/**
 * 名字落在类型线上。
 * 子工作项用从父卡片直下来的那一段。
 * 其他关系优先本组独占类型线；共干叠字时改落到分岔后通向子卡的那段。
 */
function labelRatio(
  parent: GraphNodePosition,
  child: GraphNodePosition,
  side: Side,
  points: [number, number][],
  center: number,
  stem: boolean,
  minSpan = 8,
  preferAfterFork = false,
): number {
  const leave = leavePoint(parent, side);
  const knots = [leave, ...points, rootEnterPoint(child, side)];
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < knots.length; index += 1) {
    const len = Math.hypot(knots[index][0] - knots[index - 1][0], knots[index][1] - knots[index - 1][1]);
    lengths.push(len);
    total += len;
  }
  if (total < 1) {
    return 0.5;
  }
  const ratioAt = (cursor: number, span: number) =>
    Math.min(0.92, Math.max(0.08, (cursor + span / 2) / total));
  const leaveAxis = side === 'left' || side === 'right' ? leave[1] : leave[0];
  let exclusiveType: number | undefined;
  let sharedType: number | undefined;
  let afterFork: number | undefined;
  let cursor = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const from = knots[index];
    const to = knots[index + 1];
    const span = lengths[index] ?? 0;
    const onType =
      side === 'left' || side === 'right'
        ? Math.abs(from[1] - center) < 1 && Math.abs(to[1] - center) < 1 && span > minSpan
        : Math.abs(from[0] - center) < 1 && Math.abs(to[0] - center) < 1 && span > minSpan;
    if (onType && from && to) {
      const ratio = ratioAt(cursor, span);
      if (stem) {
        return ratio;
      }
      const fromCard = Math.abs(from[0] - leave[0]) < 1 && Math.abs(from[1] - leave[1]) < 1;
      const onLeaveAxis = Math.abs(center - leaveAxis) < 1;
      if (!fromCard && !onLeaveAxis) {
        exclusiveType ??= ratio;
      } else {
        sharedType ??= ratio;
      }
    }
    // 分岔后通向子卡的末段（叉线 → 入卡）
    if (!stem && span > minSpan && index >= lengths.length - 2) {
      afterFork = ratioAt(cursor, span);
    }
    cursor += span;
  }
  if (preferAfterFork) {
    return afterFork ?? exclusiveType ?? sharedType ?? 0.45;
  }
  return exclusiveType ?? afterFork ?? sharedType ?? 0.45;
}
