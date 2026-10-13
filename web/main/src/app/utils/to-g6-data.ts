import type { EdgeData, GraphData, NodeData } from '@antv/g6';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import { GRAPH_NODE_SIZE, RELATION_STYLE } from '../constants/graph.constants';
import { relationColor } from './graph.util';

export type GraphNodePosition = { x: number; y: number; side?: 'left' | 'right' | 'top' | 'bottom' };
export type FoldPlacement = 'right' | 'left' | 'top' | 'bottom';

/** 领域图 → G6 节点/边，并带上坐标与 +/- 方位 */
export function toG6Data(
  graph: DependencyGraph,
  positions?: ReadonlyMap<string, GraphNodePosition>,
  foldSideHint?: ReadonlyMap<string, FoldPlacement>,
): GraphData {
  const childrenOf = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!node.revealedByAnchorId) {
      continue;
    }
    const list = childrenOf.get(node.revealedByAnchorId) ?? [];
    list.push(node.id);
    childrenOf.set(node.revealedByAnchorId, list);
  }

  const cards = graph.nodes.filter((item) => !item.relationHub);
  return {
    nodes: cards.map((item) => toG6Node(item, childrenOf.get(item.id) ?? [], positions, foldSideHint)),
    edges: trunkEdges(graph, positions),
  };
}

/** +/- 跟可见子项平均方位；收起后沿用上次所在侧 */
export function resolveFoldPlacement(
  item: GraphEntity,
  childIds: readonly string[],
  positions?: ReadonlyMap<string, GraphNodePosition>,
  foldSideHint?: ReadonlyMap<string, FoldPlacement>,
): FoldPlacement {
  const self = positions?.get(item.id) ?? item.position;
  if (self && positions && childIds.length) {
    let dx = 0;
    let dy = 0;
    let count = 0;
    for (const childId of childIds) {
      const pos = positions.get(childId);
      if (!pos) {
        continue;
      }
      dx += pos.x - self.x;
      dy += pos.y - self.y;
      count += 1;
    }
    if (count) {
      dx /= count;
      dy /= count;
      return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';
    }
  }
  return foldSideHint?.get(item.id) ?? 'right';
}

/** 业务节点 → HTML 卡片。+/- 画在卡片上。 */
function toG6Node(
  item: GraphEntity,
  childIds: readonly string[],
  positions?: ReadonlyMap<string, GraphNodePosition>,
  foldSideHint?: ReadonlyMap<string, FoldPlacement>,
): NodeData {
  const position = positions?.get(item.id) ?? item.position;
  const foldPlacement = resolveFoldPlacement(item, childIds, positions, foldSideHint);
  const node: NodeData = {
    id: item.id,
    type: 'work-item-card',
    data: {
      expandToggle: item.expandToggle,
      foldPlacement,
      item,
      width: item.relationHub ? 1 : GRAPH_NODE_SIZE.width,
      height: item.relationHub ? 1 : GRAPH_NODE_SIZE.height,
    },
  };
  if (position) {
    node.style = { ...node.style, x: position.x, y: position.y };
  }
  return node;
}

type Side = 'left' | 'right' | 'top' | 'bottom';

interface TrunkMember {
  parentId: string;
  childId: string;
  relationType: string;
  label: string;
}

const HALF_W = GRAPH_NODE_SIZE.width / 2;
const HALF_H = GRAPH_NODE_SIZE.height / 2;
function canonicalType(type: string): string {
  return RELATION_STYLE[type]?.canonical ?? type;
}

function typeLabel(type: string): string {
  const canonical = canonicalType(type);
  return RELATION_STYLE[canonical]?.label ?? RELATION_STYLE[type]?.label ?? type;
}

interface LaneGroup {
  members: TrunkMember[];
  parent: GraphNodePosition;
  placed: { member: TrunkMember; child: GraphNodePosition }[];
  side: Side;
}

/** 先沿父卡片走出关系类型，再从类型线另开一条分支接到这组卡片。类型只是线上的名字。 */
function trunkEdges(
  graph: DependencyGraph,
  positions?: ReadonlyMap<string, GraphNodePosition>,
): EdgeData[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const groups = new Map<string, TrunkMember[]>();

  for (const child of graph.nodes) {
    if (child.relationHub || !child.revealedByAnchorId) {
      continue;
    }
    const relationType = canonicalType(relationOf(graph, nodes, child.revealedByAnchorId, child.id));
    const member: TrunkMember = {
      parentId: child.revealedByAnchorId,
      childId: child.id,
      relationType,
      label: typeLabel(relationType),
    };
    const key = `${member.parentId}::${relationType}`;
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
  for (const lane of lanes.values()) {
    const parent = lane[0]?.parent;
    const side = lane[0]?.side;
    if (!parent || !side) {
      continue;
    }
    const children = lane.flatMap((group) => group.placed.map((item) => item.child));
    const skip = new Set(lane.flatMap((group) => group.members.map((member) => member.childId)));
    skip.add(lane[0]?.members[0]?.parentId ?? '');
    const spine = spineAt(parent, children, side, otherNodes(positions, skip));
    for (const group of lane) {
      const kids = group.placed.map((item) => item.child);
      const center = axisCenter(kids, side);
      const fork = forkAt(kids, side);
      const labelOwner = closestMember(parent, group.placed, side);
      const straight = group.members[0]?.relationType === 'child';
      const labelCenter = straight ? (side === 'left' || side === 'right' ? parent.y : parent.x) : center;
      for (const item of group.placed) {
        const showLabel = item.member.childId === labelOwner;
        const controlPoints = straight
          ? layerRoute(parent, item.child, side, fork)
          : routeOf(parent, item.child, side, spine, fork, center);
        const style: EdgeData['style'] = {
          controlPoints,
          labelPlacement: showLabel ? labelRatio(parent, item.child, side, controlPoints, labelCenter) : 'center',
          labelOffsetX: !straight && showLabel && (side === 'top' || side === 'bottom') ? 16 : 0,
          labelOffsetY: !straight && showLabel && (side === 'left' || side === 'right') ? -12 : 0,
        };
        if (straight && showLabel) {
          style.labelTextAlign = 'center';
          style.labelTextBaseline = 'middle';
        }
        edges.push(straightEdge(item.member, style, showLabel));
      }
    }
  }
  return edges;
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

function relationOf(
  graph: DependencyGraph,
  nodes: ReadonlyMap<string, GraphEntity>,
  parentId: string,
  childId: string,
): string {
  const direct = graph.edges.find(
    (edge) =>
      (edge.source === parentId && edge.target === childId) ||
      (edge.target === parentId && edge.source === childId),
  );
  if (direct) {
    return direct.relationType;
  }
  for (const edge of graph.edges) {
    const hubId = edge.source === parentId ? edge.target : edge.target === parentId ? edge.source : undefined;
    const hub = hubId ? nodes.get(hubId) : undefined;
    if (!hub?.relationHub) {
      continue;
    }
    const linked = graph.edges.some(
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
    const da = side === 'left' || side === 'right' ? Math.abs(a.child.y - parent.y) : Math.abs(a.child.x - parent.x);
    const db = side === 'left' || side === 'right' ? Math.abs(b.child.y - parent.y) : Math.abs(b.child.x - parent.x);
    return da - db || a.member.childId.localeCompare(b.member.childId);
  });
  return ranked[0]?.member.childId;
}

const SPINE_PAD = 28;
const FORK_PAD = 36;

/** 这组卡片外侧的分叉线，只盖住本组，不连到旁边的关系。 */
function forkAt(children: GraphNodePosition[], side: Side): number {
  if (side === 'right') {
    return Math.min(...children.map((child) => child.x - HALF_W)) - FORK_PAD;
  }
  if (side === 'left') {
    return Math.max(...children.map((child) => child.x + HALF_W)) + FORK_PAD;
  }
  if (side === 'bottom') {
    return Math.min(...children.map((child) => child.y - HALF_H)) - FORK_PAD;
  }
  return Math.max(...children.map((child) => child.y + HALF_H)) + FORK_PAD;
}

/** 父卡片外侧的公共脊柱。让开左右（或上下）已经占住的卡片，避免横穿。 */
function spineAt(
  parent: GraphNodePosition,
  children: GraphNodePosition[],
  side: Side,
  others: GraphNodePosition[],
): number {
  const fork = forkAt(children, side);
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

function enterPoint(child: GraphNodePosition, side: Side): [number, number] {
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

/** 名字落在类型线上，不落在卡片那条分叉上。 */
function labelRatio(
  parent: GraphNodePosition,
  child: GraphNodePosition,
  side: Side,
  points: [number, number][],
  center: number,
): number {
  const knots = [leavePoint(parent, side), ...points, enterPoint(child, side)];
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
  let cursor = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const from = knots[index];
    const to = knots[index + 1];
    const span = lengths[index] ?? 0;
    const onType =
      side === 'left' || side === 'right'
        ? Math.abs(from[1] - center) < 1 && Math.abs(to[1] - center) < 1 && span > 8
        : Math.abs(from[0] - center) < 1 && Math.abs(to[0] - center) < 1 && span > 8;
    if (onType) {
      return Math.min(0.92, Math.max(0.08, (cursor + span / 2) / total));
    }
    cursor += span;
  }
  return 0.45;
}
