import type { GraphOptions } from '@antv/g6';
import type { RelationStyle } from '../entities/graph.entity';
import {
  DEFAULT_RELATION_TYPES,
  EXPAND_RELATION_TYPE,
  type RelationType,
} from '../enums/graph.enum';

export const GRAPH_MIN_SIZE = 320;

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
  [EXPAND_RELATION_TYPE]: { label: '展开', color: DEFAULT_EDGE_COLOR },
};

/** 默认筛选选项；正式环境由接口下发的关系配置覆盖 */
export const RELATION_OPTIONS: Array<{ value: RelationType; label: string; color: string }> =
  DEFAULT_RELATION_TYPES.map((value) => ({
    value,
    label: RELATION_STYLE[value].label,
    color: RELATION_STYLE[value].color,
  }));

export const GRAPH_OPTIONS: Omit<GraphOptions, 'container' | 'width' | 'height'> = {
  autoFit: 'view',
  padding: 48,
  animation: false,
  layout: {
    type: 'd3-force',
    preventOverlap: true,
    collide: { radius: 80 },
    link: { distance: 140 },
    manyBody: { strength: -420 },
    center: { strength: 0.08 },
  },
  node: {
    type: 'rect',
    style: {
      size: [132, 56],
      radius: 8,
      fill: '#ffffff',
      stroke: '#94a3b8',
      lineWidth: 2,
      labelText: (d) => (d.data?.['label'] as string) ?? '',
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
    type: 'quadratic',
    style: {
      stroke: (d) => (d.data?.['color'] as string) ?? '#94a3b8',
      lineWidth: 2,
      endArrow: true,
      labelText: (d) => (d.data?.['label'] as string) ?? '',
      labelFill: '#64748b',
      labelFontSize: 9,
      labelBackground: true,
      labelBackgroundFill: '#f8fafc',
      labelBackgroundOpacity: 0.9,
      labelPadding: [1, 4],
    },
    state: {
      critical: { stroke: '#dc2626', lineWidth: 3 },
      dimmed: { opacity: 0.2 },
    },
  },
  behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
};
