import { invoke } from '@pc-nexus/bridge';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';

/** 个人关系图布局（saveViewPosition.position，服务端原样存取） */
export interface SavedGraphLayout {
  rootId: string;
  positions: Record<string, { x: number; y: number }>;
  collapsedKeys: string[];
}

/** 从卡片节点收集有效坐标（跳过 relationHub / 折叠占位）。 */
export function cardPositionsFromNodes(
  nodes: readonly GraphEntity[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    if (node.relationHub || node.foldSummary || !node.position) {
      continue;
    }
    const { x, y } = node.position;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      positions.set(node.id, { x, y });
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
        !node.relationHub && !node.foldSummary ? layout.positions[node.id] : undefined;
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

/** 按 rootId 保存布局。 */
export function saveGraphLayout(layout: SavedGraphLayout): Promise<void> {
  return invoke('saveViewPosition', { nodeId: layout.rootId, position: layout });
}

function normalizeLayout(raw: unknown, rootId: string): SavedGraphLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const data = raw as Partial<SavedGraphLayout>;
  if (typeof data.rootId === 'string' && data.rootId !== rootId) {
    return null;
  }

  const positions: Record<string, { x: number; y: number }> = {};
  if (data.positions && typeof data.positions === 'object') {
    for (const [id, pos] of Object.entries(data.positions)) {
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        positions[id] = { x: pos.x, y: pos.y };
      }
    }
  }

  return {
    rootId,
    positions,
    collapsedKeys: Array.isArray(data.collapsedKeys)
      ? data.collapsedKeys.filter((key): key is string => typeof key === 'string')
      : [],
  };
}
