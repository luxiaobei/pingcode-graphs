import type { Graph, IElementEvent } from '@antv/g6';
import { GRAPH_MIN_SIZE } from '../constants/graph.constants';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import { isCriticalRelation } from './graph.util';
import type { FoldPlacement, GraphNodePosition } from './to-g6-data';

/** 按容器尺寸取画布宽高，不低于最小值 */
export function graphHostSize(container: HTMLElement): { width: number; height: number } {
  const rect = container.getBoundingClientRect();
  return {
    width: Math.max(rect.width, GRAPH_MIN_SIZE),
    height: Math.max(rect.height, GRAPH_MIN_SIZE),
  };
}

/** 把当前可见节点坐标写入 pins（收起节点坐标不覆盖） */
export function snapshotGraphPositions(
  g6: Graph,
  pins: Map<string, GraphNodePosition>,
): void {
  for (const node of g6.getNodeData()) {
    const id = String(node.id);
    const [x, y] = g6.getElementPosition(id);
    pins.set(id, { x, y });
  }
}

/** 记录已展开节点的 +/- 所在侧，收起后仍贴同一侧 */
export function rememberFoldSides(
  g6: Graph,
  foldSideById: Map<string, FoldPlacement>,
): void {
  for (const node of g6.getNodeData()) {
    const placement = node.data?.['foldPlacement'] as FoldPlacement | undefined;
    if (placement && node.data?.['expandToggle'] === 'expanded') {
      foldSideById.set(String(node.id), placement);
    }
  }
}

/** 计算节点/边的 G6 状态：root、selected、critical、dimmed */
export function buildElementStates(
  data: DependencyGraph,
  selectedId: string | null,
  highlightCritical: boolean,
): Record<string, string[]> {
  const criticalSet = new Set(highlightCritical ? data.criticalPath : []);
  const stateMap: Record<string, string[]> = {};

  for (const node of data.nodes) {
    const states: string[] = [];
    if (node.id === data.rootId) {
      states.push('root');
    }
    if (node.id === selectedId) {
      states.push('selected');
    }
    if (criticalSet.has(node.id)) {
      states.push('critical');
    } else if (highlightCritical) {
      states.push('dimmed');
    }
    stateMap[node.id] = states;
  }

  for (const edge of data.edges) {
    const onCritical =
      highlightCritical &&
      isCriticalRelation(edge.relationType) &&
      criticalSet.has(edge.source) &&
      criticalSet.has(edge.target);
    stateMap[edge.id] = onCritical ? ['critical'] : highlightCritical ? ['dimmed'] : [];
  }

  return stateMap;
}

/** 点击是否落在卡片 +/- 徽标上 */
export function isBadgeTarget(event: IElementEvent): boolean {
  let current: unknown = (event as { originalTarget?: unknown }).originalTarget ?? event.target;
  for (let i = 0; i < 6 && current; i++) {
    const obj = current as {
      id?: string | number;
      className?: string | { baseVal?: string };
      nodeName?: string;
      name?: string;
      config?: { name?: string };
      parentNode?: unknown;
      parentElement?: unknown;
      parent?: unknown;
    };
    const hit = [
      obj.id,
      typeof obj.className === 'string' ? obj.className : obj.className?.baseVal,
      obj.nodeName,
      obj.name,
      obj.config?.name,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (hit.includes('badge')) {
      return true;
    }
    current = obj.parentNode ?? obj.parentElement ?? obj.parent;
  }
  return false;
}

/** 从节点点击事件取出业务实体 */
export function nodeItemFromEvent(g6: Graph, event: IElementEvent): GraphEntity | undefined {
  const data = g6.getNodeData(String(event.target.id))?.data;
  return data?.['item'] as GraphEntity | undefined;
}
