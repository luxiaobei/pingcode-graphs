import type { EdgeData } from '@antv/g6';
import { FOLD_SUMMARY_SIZE, GRAPH_NODE_SIZE } from '../constants/graph.constants';
import type { GraphEntity } from '../entities/graph.entity';
import { planStroke, resetStrokePlans } from '../graph/flat-polyline';
import { isFoldSummaryNode } from './graph.util';

type Point = [number, number];
type NodePos = { x: number; y: number };

const EPS = 1;
const ARROW_TAIL = 6;
const CORNER = 10;

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
  const vertices = routed.flatMap((item) => item.points);
  const ordered = [...routed].sort((a, b) => {
    const labeled = Number(hasLabel(b.edge)) - Number(hasLabel(a.edge));
    return labeled || lengthOf(b.points) - lengthOf(a.points);
  });
  for (const item of ordered) {
    const points = insertSplits(item.points, vertices);
    const start = firstOpenSegment(points, claimed);
    claimSegments(points.slice(start), claimed);
    if (!item.edge.id) {
      continue;
    }
    const label = labelAt(item.edge, item.points);
    // 一律写入 plan（含整段自绘），拖拽中只用绝对坐标，杜绝斜线
    planStroke(
      item.edge.id,
      start > 0 ? strokeFrom(points, start) : points,
      label,
    );
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

/** 从第一段还没人描过的地方开始。整段都描过时只留箭头。拐角往回搭一个圆角。 */
function strokeFrom(points: Point[], start: number): Point[] {
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  if (start >= points.length - 1) {
    return last && prev ? arrowTail(prev, last) : points.slice(-2);
  }
  const sliced = points.slice(start);
  const before = points[start - 1];
  const joint = sliced[0];
  const next = sliced[1];
  if (!before || !joint || !next || isStraight(before, joint, next)) {
    return sliced;
  }
  const prevLen = dist(before, joint);
  const nextLen = dist(joint, next);
  if (prevLen < 1 || nextLen < 1) {
    return sliced;
  }
  return [step(joint, before, Math.min(CORNER, prevLen, nextLen / 2)), ...sliced];
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

function claimSegments(points: Point[], claimed: Set<string>): void {
  for (const [from, to] of pairs(points)) {
    claimed.add(segmentKey(from, to));
  }
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
  const id = (point: Point) => `${Math.round(point[0])},${Math.round(point[1])}`;
  const a = id(from);
  const b = id(to);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function near(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
}

function isStraight(a: Point, b: Point, c: Point): boolean {
  const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  return dist(a, c) < 1 || Math.abs(cross) <= dist(a, c);
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
