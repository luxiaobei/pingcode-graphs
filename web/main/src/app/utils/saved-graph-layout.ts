import { invoke } from '@pc-nexus/bridge';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import type { Side } from './arrange-graph';
import { isFoldSummaryNode } from './graph.util';

export type SavedNodePosition = { x: number; y: number; side?: Side };

/** 个人关系图布局（saveViewPosition.position，服务端原样存取） */
export interface SavedGraphLayout {
  rootId: string;
  positions: Record<string, SavedNodePosition>;
  collapsedKeys: string[];
  /** 用户级关系方位，与 root 无关；由 saveViewPosition.relationSides 独立存取 */
  relationSides?: Record<string, Side>;
}

const SIDES = new Set<Side>(['left', 'right', 'top', 'bottom']);

function asSide(value: unknown): Side | undefined {
  return typeof value === 'string' && SIDES.has(value as Side) ? (value as Side) : undefined;
}

/** 从卡片节点收集有效坐标（跳过 relationHub / 折叠占位）。 */
export function cardPositionsFromNodes(
  nodes: readonly GraphEntity[],
): Map<string, SavedNodePosition> {
  const positions = new Map<string, SavedNodePosition>();
  for (const node of nodes) {
    if (node.relationHub || isFoldSummaryNode(node) || !node.position) {
      continue;
    }
    const { x, y, side } = node.position;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      positions.set(node.id, side ? { x, y, side } : { x, y });
    }
  }
  return positions;
}

/** 把已保存坐标写回节点。 */
export function applySavedGraphLayout(
  graph: DependencyGraph,
  layout: SavedGraphLayout | null,
): DependencyGraph {
  if (!layout?.positions || !Object.keys(layout.positions).length) {
    return graph;
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const pos =
        !node.relationHub && !isFoldSummaryNode(node) ? layout.positions[node.id] : undefined;
      return pos ? { ...node, position: { ...pos } } : node;
    }),
  };
}

/** 读取布局；无记录或失败返回 null。 */
export async function loadSavedGraphLayout(rootId: string): Promise<SavedGraphLayout | null> {
  if (!rootId) {
    return null;
  }
  try {
    const raw = await invoke<{ nodeId: string }, unknown>('getViewPosition', { nodeId: rootId });
    return normalizeLayout(raw, rootId);
  } catch {
    return null;
  }
}

/** 按 rootId 保存布局；relationSides 走独立参数，不写入 positions。 */
export function saveGraphLayout(layout: SavedGraphLayout): Promise<void> {
  const { relationSides, ...position } = layout;
  return invoke('saveViewPosition', {
    nodeId: layout.rootId,
    position,
    ...(relationSides ? { relationSides } : {}),
  });
}

function normalizeRelationSides(raw: unknown): Record<string, Side> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const next: Record<string, Side> = {};
  for (const [type, side] of Object.entries(raw as Record<string, unknown>)) {
    const value = asSide(side);
    if (type && value) {
      next[type] = value;
    }
  }
  return Object.keys(next).length ? next : undefined;
}

function normalizeLayout(raw: unknown, rootId: string): SavedGraphLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const data = raw as Partial<SavedGraphLayout> & { relationSides?: unknown };
  const relationSides = normalizeRelationSides(data.relationSides);
  const sameRoot = typeof data.rootId !== 'string' || data.rootId === rootId;

  const positions: Record<string, SavedNodePosition> = {};
  if (sameRoot && data.positions && typeof data.positions === 'object') {
    for (const [id, pos] of Object.entries(data.positions)) {
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        const side = asSide(pos.side);
        positions[id] = side ? { x: pos.x, y: pos.y, side } : { x: pos.x, y: pos.y };
      }
    }
  }

  const collapsedKeys =
    sameRoot && Array.isArray(data.collapsedKeys)
      ? data.collapsedKeys.filter((key): key is string => typeof key === 'string')
      : [];

  if (!Object.keys(positions).length && !collapsedKeys.length && !relationSides) {
    return null;
  }

  return {
    rootId,
    positions,
    collapsedKeys,
    ...(relationSides ? { relationSides } : {}),
  };
}
