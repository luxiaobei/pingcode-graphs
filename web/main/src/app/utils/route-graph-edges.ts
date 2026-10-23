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
  relationBundleLabelKey,
  relationFoldKey,
  relationLabel,
} from './graph.util';
import { planStroke, resetStrokePlans } from '../graph/flat-polyline';
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

/**
 * 同侧拖展开的叶卡时冻结关联共用脊，避免「关联」− 跟着被拖类型跑。
 * 「+ N」是线的终点，不冻结，否则主干留在原地会多出一截竖线。
 * 换侧时不要传；被拖卡自身出线仍用实时坐标。
 */
export type TrunkDragFreeze = { id: string; pos: GraphNodePosition };

/** 先沿父卡片走出关系类型，再从类型线另开一条分支接到这组卡片。类型只是线上的名字。 */
export function trunkEdges(
  graph: DependencyGraph,
  positions?: ReadonlyMap<string, GraphNodePosition>,
  options?: { unstack?: boolean; freezeDrag?: TrunkDragFreeze },
): { edges: EdgeData[]; forks: Map<string, { x: number; y: number }> } {
  const freezeDrag = options?.freezeDrag;
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
  const foldTrunks: { id: string; points: [number, number][] }[] = [];
  const forks = new Map<string, { x: number; y: number }>();
  /** 同一父卡多方位关联时只保留成员最多的一侧，避免 forks 键被后写覆盖把「关联」拖飞 */
  const assocForkByParent = new Map<
    string,
    {
      parent: GraphNodePosition;
      side: Side;
      count: number;
      spine: number;
      assocHub: number;
      assocSpine: number;
      childId: string;
    }
  >();
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
    const allPlaced = lane.flatMap((group) => group.placed);
    const assocGroups = lane.filter((group) =>
      isAssocBundleRelation(group.members[0]?.relationType ?? ''),
    );
    const assocPlaced = assocGroups.flatMap((group) => group.placed);
    // 共用枢纽/脊用冻结坐标（同侧拖拽），叶臂仍用实时 child
    const assocKidsHub = placedPositions(assocPlaced, freezeDrag);
    const assocHub = assocKidsHub.length ? axisCenter(assocKidsHub, side) : undefined;
    // 公共脊不含父/子；父项单独算脊
    const nonParentPlaced = lane
      .filter((group) => {
        const type = group.members[0]?.relationType ?? '';
        return type !== 'parent' && type !== 'child';
      })
      .flatMap((group) => group.placed);
    const parentKidsOnly = lane
      .filter((group) => group.members[0]?.relationType === 'parent')
      .flatMap((group) => group.placed.map((item) => item.child));
    const spineKids = nonParentPlaced.length
      ? placedPositions(nonParentPlaced, freezeDrag)
      : placedPositions(allPlaced, freezeDrag);
    const spine = spineKids.length ? spineAt(parent, spineKids, side, others) : undefined;
    const parentSpine =
      parentKidsOnly.length && nonParentPlaced.length
        ? spineAt(parent, parentKidsOnly, side, others)
        : spine;
    const assocSpineRaw = assocKidsHub.length
      ? spineAt(parent, assocKidsHub, side, others)
      : undefined;
    const assocTypeFork =
      assocPlaced.length > 0
        ? forkAt(
            assocPlaced.map((item) => ({
              pos: frozenOrLive(item, freezeDrag),
              half: halfOf(nodes.get(item.member.childId)),
            })),
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
      assocKidsHub.length && spine != null && assocHub != null && assocSpine != null,
    );
    const parentId = lane[0]?.members[0]?.parentId ?? '';
    const childAlone =
      lane.length === 1 && lane[0]?.members[0]?.relationType === 'child';
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
      const routeTo = (child: GraphNodePosition): [number, number][] =>
        straight
          ? layerRoute(parent, child, side, fork)
          : inAssocGroup && assocHub != null && assocSpine != null && spine != null
            ? routeAssocGroup(parent, child, side, spine, assocHub, assocSpine, fork, center)
            : routeOf(parent, child, side, groupSpine, fork, center);
      for (const item of group.placed) {
        const showLabel = item.member.childId === labelOwner;
        const controlPoints = routeTo(item.child);
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
      // 收起按钮前的主干。关联类并进整体干，不单独再描。
      const sample = group.placed[0];
      if (sample && parentId && !foldOnly && !(assocOwn && relationType !== BUNDLE_FOLD_TYPE)) {
        const id = `fold-trunk:${relationFoldKey(parentId, relationType)}`;
        const points = pathUntil(
          [leavePoint(parent, side), ...routeTo(sample.child)],
          foldAnchor,
        );
        foldTrunks.push({ id, points });
        edges.push({
          id,
          source: parentId,
          target: sample.member.childId,
          data: { relationType, label: '', endArrow: false, trunk: true },
          style: { controlPoints: points },
        });
      }
      if (!(assocOwn && relationType !== BUNDLE_FOLD_TYPE)) {
        forks.set(relationFoldKey(parentId, relationType), foldAnchor);
      }
    });
    if (assocPlaced.length && parentId && useAssocGroup && assocHub != null && assocSpine != null) {
      const prev = assocForkByParent.get(parentId);
      const childId = assocPlaced[0]?.member.childId;
      if (!prev || assocPlaced.length > prev.count) {
        if (childId && spine != null) {
          assocForkByParent.set(parentId, {
            parent,
            side,
            count: assocPlaced.length,
            spine,
            assocHub,
            assocSpine,
            childId,
          });
        }
      }
    }
  }
  const trunks: { id: string; points: [number, number][] }[] = [];
  for (const [parentId, cand] of assocForkByParent) {
    forks.set(relationBundleFoldKey(parentId), foldAtArmFork(cand.side, cand.assocHub, cand.assocSpine));
    // 文案只跟父卡 + 方位，不吃 spine/hub（叶卡一动就变）
    forks.set(relationBundleLabelKey(parentId), assocTrunkLabelAt(cand.parent, cand.side));
    const id = `bundle-trunk:${parentId}`;
    const points = assocTrunkPoints(cand.parent, cand.side, cand.spine, cand.assocHub, cand.assocSpine);
    trunks.push({ id, points });
    edges.push({
      id,
      source: parentId,
      target: cand.childId,
      data: {
        relationType: bundleTrunkType(nodes, parentId),
        label: '',
        endArrow: false,
        trunk: true,
      },
      style: { controlPoints: points },
    });
  }
  // 彩色模式不卸叠，整段描出后再把关联主干盖在共用段上
  if (options?.unstack !== false) {
    unstackSharedStrokes(edges, positions, nodes);
  } else {
    resetStrokePlans();
  }
  for (const trunk of [...trunks, ...foldTrunks]) {
    planStroke(trunk.id, trunk.points);
  }
  return { edges, forks };
}

/** 与收起时「关联」占位同一关系色。 */
function bundleTrunkType(nodes: ReadonlyMap<string, GraphEntity>, parentId: string): string {
  const fold = nodes
    .get(parentId)
    ?.folds?.find((item) => item.key === relationBundleFoldKey(parentId));
  return fold?.relationType ?? BUNDLE_FOLD_TYPE;
}

/** 父卡到「关联」− 的共用段，不含各关系自己的分叉。 */
function assocTrunkPoints(
  parent: GraphNodePosition,
  side: Side,
  spine: number,
  assocHub: number,
  assocSpine: number,
): [number, number][] {
  if (side === 'right') {
    return dedupePoints([
      [parent.x + HALF_W, parent.y],
      [spine, parent.y],
      [spine, assocHub],
      [assocSpine, assocHub],
    ]);
  }
  if (side === 'left') {
    return dedupePoints([
      [parent.x - HALF_W, parent.y],
      [spine, parent.y],
      [spine, assocHub],
      [assocSpine, assocHub],
    ]);
  }
  const edgeY = side === 'bottom' ? parent.y + HALF_H : parent.y - HALF_H;
  return dedupePoints([
    [parent.x, edgeY],
    [parent.x, spine],
    [assocHub, spine],
    [assocHub, assocSpine],
  ]);
}

/** 路径裁到收起按钮，按钮之后的分叉不包含在内。 */
function pathUntil(
  points: [number, number][],
  at: { x: number; y: number },
): [number, number][] {
  const end: [number, number] = [at.x, at.y];
  const kept: [number, number][] = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point) {
      break;
    }
    if (nearPoint(point, end)) {
      kept.push(end);
      break;
    }
    kept.push(point);
    const next = points[index + 1];
    if (next && segmentHolds(point, next, end)) {
      kept.push(end);
      break;
    }
  }
  return dedupePoints(kept.length ? kept : [end]);
}

function nearPoint(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1.5 && Math.abs(a[1] - b[1]) < 1.5;
}

function segmentHolds(
  a: [number, number],
  b: [number, number],
  point: [number, number],
): boolean {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const length2 = abx * abx + aby * aby;
  if (length2 < 1) {
    return nearPoint(a, [point[0], point[1]]);
  }
  const t = ((point[0] - a[0]) * abx + (point[1] - a[1]) * aby) / length2;
  if (t < -0.02 || t > 1.02) {
    return false;
  }
  const x = a[0] + abx * t;
  const y = a[1] + aby * t;
  return Math.abs(x - point[0]) < 2 && Math.abs(y - point[1]) < 2;
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

function frozenOrLive(
  item: { member: TrunkMember; child: GraphNodePosition },
  freeze: TrunkDragFreeze | undefined,
): GraphNodePosition {
  // 「+ N」被拖走时线必须跟着走。冻在起点会让关联主干竖在旧位置。
  if (freeze && item.member.childId === freeze.id && !isFoldSummaryId(freeze.id)) {
    return freeze.pos;
  }
  return item.child;
}

function placedPositions(
  placed: { member: TrunkMember; child: GraphNodePosition }[],
  freeze: TrunkDragFreeze | undefined,
): GraphNodePosition[] {
  return placed.map((item) => frozenOrLive(item, freeze));
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

/**
 * 「关联」文案：相对父卡出线方向固定外探，不依赖 spine/hub/叶卡坐标。
 * 拖提及、结果等只动叶卡时，文案世界坐标必须不变。
 */
function assocTrunkLabelAt(
  parent: GraphNodePosition,
  side: Side,
): { x: number; y: number } {
  const pad = LAYOUT_SPINE_PAD + LAYOUT_LABEL_GAP;
  if (side === 'right') {
    return { x: parent.x + HALF_W + pad, y: parent.y };
  }
  if (side === 'left') {
    return { x: parent.x - HALF_W - pad, y: parent.y };
  }
  if (side === 'bottom') {
    return { x: parent.x, y: parent.y + HALF_H + pad };
  }
  return { x: parent.x, y: parent.y - HALF_H - pad };
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
