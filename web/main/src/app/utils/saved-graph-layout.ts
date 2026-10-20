import { invoke } from '@pc-nexus/bridge';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import type { Side } from './arrange-graph';
import { isSide, normalizeRelationSides } from './side';

export type SavedNodePosition = { x: number; y: number; side?: Side };

/** 画布「保存」抛出的载荷：坐标 + 用户级关系方位（尚未拼 rootId / collapsedKeys） */
export interface SaveLayoutPayload {
  positions: Record<string, SavedNodePosition>;
  relationSides: Record<string, Side>;
}

/** 个人关系图布局（saveViewPosition.position，服务端原样存取） */
export interface SavedGraphLayout {
  rootId: string;
  positions: Record<string, SavedNodePosition>;
  collapsedKeys: string[];
  /** 用户级关系方位，与 root 无关；由 saveViewPosition.relationSides 独立存取 */
  relationSides?: Record<string, Side>;
}

/** 从可见节点收集有效坐标（跳过 relationHub；含折叠占位）。 */
export function cardPositionsFromNodes(
  nodes: readonly GraphEntity[],
): Map<string, SavedNodePosition> {
  const positions = new Map<string, SavedNodePosition>();
  for (const node of nodes) {
    if (node.relationHub || !node.position) {
      continue;
    }
    const { x, y, side } = node.position;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      positions.set(node.id, side ? { x, y, side } : { x, y });
    }
  }
  return positions;
}

/** 把已保存坐标写回节点（含折叠占位）。 */
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
      const pos = !node.relationHub ? layout.positions[node.id] : undefined;
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
    return normalizeSavedGraphLayout(raw, rootId);
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

/** 规范化 getViewPosition 返回值（供加载与单测校验）。 */
export function normalizeSavedGraphLayout(raw: unknown, rootId: string): SavedGraphLayout | null {
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
        const side = isSide(pos.side) ? pos.side : undefined;
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
