import type { Side } from './arrange-graph';

const SIDES = new Set<Side>(['left', 'right', 'top', 'bottom']);

/** 是否为合法的上下左右方位。 */
export function isSide(value: unknown): value is Side {
  return typeof value === 'string' && SIDES.has(value as Side);
}

/** 过滤非法 key/方位；无有效项时返回 undefined。 */
export function normalizeRelationSides(raw: unknown): Record<string, Side> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const next: Record<string, Side> = {};
  for (const [type, side] of Object.entries(raw as Record<string, unknown>)) {
    if (type && isSide(side)) {
      next[type] = side;
    }
  }
  return Object.keys(next).length ? next : undefined;
}

/** 把 Map / Record 规范化后写入目标 Map（先清空）。 */
export function assignRelationSides(
  target: Map<string, Side>,
  sides: ReadonlyMap<string, Side> | Record<string, Side> | null | undefined,
): void {
  target.clear();
  if (!sides) {
    return;
  }
  const entries = sides instanceof Map ? sides.entries() : Object.entries(sides);
  for (const [type, side] of entries) {
    if (type && isSide(side)) {
      target.set(type, side);
    }
  }
}
