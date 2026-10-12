import type {
  EdgeData,
  GraphOptions,
  IElementDragEvent,
  IPointerEvent,
  NodeData,
} from '@antv/g6';
import type { RelationStyle } from '../entities/graph.entity';

export const GRAPH_MIN_SIZE = 320;

/** 工具栏每次缩放倍率 */
export const GRAPH_ZOOM_STEP = 1.2;

/** 画布缩放区间 [min, max] */
export const GRAPH_ZOOM_RANGE: [number, number] = [0.2, 3];

/** 力导向收束后再适应一次的延迟（ms） */
export const GRAPH_FIT_SETTLE_MS = 300;

/** 业务节点占位（含间距），展开落点避让用 */
export const GRAPH_NODE_SLOT = { width: 168, height: 96 } as const;

export const DEFAULT_EDGE_COLOR = '#94a3b8';

/** 参与「关键路径」高亮的规范关系类型（可由接口配置覆盖） */
export const CRITICAL_PATH_RELATION_TYPES: readonly string[] = ['block'];

export const RELATION_STYLE: Record<string, RelationStyle> = {
  block: { label: '阻塞', color: '#d64545' },
  blockedBy: { label: '被阻塞', color: '#d64545', canonical: 'block' },
  cause: { label: '导致', color: '#c47a1a' },
  causedBy: { label: '由…导致', color: '#c47a1a', canonical: 'cause' },
  relate: { label: '关联', color: '#3b6fd9' },
  'relate:work_item': { label: '关联工作项', color: '#3b6fd9' },
  'relate:idea': { label: '关联产品需求', color: '#7c3aed' },
  'relate:ticket': { label: '关联工单', color: '#db2777' },
  'relate:test_case': { label: '关联测试', color: '#0891b2' },
  'relate:objective': { label: '关联目标', color: '#ca8a04' },
  duplicate: { label: '重复', color: '#6b7280' },
  depend: { label: '依赖', color: '#0f766e' },
  mention: { label: '提及', color: '#7c3aed' },
  clone: { label: '克隆', color: '#475569' },
  child: { label: '子工作项', color: '#0369a1' },
};

export const GRAPH_NODE_SIZE = { width: 132, height: 56 } as const;

function relationHubOf(datum: NodeData): string | undefined {
  return (datum.data?.['item'] as { relationHub?: string } | undefined)?.relationHub;
}

function cardOrHub<T>(datum: NodeData, card: T, hub: T): T {
  return relationHubOf(datum) ? hub : card;
}

/** 思维导图：根节点居中，关系向两侧展开。 */
export const GRAPH_MINDMAP_LAYOUT = {
  type: 'mindmap' as const,
  direction: 'H' as const,
  getId: (node: { id: string }) => node.id,
  getWidth: (node: { width?: number; data?: { width?: number } }) =>
    node.width ?? node.data?.width ?? GRAPH_NODE_SIZE.width,
  getHeight: (node: { height?: number; data?: { height?: number } }) =>
    node.height ?? node.data?.height ?? GRAPH_NODE_SIZE.height,
  getHGap: () => 64,
  getVGap: () => 18,
};

export const GRAPH_OPTIONS: Omit<GraphOptions, 'container' | 'width' | 'height'> = {
  autoFit: 'view',
  padding: 48,
  zoomRange: GRAPH_ZOOM_RANGE,
  animation: false,
  layout: GRAPH_MINDMAP_LAYOUT,
  node: {
    type: 'rect',
    style: {
      size: (d: NodeData) => cardOrHub(d, [132, 56] as [number, number], [1, 1]),
      radius: 8,
      fill: (d: NodeData) => cardOrHub(d, '#ffffff', 'transparent'),
      stroke: (d: NodeData) => cardOrHub(d, '#94a3b8', 'transparent'),
      lineWidth: (d: NodeData) => cardOrHub(d, 2, 0),
      opacity: (d: NodeData) => cardOrHub(d, 1, 0),
      labelText: (d: NodeData) => cardOrHub(d, (d.data?.['label'] as string) ?? '', ''),
      labelFill: '#1f2937',
      labelFontSize: 11,
      labelPlacement: 'center',
      labelWordWrap: true,
      labelMaxWidth: 120,
      cursor: (d: NodeData) => cardOrHub(d, 'pointer', 'default'),
      pointerEvents: (d: NodeData) => cardOrHub(d, 'auto', 'none'),
    },
    state: {
      root: { stroke: '#2563eb', lineWidth: 3, fill: '#eff6ff' },
      selected: { stroke: '#0f766e', lineWidth: 3, fill: '#ecfdf5' },
      critical: { stroke: '#dc2626', fill: '#fef2f2' },
      dimmed: { opacity: 0.25 },
    },
  },
  edge: {
    type: 'polyline',
    style: {
      stroke: (d: EdgeData) => (d.data?.['color'] as string) ?? '#94a3b8',
      lineWidth: 1.5,
      radius: 8,
      router: { type: 'orth' },
      endArrow: (d: EdgeData) => d.data?.['endArrow'] !== false,
      labelText: (d: EdgeData) => (d.data?.['label'] as string) ?? '',
      labelFill: (d: EdgeData) => (d.data?.['color'] as string) ?? '#64748b',
      labelFontSize: 11,
      labelFontWeight: 600,
      labelBackground: (d: EdgeData) => Boolean(d.data?.['label']),
      labelBackgroundFill: '#f8fafc',
      labelBackgroundOpacity: 0.95,
      labelPadding: [1, 4],
    },
    state: {
      critical: { stroke: '#dc2626', lineWidth: 2.5, lineDash: [0, 0] },
      dimmed: { opacity: 0.2 },
    },
  },
  behaviors: [
    {
      key: 'drag-canvas',
      type: 'drag-canvas',
      enable: (event: IPointerEvent) => event.targetType === 'canvas',
    },
    { key: 'zoom-canvas', type: 'zoom-canvas' },
    {
      key: 'drag-element',
      type: 'drag-element',
      enable: (event: IElementDragEvent) => event.targetType === 'node',
      dropEffect: 'none',
      animation: false,
    },
  ],
};
