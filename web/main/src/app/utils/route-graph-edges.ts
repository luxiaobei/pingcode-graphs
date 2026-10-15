import type { EdgeData } from '@antv/g6';
import { FOLD_SUMMARY_SIZE, GRAPH_NODE_SIZE } from '../constants/graph.constants';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import { type Side } from './arrange-graph';
import {
  isFoldSummaryId,
  isFoldSummaryNode,
  relationBetween,
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

/** 展开收起落在这条关系开始分叉的位置。 */
function junction(
  parent: GraphNodePosition,
  side: Side,
  center: number,
  fork: number,
  straight: boolean,
): { x: number; y: number } {
  if (straight) {
    return side === 'left' || side === 'right' ? { x: fork, y: parent.y } : { x: parent.x, y: fork };
  }
  return side === 'left' || side === 'right' ? { x: fork, y: center } : { x: center, y: fork };
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
    const side =
      placed.find((item) => item.child.side)?.child.side ?? sideOf(parent, placed.map((item) => item.child));
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
    // 关联/重复/阻塞等共用外侧脊柱（图二）；父用内侧独立脊柱，绝不并进公共横脊
    const bundleKids = lane
      .filter((group) => group.members[0]?.relationType !== 'parent')
      .flatMap((group) => group.placed.map((item) => item.child));
    const parentKids = lane
      .filter((group) => group.members[0]?.relationType === 'parent')
      .flatMap((group) => group.placed.map((item) => item.child));
    const spines = splitParentBundleSpines(parent, side, parentKids, bundleKids, others);
    // 同侧多组关系（含多个 +N）错开标签，避免叠字
    const labelStagger = (index: number): number =>
      lane.length <= 1 ? 0 : (index - (lane.length - 1) / 2) * 16;
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
      // 折叠占位不走 straight：否则同侧多条边共用父卡中线，线与文案叠在一起
      const straight = relationType === 'child' && !foldOnly;
      const parentOwn = relationType === 'parent';
      const alone = parentOwn && kids.length === 1 && onAxis(parent, kids[0], side);
      const labelCenter =
        straight || alone ? (side === 'left' || side === 'right' ? parent.y : parent.x) : center;
      const parentId = group.members[0]?.parentId ?? '';
      forks.set(relationFoldKey(parentId, relationType), junction(parent, side, center, fork, straight));
      // 折叠文案贴在类型线上，不再做偏移/错位（短竖段时否则会漂到横干上）
      const stagger = foldOnly ? 0 : labelStagger(groupIndex);
      const offsetX = foldOnly || straight || alone ? 0 : 16;
      const offsetY = foldOnly || straight || alone ? 0 : -12;
      const spine = parentOwn
        ? (spines.parent ?? fork)
        : (spines.bundle ?? spines.parent ?? fork);
      for (const item of group.placed) {
        const showLabel = item.member.childId === labelOwner;
        // 父与其它关系均走正交 routeOf；父走内侧独立脊，不经过关联等公共横脊
        const controlPoints = straight
          ? layerRoute(parent, item.child, side, fork)
          : routeOf(parent, item.child, side, spine, fork, center);
        const style: EdgeData['style'] = {
          controlPoints,
          labelPlacement: showLabel
            ? labelRatio(
                parent,
                item.child,
                side,
                controlPoints,
                labelCenter,
                straight || foldOnly,
                foldOnly ? 1 : 8,
              )
            : 'center',
          labelOffsetX: showLabel && (side === 'top' || side === 'bottom') ? offsetX + stagger : 0,
          labelOffsetY: showLabel && (side === 'left' || side === 'right') ? offsetY + stagger : 0,
        };
        if ((straight || alone || foldOnly) && showLabel) {
          style.labelTextAlign = 'center';
          style.labelTextBaseline = 'middle';
        }
        edges.push(straightEdge(item.member, style, showLabel));
      }
    });
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
 * 算出父内侧脊 + 其它关系外侧公共脊，并强制错开。
 * 同侧有父时，父绝不走关联/阻塞那条横脊（便于其它关系日后整体收起）。
 */
function splitParentBundleSpines(
  parent: GraphNodePosition,
  side: Side,
  parentKids: GraphNodePosition[],
  bundleKids: GraphNodePosition[],
  others: GraphNodePosition[],
): { parent?: number; bundle?: number } {
  let parentSpine = parentKids.length ? spineAt(parent, parentKids, side, others) : undefined;
  let bundleSpine = bundleKids.length ? spineAt(parent, bundleKids, side, others) : undefined;
  if (parentSpine == null || bundleSpine == null) {
    return { parent: parentSpine, bundle: bundleSpine };
  }
  if (side === 'top') {
    // 靠父卡 = y 更大；外侧公共脊再往上（y 更小）
    const near = parent.y - HALF_H - SPINE_PAD;
    parentSpine = Math.min(near, Math.max(parentSpine, bundleSpine + SPINE_SPLIT));
    if (parentSpine < bundleSpine + SPINE_SPLIT) {
      bundleSpine = parentSpine - SPINE_SPLIT;
    }
  } else if (side === 'bottom') {
    // 靠父卡 = y 更小；外侧公共脊再往下（y 更大）
    const near = parent.y + HALF_H + SPINE_PAD;
    parentSpine = Math.max(near, Math.min(parentSpine, bundleSpine - SPINE_SPLIT));
    if (parentSpine > bundleSpine - SPINE_SPLIT) {
      bundleSpine = parentSpine + SPINE_SPLIT;
    }
  } else if (side === 'left') {
    // 靠父卡 = x 更大；外侧公共脊再往左（x 更小）
    const near = parent.x - HALF_W - SPINE_PAD;
    parentSpine = Math.min(near, Math.max(parentSpine, bundleSpine + SPINE_SPLIT));
    if (parentSpine < bundleSpine + SPINE_SPLIT) {
      bundleSpine = parentSpine - SPINE_SPLIT;
    }
  } else {
    // 靠父卡 = x 更小；外侧公共脊再往右（x 更大）
    const near = parent.x + HALF_W + SPINE_PAD;
    parentSpine = Math.max(near, Math.min(parentSpine, bundleSpine - SPINE_SPLIT));
    if (parentSpine > bundleSpine - SPINE_SPLIT) {
      bundleSpine = parentSpine + SPINE_SPLIT;
    }
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
 * 同一关系的线叠在一起，不同关系各开一条。
 */
function routeOf(
  parent: GraphNodePosition,
  child: GraphNodePosition,
  side: Side,
  spine: number,
  fork: number,
  center: number,
): [number, number][] {
  const raw: [number, number][] =
    side === 'left' || side === 'right'
      ? [
          [spine, parent.y],
          [spine, center],
          [fork, center],
          [fork, child.y],
        ]
      : [
          [parent.x, spine],
          [center, spine],
          [center, fork],
          [child.x, fork],
        ];
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
 * 其他关系在中线和类型线重合时，避开贴着卡片的短段。
 */
function labelRatio(
  parent: GraphNodePosition,
  child: GraphNodePosition,
  side: Side,
  points: [number, number][],
  center: number,
  stem: boolean,
  minSpan = 8,
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
  let onCard: number | undefined;
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
      if (!fromCard) {
        return ratio;
      }
      onCard ??= ratio;
    }
    cursor += span;
  }
  return onCard ?? 0.45;
}
