import type {
  EdgeData,
  GraphOptions,
  IElementDragEvent,
  IPointerEvent,
  NodeData,
} from '@antv/g6';
import type { RelationStyle } from '../entities/graph.entity';
import { DEFAULT_RELATION_TYPES, type RelationType } from '../enums/graph.enum';

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
  duplicate: { label: '重复', color: '#6b7280' },
  depend: { label: '依赖', color: '#0f766e' },
  mention: { label: '提及', color: '#7c3aed' },
  clone: { label: '克隆', color: '#475569' },
  child: { label: '子工作项', color: '#0369a1' },
};

/** 默认筛选选项；正式环境由接口下发的关系配置覆盖 */
export const RELATION_OPTIONS: Array<{ value: RelationType; label: string; color: string }> =
  DEFAULT_RELATION_TYPES.map((value) => ({
    value,
    label: RELATION_STYLE[value].label,
    color: RELATION_STYLE[value].color,
  }));

export const GRAPH_FORCE_LAYOUT = {
  type: 'd3-force' as const,
  preventOverlap: true,
  collide: { radius: 90 },
  link: { distance: 180 },
  manyBody: { strength: -520 },
  center: { strength: 0.05 },
};

export const GRAPH_OPTIONS: Omit<GraphOptions, 'container' | 'width' | 'height'> = {
  autoFit: 'view',
  padding: 48,
  zoomRange: GRAPH_ZOOM_RANGE,
  animation: false,
  layout: GRAPH_FORCE_LAYOUT,
  node: {
    type: 'rect',
    style: {
      size: [132, 56] as [number, number],
      radius: 8,
      fill: '#ffffff',
      stroke: '#94a3b8',
      lineWidth: 2,
      labelText: (d: NodeData) => (d.data?.['label'] as string) ?? '',
      labelFill: '#1f2937',
      labelFontSize: 11,
      labelPlacement: 'center',
      labelWordWrap: true,
      labelMaxWidth: 120,
      cursor: 'pointer',
    },
    state: {
      root: { stroke: '#2563eb', lineWidth: 3, fill: '#eff6ff' },
      selected: { stroke: '#0f766e', lineWidth: 3, fill: '#ecfdf5' },
      critical: { stroke: '#dc2626', fill: '#fef2f2' },
      dimmed: { opacity: 0.25 },
    },
  },
  edge: {
    type: 'line',
    style: {
      stroke: (d: EdgeData) => (d.data?.['color'] as string) ?? '#94a3b8',
      lineWidth: 1.5,
      lineDash: [6, 4],
      endArrow: true,
      labelText: (d: EdgeData) => (d.data?.['label'] as string) ?? '',
      labelFill: '#64748b',
      labelFontSize: 9,
      labelBackground: true,
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
