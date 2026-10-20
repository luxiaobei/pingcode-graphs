import type { EdgeData } from '@antv/g6';
import { FOLD_SUMMARY_SIZE, GRAPH_NODE_SIZE } from '../constants/graph.constants';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import { isAssocBundleRelation, type Side } from './arrange-graph';
import { unstackSharedStrokes } from './unstack-strokes';
import {
  BUNDLE_FOLD_TYPE,
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
const FOLD_HALF_W = FOLD_SUMMARY_SIZE.width / 2;
const FOLD_HALF_H = FOLD_SUMMARY_SIZE.height / 2;
const SPINE_PAD = 28;
const FORK_PAD = 44;

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
  axis: number,
  mode: 'layer' | 'bundle',
): { x: number; y: number } {
  if (mode === 'layer') {
    return side === 'left' || side === 'right'
      ? { x: fork, y: parent.y }
      : { x: parent.x, y: fork };
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
    // 同侧一条骨干，再按「类型组」分叉（非 T 形）。
    // 「关联」是独立类型组：所有可并入关联的子卡共用一根类型线，与关联工单/父/子并列分叉。
    const allKids = lane.flatMap((group) => group.placed.map((item) => item.child));
    const assocGroups = lane.filter((group) =>
      isAssocBundleRelation(group.members[0]?.relationType ?? ''),
    );
    const assocKids = assocGroups.flatMap((group) => group.placed.map((item) => item.child));
    const assocCenter = assocKids.length ? axisCenter(assocKids, side) : undefined;
    const assocFork =
      assocKids.length > 0
        ? forkAt(
            assocGroups.flatMap((group) =>
              group.placed.map((item) => ({
                pos: item.child,
                half: halfOf(nodes.get(item.member.childId)),
              })),
            ),
            side,
          )
        : undefined;
    const spine = allKids.length ? spineAt(parent, allKids, side, others) : undefined;
    const labelStagger = (index: number): number =>
      lane.length <= 1 ? 0 : (index - (lane.length - 1) / 2) * 16;
    const parentId = lane[0]?.members[0]?.parentId ?? '';
    const horizontal = side === 'left' || side === 'right';
    const parentAxis = horizontal ? parent.y : parent.x;
    const childAlone =
      lane.length === 1 && lane[0]?.members[0]?.relationType === 'child';
    const hasBundleFold = assocGroups.some(
      (group) => group.members[0]?.relationType === BUNDLE_FOLD_TYPE,
    );
    lane.forEach((group, groupIndex) => {
      const kids = group.placed.map((item) => item.child);
      const foldOnly = group.members.every((member) => isFoldSummaryId(member.childId));
      const relationType = group.members[0]?.relationType ?? '';
      const assocOwn = isAssocBundleRelation(relationType);
      // 关联组：强制走同一类型线，保证从骨干分出独立的「关联」支
      const center =
        assocOwn && assocCenter != null ? assocCenter : axisCenter(kids, side);
      const fork =
        assocOwn && assocFork != null && !foldOnly
          ? assocFork
          : forkAt(
              group.placed.map((item) => ({
                pos: item.child,
                half: halfOf(nodes.get(item.member.childId)),
              })),
              side,
            );
      const labelOwner = closestMember(parent, group.placed, side);
      const straight = relationType === 'child' && !foldOnly && childAlone;
      const labelCenter = straight ? parentAxis : center;
      const onSharedStem = !straight && Math.abs(labelCenter - parentAxis) < 1;
      const peerCrowded =
        !straight &&
        !foldOnly &&
        !assocOwn &&
        lane.length > 1 &&
        lane.some((peer, peerIndex) => {
          if (peerIndex === groupIndex) {
            return false;
          }
          const peerType = peer.members[0]?.relationType ?? '';
          if (peerType === 'child' || peerType === 'parent') {
            return false;
          }
          if (isAssocBundleRelation(peerType)) {
            return false;
          }
          const peerAxis = axisCenter(
            peer.placed.map((item) => item.child),
            side,
          );
          return Math.abs(peerAxis - labelCenter) < 28;
        });
      // 关联组文案用「关联」钉在类型线；子类型名（若展示）落到分岔后
      const preferAfterFork =
        !straight &&
        (assocOwn || ((onSharedStem || peerCrowded) && lane.length > 1));
      const stagger = foldOnly || preferAfterFork || !onSharedStem ? 0 : labelStagger(groupIndex);
      const offsetX = foldOnly || straight || preferAfterFork ? 0 : 16;
      const offsetY = foldOnly || straight || preferAfterFork ? 0 : -12;
      const groupSpine = spine ?? fork;
      const foldMode = straight ? 'layer' : 'bundle';
      const foldAnchor = foldJunction(parent, side, fork, center, foldMode);
      for (const item of group.placed) {
        // 展开关联组：边不写子类型名（由「关联」干文案承担，与关联工单并列）
        const showLabel =
          item.member.childId === labelOwner &&
          !(assocOwn && relationType !== BUNDLE_FOLD_TYPE && !foldOnly);
        const controlPoints = straight
          ? layerRoute(parent, item.child, side, fork)
          : routeOf(parent, item.child, side, groupSpine, fork, center);
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
                preferAfterFork,
              )
            : 'center',
          labelOffsetX: showLabel && (side === 'top' || side === 'bottom') ? offsetX + stagger : 0,
          labelOffsetY: showLabel && (side === 'left' || side === 'right') ? offsetY + stagger : 0,
        };
        if ((straight || foldOnly) && showLabel) {
          style.labelTextAlign = 'center';
          style.labelTextBaseline = 'middle';
        }
        edges.push(straightEdge(item.member, style, showLabel));
      }
      if (!(assocOwn && relationType !== BUNDLE_FOLD_TYPE)) {
        forks.set(relationFoldKey(parentId, relationType), foldAnchor);
      }
    });
    // 展开时画独立「关联」类型线文案（收起由 +N 边自带「关联」）
    if (assocKids.length && !hasBundleFold && spine != null && parentId && assocCenter != null) {
      const stemOwner = closestMember(
        parent,
        assocGroups.flatMap((group) => group.placed),
        side,
      );
      const stemChild = stemOwner ? positions?.get(stemOwner) : undefined;
      if (stemOwner && stemChild) {
        const stemFork = assocFork ?? forkAt([{ pos: stemChild, half: halfOf(nodes.get(stemOwner)) }], side);
        const controlPoints = routeOf(parent, stemChild, side, spine, stemFork, assocCenter);
        edges.push({
          id: `${parentId}:bundle:assoc-stem`,
          source: parentId,
          target: stemOwner,
          data: {
            relationType: BUNDLE_FOLD_TYPE,
            label: relationLabel(BUNDLE_FOLD_TYPE),
            endArrow: false,
            labelOnly: true,
          },
          style: {
            controlPoints,
            labelPlacement: labelRatio(
              parent,
              stemChild,
              side,
              controlPoints,
              assocCenter,
              false,
              8,
              false,
            ),
            labelTextAlign: 'center',
            labelTextBaseline: 'middle',
            labelOffsetX: 0,
            labelOffsetY: 0,
          },
        });
      }
    }
    // 关联整体收起 −：钉在组内分叉口（类型线 → 各卡），不是骨干分出「关联」处
    if (assocKids.length && parentId && assocCenter != null && assocFork != null) {
      forks.set(
        relationBundleFoldKey(parentId),
        foldJunction(parent, side, assocFork, assocCenter, 'bundle'),
      );
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
 * 父卡片 → 公共脊 → 类型线（名字在这一段）→ 本组自己的分叉 → 卡片。
 */
function routeOf(
  parent: GraphNodePosition,
  child: GraphNodePosition,
  side: Side,
  spine: number,
  fork: number,
  center: number,
): [number, number][] {
  if (side === 'right') {
    const edge = parent.x + HALF_W;
    return dedupePoints([
      [edge, parent.y],
      [spine, parent.y],
      [spine, center],
      [fork, center],
      [fork, child.y],
    ]);
  }
  if (side === 'left') {
    const edge = parent.x - HALF_W;
    return dedupePoints([
      [edge, parent.y],
      [spine, parent.y],
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
  let afterForkSpan = 0;
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
    // 分岔后末几段：取较长独占臂放文案，避免落在入卡短 stub 上贴卡/贴岔口
    if (!stem && span > minSpan && index >= lengths.length - 2 && span >= afterForkSpan) {
      afterForkSpan = span;
      afterFork = Math.min(0.86, Math.max(0.2, (cursor + span * 0.55) / total));
    }
    cursor += span;
  }
  if (preferAfterFork) {
    return afterFork ?? exclusiveType ?? sharedType ?? 0.45;
  }
  return exclusiveType ?? afterFork ?? sharedType ?? 0.45;
}
