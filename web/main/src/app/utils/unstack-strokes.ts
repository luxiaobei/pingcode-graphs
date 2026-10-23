import type { EdgeData } from '@antv/g6';
import { FOLD_SUMMARY_SIZE, GRAPH_NODE_SIZE } from '../constants/graph.constants';
import type { GraphEntity } from '../entities/graph.entity';
import { planStroke, resetStrokePlans } from '../graph/flat-polyline';
import { isFoldSummaryNode } from './graph.util';

type Point = [number, number];
type NodePos = { x: number; y: number };

const EPS = 1;
const ARROW_TAIL = 6;
/** 与边样式 radius 一致。回描两倍长，G6 圆角才不会缩成一半。 */
const CORNER_RADIUS = 10;

/**
 * 同一段线只描一次。前后接在一条直线上的也算重合。
 * 裁短的边交给 flat-polyline 画，文案留在原位置。
 */
export function unstackSharedStrokes(
  edges: EdgeData[],
  positions: ReadonlyMap<string, NodePos> | undefined,
  nodes: ReadonlyMap<string, GraphEntity>,
): void {
  resetStrokePlans();
  if (!positions) {
    return;
  }
  const routed = edges.flatMap((edge) => {
    // 收起按钮前的覆盖干不参与卸叠，避免把按钮后的分叉裁掉
    if (edge.data?.['trunk'] === true) {
      return [];
    }
    const points = fullPolyline(edge, positions, nodes);
    return points && edge.id ? [{ edge, points }] : [];
  });
  if (!routed.length) {
    return;
  }

  if (routed.length < 2) {
    for (const item of routed) {
      // 单边也要 plan，避免拖拽帧落入 super.getPoints
      planStroke(item.edge.id!, item.points, labelAt(item.edge, item.points));
    }
    return;
  }

  const claimed = new Set<string>();
  const links = new Map<string, Point[]>();
  const vertices = routed.flatMap((item) => item.points);
  const ordered = [...routed].sort((a, b) => {
    const labeled = Number(hasLabel(b.edge)) - Number(hasLabel(a.edge));
    return labeled || lengthOf(b.points) - lengthOf(a.points);
  });
  for (const item of ordered) {
    const points = insertSplits(item.points, vertices);
    const start = firstOpenSegment(points, claimed);
    // 先看已描过的邻接，再占段。直线穿过的拐点不回描。
    planStroke(
      item.edge.id!,
      start > 0 ? strokeFrom(points, start, links) : points,
      labelAt(item.edge, item.points),
    );
    claimSegments(points.slice(start), claimed, links);
  }
}

/** 父卡片出线点 + 折点 + 子卡片入线点。 */
function fullPolyline(
  edge: EdgeData,
  positions: ReadonlyMap<string, NodePos>,
  nodes: ReadonlyMap<string, GraphEntity>,
): Point[] | undefined {
  const control = edge.style?.['controlPoints'] as Point[] | undefined;
  const first = control?.[0];
  const last = control?.[control.length - 1];
  const source = positions.get(String(edge.source));
  const target = positions.get(String(edge.target));
  if (!first || !last || !source || !target) {
    return undefined;
  }
  return dedupe([
    cardAnchor(source, first, halfOf(nodes.get(String(edge.source)))),
    ...control,
    cardAnchor(target, last, halfOf(nodes.get(String(edge.target)))),
  ]);
}

function halfOf(node: GraphEntity | undefined): { w: number; h: number } {
  const size = isFoldSummaryNode(node) ? FOLD_SUMMARY_SIZE : GRAPH_NODE_SIZE;
  return { w: size.width / 2, h: size.height / 2 };
}

function cardAnchor(node: NodePos, toward: Point, half: { w: number; h: number }): Point {
  const dx = toward[0] - node.x;
  const dy = toward[1] - node.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < EPS && ay < EPS) {
    return [node.x, node.y];
  }
  const scale = Math.min(ax < 1e-6 ? Infinity : half.w / ax, ay < 1e-6 ? Infinity : half.h / ay);
  return [node.x + dx * scale, node.y + dy * scale];
}

/** 从第一段还没人描过的地方开始。整段都描过时只留箭头。转弯处回搭圆角，直线穿过则不搭。 */
function strokeFrom(points: Point[], start: number, links: ReadonlyMap<string, Point[]>): Point[] {
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  if (start >= points.length - 1) {
    return last && prev ? arrowTail(prev, last) : points.slice(-2);
  }
  const sliced = points.slice(start);
  const lead = cornerLead(points[start - 1], sliced[0], sliced[1], links);
  return lead ? [lead, ...sliced] : sliced;
}

/** 接到上一段圆弧上的起点。直线已经穿过拐点时返回空，避免在 − 旁多出钩子。 */
function cornerLead(
  before: Point | undefined,
  joint: Point | undefined,
  next: Point | undefined,
  links: ReadonlyMap<string, Point[]>,
): Point | undefined {
  if (!before || !joint || !next || isStraight(before, joint, next)) {
    return undefined;
  }
  if (straightThrough(before, joint, links)) {
    return undefined;
  }
  const lead = Math.min(dist(before, joint), dist(joint, next), CORNER_RADIUS * 2);
  return lead < 1 ? undefined : step(joint, before, lead);
}

function arrowTail(prev: Point, last: Point): Point[] {
  return dist(prev, last) <= ARROW_TAIL + 1 ? [prev, last] : [step(last, prev, ARROW_TAIL), last];
}

function labelAt(edge: EdgeData, points: Point[]): Point | undefined {
  const ratio = edge.style?.['labelPlacement'];
  if (!hasLabel(edge) || typeof ratio !== 'number') {
    return undefined;
  }
  const at = pointAt(points, ratio);
  return [
    at[0] + Number(edge.style?.['labelOffsetX'] ?? 0),
    at[1] + Number(edge.style?.['labelOffsetY'] ?? 0),
  ];
}

function pointAt(points: Point[], ratio: number): Point {
  const last = points[points.length - 1] ?? [0, 0];
  const total = lengthOf(points);
  if (total < 1) {
    return last;
  }
  let remain = total * Math.min(1, Math.max(0, ratio));
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to) {
      continue;
    }
    const span = dist(from, to);
    if (remain <= span || index === points.length - 1) {
      return span < 1 ? from : step(from, to, remain);
    }
    remain -= span;
  }
  return last;
}

function firstOpenSegment(points: Point[], claimed: ReadonlySet<string>): number {
  const index = pairs(points).findIndex(([from, to]) => !claimed.has(segmentKey(from, to)));
  return index >= 0 ? index : Math.max(0, points.length - 1);
}

function claimSegments(points: Point[], claimed: Set<string>, links: Map<string, Point[]>): void {
  for (const [from, to] of pairs(points)) {
    claimed.add(segmentKey(from, to));
    pushLink(links, from, to);
    pushLink(links, to, from);
  }
}

function pushLink(links: Map<string, Point[]>, from: Point, to: Point): void {
  const key = pointId(from);
  const list = links.get(key);
  if (list) {
    list.push(to);
    return;
  }
  links.set(key, [to]);
}

function insertSplits(points: Point[], vertices: Point[]): Point[] {
  const next: Point[] = [];
  for (const [from, to] of pairs(points)) {
    append(next, from);
    const cuts = vertices
      .filter((point) => liesInside(point, from, to))
      .sort((a, b) => dist(from, a) - dist(from, b));
    for (const cut of cuts) {
      append(next, cut);
    }
  }
  const last = points[points.length - 1];
  if (last) {
    append(next, last);
  }
  return next;
}

function pairs(points: Point[]): [Point, Point][] {
  const list: [Point, Point][] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from && to) {
      list.push([from, to]);
    }
  }
  return list;
}

function liesInside(point: Point, from: Point, to: Point): boolean {
  if (near(point, from) || near(point, to)) {
    return false;
  }
  const cross = (point[0] - from[0]) * (to[1] - from[1]) - (point[1] - from[1]) * (to[0] - from[0]);
  const span = dist(from, to);
  if (span < EPS || Math.abs(cross) > EPS * span) {
    return false;
  }
  const dot = (point[0] - from[0]) * (to[0] - from[0]) + (point[1] - from[1]) * (to[1] - from[1]);
  return dot > EPS && dot < span * span - EPS;
}

function dedupe(raw: Point[]): Point[] {
  const points: Point[] = [];
  for (const point of raw) {
    append(points, point);
  }
  return points;
}

function append(points: Point[], point: Point): void {
  const prev = points[points.length - 1];
  if (!prev || !near(prev, point)) {
    points.push(point);
  }
}

function hasLabel(edge: EdgeData): boolean {
  return Boolean(edge.data?.['label']);
}

function segmentKey(from: Point, to: Point): string {
  const a = pointId(from);
  const b = pointId(to);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function pointId(point: Point): string {
  return `${Math.round(point[0])},${Math.round(point[1])}`;
}

function near(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
}

function isStraight(a: Point, b: Point, c: Point): boolean {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const span = Math.hypot(abx, aby);
  if (span < 1) {
    return true;
  }
  const cross = abx * (c[1] - b[1]) - aby * (c[0] - b[0]);
  return Math.abs(cross) <= EPS * span;
}

/** 已描过的线是否沿 before → joint 继续穿过去。 */
function straightThrough(
  before: Point,
  joint: Point,
  links: ReadonlyMap<string, Point[]>,
): boolean {
  const nexts = links.get(pointId(joint));
  return Boolean(nexts?.some((point) => continuesPast(before, joint, point)));
}

function continuesPast(before: Point, joint: Point, point: Point): boolean {
  const vx = joint[0] - before[0];
  const vy = joint[1] - before[1];
  const wx = point[0] - joint[0];
  const wy = point[1] - joint[1];
  const span = Math.hypot(vx, vy);
  const len = Math.hypot(wx, wy);
  if (span < 1 || len < 1 || Math.abs(vx * wy - vy * wx) > EPS * len) {
    return false;
  }
  return vx * wx + vy * wy > 0;
}

function lengthOf(points: Point[]): number {
  return pairs(points).reduce((total, [from, to]) => total + dist(from, to), 0);
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** 从 from 朝 toward 走 distance。 */
function step(from: Point, toward: Point, distance: number): Point {
  const span = dist(from, toward);
  if (span < 1) {
    return from;
  }
  const t = distance / span;
  return [from[0] + (toward[0] - from[0]) * t, from[1] + (toward[1] - from[1]) * t];
}
