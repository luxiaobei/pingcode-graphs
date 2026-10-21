import type { EdgeData } from '@antv/g6';
import { FOLD_SUMMARY_SIZE, GRAPH_NODE_SIZE } from '../constants/graph.constants';
import {
  LAYOUT_ASSOC_SPINE_GAP,
  LAYOUT_FORK_PAD,
  LAYOUT_LABEL_GAP,
  LAYOUT_SPINE_PAD,
} from '../constants/layout.constants';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import { isAssocBundleRelation, type Side } from './arrange-graph';
import {
  BUNDLE_FOLD_TYPE,
  isFoldSummaryId,
  isFoldSummaryNode,
  relationBetween,
  relationBundleFoldKey,
  relationFoldKey,
  relationLabel,
} from './graph.util';
import { unstackSharedStrokes } from './unstack-strokes';

export type GraphNodePosition = { x: number; y: number; side?: Side };

const HALF_W = GRAPH_NODE_SIZE.width / 2;
const HALF_H = GRAPH_NODE_SIZE.height / 2;
const FOLD_HALF_W = FOLD_SUMMARY_SIZE.width / 2;
const FOLD_HALF_H = FOLD_SUMMARY_SIZE.height / 2;

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

/** − 钉在干/叉交点（勿取路径中点）。 */
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

/** 父工作项 −：偏脊侧，避开关联横脊。 */
const PARENT_FOLD_ALONG = 0.38;

function foldOnTypeStem(
  side: Side,
  spine: number,
  fork: number,
  center: number,
  along = PARENT_FOLD_ALONG,
): { x: number; y: number } {
  const at = spine + (fork - spine) * along;
  if (side === 'left' || side === 'right') {
    return { x: at, y: center };
  }
  return { x: center, y: at };
}

/** 先沿父卡片走出关系类型，再从类型线另开一条分支接到这组卡片。类型只是线上的名字。 */
export function trunkEdges(
  graph: DependencyGraph,
  positions?: ReadonlyMap<string, GraphNodePosition>,
  options?: { unstack?: boolean },
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
    // 同侧骨干 → 类型分叉；关联组再走第二脊
    const allKids = lane.flatMap((group) => group.placed.map((item) => item.child));
    const assocGroups = lane.filter((group) =>
      isAssocBundleRelation(group.members[0]?.relationType ?? ''),
    );
    const assocKids = assocGroups.flatMap((group) => group.placed.map((item) => item.child));
    const assocHub = assocKids.length ? axisCenter(assocKids, side) : undefined;
    // 公共脊不含父/子；父项单独算脊
    const nonParentKids = lane
      .filter((group) => {
        const type = group.members[0]?.relationType ?? '';
        return type !== 'parent' && type !== 'child';
      })
      .flatMap((group) => group.placed.map((item) => item.child));
    const parentKidsOnly = lane
      .filter((group) => group.members[0]?.relationType === 'parent')
      .flatMap((group) => group.placed.map((item) => item.child));
    const spineKids = nonParentKids.length ? nonParentKids : allKids;
    const spine = spineKids.length ? spineAt(parent, spineKids, side, others) : undefined;
    const parentSpine =
      parentKidsOnly.length && nonParentKids.length
        ? spineAt(parent, parentKidsOnly, side, others)
        : spine;
    const assocSpineRaw = assocKids.length ? spineAt(parent, assocKids, side, others) : undefined;
    const assocTypeFork =
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
    // 关联第二脊对齐同侧专属关系臂（不含父/子）
    const peerForks = lane
      .filter((group) => {
        const type = group.members[0]?.relationType ?? '';
        return (
          !isAssocBundleRelation(type) && type !== 'parent' && type !== 'child'
        );
      })
      .map((group) =>
        forkAt(
          group.placed.map((item) => ({
            pos: item.child,
            half: halfOf(nodes.get(item.member.childId)),
          })),
          side,
        ),
      );
    const peerAlignFork = peerForks.length ? extremeFork(peerForks, side) : undefined;
    const assocSpine =
      spine != null && assocSpineRaw != null
        ? alignAssocSpine(side, spine, assocSpineRaw, peerAlignFork, assocTypeFork)
        : undefined;
    const useAssocGroup = Boolean(
      assocKids.length && spine != null && assocHub != null && assocSpine != null,
    );
    const parentId = lane[0]?.members[0]?.parentId ?? '';
    const childAlone =
      lane.length === 1 && lane[0]?.members[0]?.relationType === 'child';
    const hasBundleFold = assocGroups.some(
      (group) => group.members[0]?.relationType === BUNDLE_FOLD_TYPE,
    );
    lane.forEach((group) => {
      const kids = group.placed.map((item) => item.child);
      const foldOnly = group.members.every((member) => isFoldSummaryId(member.childId));
      const relationType = group.members[0]?.relationType ?? '';
      const assocOwn = isAssocBundleRelation(relationType);
      // 组内仍按子类型各自中心分叉（原因/结果/重复…）
      const center = axisCenter(kids, side);
      const fork = forkAt(
        group.placed.map((item) => ({
          pos: item.child,
          half: halfOf(nodes.get(item.member.childId)),
        })),
        side,
      );
      const labelOwner = closestMember(parent, group.placed, side);
      const straight = relationType === 'child' && !foldOnly && childAlone;
      const inAssocGroup = assocOwn && useAssocGroup && !foldOnly;
      const isParent = relationType === 'parent';
      const groupSpine =
        isParent && parentSpine != null ? parentSpine : (spine ?? fork);
      const foldMode = straight ? 'layer' : 'bundle';
      // 父 − 偏脊侧
      const foldAnchor =
        isParent && !straight && groupSpine != null
          ? foldOnTypeStem(side, groupSpine, fork, center, PARENT_FOLD_ALONG)
          : foldJunction(parent, side, fork, center, foldMode);
      for (const item of group.placed) {
        const showLabel = item.member.childId === labelOwner;
        const controlPoints = straight
          ? layerRoute(parent, item.child, side, fork)
          : inAssocGroup && assocHub != null && assocSpine != null && spine != null
            ? routeAssocGroup(
                parent,
                item.child,
                side,
                spine,
                assocHub,
                assocSpine,
                fork,
                center,
              )
            : routeOf(parent, item.child, side, groupSpine, fork, center);
        // 文案钉在 − 旁
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
      if (!(assocOwn && relationType !== BUNDLE_FOLD_TYPE)) {
        forks.set(relationFoldKey(parentId, relationType), foldAnchor);
      }
    });
    // 关联文案钉分叉口；labelOnly 不描线
    if (assocKids.length && !hasBundleFold && useAssocGroup && parentId && spine != null) {
      const stemOwner = closestMember(
        parent,
        assocGroups.flatMap((group) => group.placed),
        side,
      );
      const stemChild = stemOwner ? positions?.get(stemOwner) : undefined;
      const stemGroup =
        assocGroups.find((group) =>
          group.placed.some((item) => item.member.childId === stemOwner),
        ) ?? assocGroups[0];
      if (stemOwner && stemChild && stemGroup && assocHub != null && assocSpine != null) {
        const stemCenter = axisCenter(
          stemGroup.placed.map((item) => item.child),
          side,
        );
        const stemFork = forkAt(
          stemGroup.placed.map((item) => ({
            pos: item.child,
            half: halfOf(nodes.get(item.member.childId)),
          })),
          side,
        );
        const controlPoints = routeAssocGroup(
          parent,
          stemChild,
          side,
          spine,
          assocHub,
          assocSpine,
          stemFork,
          stemCenter,
        );
        const foldAt = foldAtArmFork(side, assocHub, assocSpine);
        const corner = labelCorner(side, false);
        const spot = pointOnPath(
          [leavePoint(parent, side), ...controlPoints, rootEnterPoint(stemChild, side)],
          [foldAt.x, foldAt.y],
        );
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
            lineWidth: 0,
            stroke: 'transparent',
            labelPlacement: spot.ratio,
            labelOffsetX: foldAt.x + corner.dx - spot.at[0],
            labelOffsetY: foldAt.y + corner.dy - spot.at[1],
            labelTextAlign: corner.align,
            labelTextBaseline: corner.baseline,
          },
        });
      }
    }
    // 关联收起 − 钉第二脊分叉口
    if (assocKids.length && parentId && useAssocGroup && assocHub != null && assocSpine != null) {
      forks.set(relationBundleFoldKey(parentId), foldAtArmFork(side, assocHub, assocSpine));
    }
  }
  // 彩色模式跳过卸叠，靠绘制顺序分层
  if (options?.unstack !== false) {
    unstackSharedStrokes(edges, positions, nodes);
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
    return Math.min(...children.map((child) => child.pos.x - child.half.w)) - LAYOUT_FORK_PAD;
  }
  if (side === 'left') {
    return Math.max(...children.map((child) => child.pos.x + child.half.w)) + LAYOUT_FORK_PAD;
  }
  if (side === 'bottom') {
    return Math.min(...children.map((child) => child.pos.y - child.half.h)) - LAYOUT_FORK_PAD;
  }
  return Math.max(...children.map((child) => child.pos.y + child.half.h)) + LAYOUT_FORK_PAD;
}

/** 上下出线：主卡竖廊内障碍。 */
function corridorObstacles(
  parent: GraphNodePosition,
  others: GraphNodePosition[],
  side: Side,
): GraphNodePosition[] {
  if (side === 'top' || side === 'bottom') {
    return others.filter((node) => Math.abs(node.x - parent.x) <= HALF_W + LAYOUT_SPINE_PAD);
  }
  return others;
}

/** 上下横脊扫过的左右列（跨度相交）；用外缘抬脊，避免穿列。 */
function besideSpanObstacles(
  parent: GraphNodePosition,
  children: GraphNodePosition[],
  others: GraphNodePosition[],
  side: Side,
): GraphNodePosition[] {
  if (side !== 'top' && side !== 'bottom') {
    return [];
  }
  const xs = [parent.x, ...children.map((child) => child.x)];
  const spanLeft = Math.min(...xs) - HALF_W;
  const spanRight = Math.max(...xs) + HALF_W;
  return others.filter((node) => {
    if (Math.abs(node.x - parent.x) <= HALF_W + LAYOUT_SPINE_PAD) {
      return false;
    }
    const left = node.x - HALF_W;
    const right = node.x + HALF_W;
    return right >= spanLeft && left <= spanRight;
  });
}

/** 公共脊：让开竖廊障碍；上下侧再抬过左右列外缘。 */
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
  const obstacles = corridorObstacles(parent, others, side);
  if (side === 'right') {
    let x = parent.x + HALF_W + LAYOUT_SPINE_PAD;
    for (const node of obstacles) {
      const near = node.x - HALF_W;
      if (near > parent.x && near < fork) {
        x = Math.max(x, near + LAYOUT_SPINE_PAD);
      }
    }
    return Math.min(x, fork - 24);
  }
  if (side === 'left') {
    let x = parent.x - HALF_W - LAYOUT_SPINE_PAD;
    for (const node of obstacles) {
      const near = node.x + HALF_W;
      if (near < parent.x && near > fork) {
        x = Math.min(x, near - LAYOUT_SPINE_PAD);
      }
    }
    return Math.max(x, fork + 24);
  }
  if (side === 'bottom') {
    let y = parent.y + HALF_H + LAYOUT_SPINE_PAD;
    for (const node of obstacles) {
      const near = node.y - HALF_H;
      if (near > parent.y && near < fork) {
        y = Math.max(y, near + LAYOUT_SPINE_PAD);
      }
    }
    // 脊压到左右列底以下
    for (const node of besideSpanObstacles(parent, children, others, side)) {
      const outer = node.y + HALF_H;
      if (outer > parent.y && outer < fork) {
        y = Math.max(y, outer + LAYOUT_SPINE_PAD);
      }
    }
    return Math.min(y, fork - 24);
  }
  let y = parent.y - HALF_H - LAYOUT_SPINE_PAD;
  for (const node of obstacles) {
    const near = node.y + HALF_H;
    if (near < parent.y && near > fork) {
      y = Math.min(y, near - LAYOUT_SPINE_PAD);
    }
  }
  // 脊抬到左右列顶以上
  for (const node of besideSpanObstacles(parent, children, others, side)) {
    const outer = node.y - HALF_H;
    if (outer < parent.y && outer > fork) {
      y = Math.min(y, outer - LAYOUT_SPINE_PAD);
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

function extremeFork(forks: number[], side: Side): number {
  if (side === 'top' || side === 'left') {
    return Math.min(...forks);
  }
  return Math.max(...forks);
}

function offsetAssocSpine(side: Side, junction: number, assocSpine: number): number {
  if (side === 'top') {
    return Math.min(assocSpine, junction - LAYOUT_ASSOC_SPINE_GAP);
  }
  if (side === 'bottom') {
    return Math.max(assocSpine, junction + LAYOUT_ASSOC_SPINE_GAP);
  }
  if (side === 'left') {
    return Math.min(assocSpine, junction - LAYOUT_ASSOC_SPINE_GAP);
  }
  return Math.max(assocSpine, junction + LAYOUT_ASSOC_SPINE_GAP);
}

/** 关联第二脊：对齐同伴类型臂或相对公共脊保底；夹在公共脊与分叉之间。 */
function alignAssocSpine(
  side: Side,
  junction: number,
  assocSpineRaw: number,
  peerFork?: number,
  typeFork?: number,
): number {
  const raw =
    peerFork != null && Number.isFinite(peerFork)
      ? peerFork
      : offsetAssocSpine(side, junction, assocSpineRaw);
  if (typeFork == null || !Number.isFinite(typeFork)) {
    return raw;
  }
  const pad = 20;
  if (side === 'top') {
    const hi = junction - pad;
    const lo = typeFork + pad;
    if (lo > hi) {
      return (junction + typeFork) / 2;
    }
    return Math.min(hi, Math.max(lo, raw));
  }
  if (side === 'bottom') {
    const lo = junction + pad;
    const hi = typeFork - pad;
    if (lo > hi) {
      return (junction + typeFork) / 2;
    }
    return Math.max(lo, Math.min(hi, raw));
  }
  if (side === 'left') {
    const hi = junction - pad;
    const lo = typeFork + pad;
    if (lo > hi) {
      return (junction + typeFork) / 2;
    }
    return Math.min(hi, Math.max(lo, raw));
  }
  const lo = junction + pad;
  const hi = typeFork - pad;
  if (lo > hi) {
    return (junction + typeFork) / 2;
  }
  return Math.max(lo, Math.min(hi, raw));
}

/** 关联收起 −：钉汇合臂 × 第二脊。 */
function foldAtArmFork(
  side: Side,
  arm: number,
  forkSpine: number,
): { x: number; y: number } {
  return side === 'left' || side === 'right'
    ? { x: forkSpine, y: arm }
    : { x: arm, y: forkSpine };
}

/** 公共脊 → 类型线 → 分叉 → 卡。 */
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

/** 关联组：公共脊 → 汇合 → 第二脊 → 子类型分叉 → 卡。 */
function routeAssocGroup(
  parent: GraphNodePosition,
  child: GraphNodePosition,
  side: Side,
  spine: number,
  assocHub: number,
  assocSpine: number,
  fork: number,
  center: number,
): [number, number][] {
  if (side === 'right') {
    const edge = parent.x + HALF_W;
    return dedupePoints([
      [edge, parent.y],
      [spine, parent.y],
      [spine, assocHub],
      [assocSpine, assocHub],
      [assocSpine, center],
      [fork, center],
      [fork, child.y],
    ]);
  }
  if (side === 'left') {
    const edge = parent.x - HALF_W;
    return dedupePoints([
      [edge, parent.y],
      [spine, parent.y],
      [spine, assocHub],
      [assocSpine, assocHub],
      [assocSpine, center],
      [fork, center],
      [fork, child.y],
    ]);
  }
  return dedupePoints([
    [parent.x, spine],
    [assocHub, spine],
    [assocHub, assocSpine],
    [center, assocSpine],
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
 * 子工作项在交叉点右上方。
 * 其它关系：按钮在主卡片左侧时，文案在按钮右上方；在右侧时，文案在按钮左上方。
 */
function labelCorner(
  side: Side,
  child: boolean,
): { dx: number; dy: number; align: 'left' | 'right'; baseline: 'top' | 'bottom' } {
  if (child || side === 'left' || side === 'bottom') {
    return { dx: LAYOUT_LABEL_GAP, dy: -LAYOUT_LABEL_GAP, align: 'left', baseline: 'bottom' };
  }
  if (side === 'right') {
    return { dx: -LAYOUT_LABEL_GAP, dy: -LAYOUT_LABEL_GAP, align: 'right', baseline: 'bottom' };
  }
  return { dx: LAYOUT_LABEL_GAP, dy: LAYOUT_LABEL_GAP, align: 'left', baseline: 'top' };
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
    const point: [number, number] = [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
    ];
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
