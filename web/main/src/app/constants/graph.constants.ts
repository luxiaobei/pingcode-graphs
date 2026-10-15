import type {
  EdgeData,
  GraphOptions,
  IElementDragEvent,
  IPointerEvent,
  NodeData,
} from '@antv/g6';
import type { GraphEntity, RelationStyle } from '../entities/graph.entity';

export const GRAPH_MIN_SIZE = 320;

/** 工具栏每次缩放倍率 */
export const GRAPH_ZOOM_STEP = 1.2;

/** 画布缩放区间 [min, max] */
export const GRAPH_ZOOM_RANGE: [number, number] = [0.2, 3];

/** 初次布局落位后再适应画布的延迟（ms） */
export const GRAPH_FIT_SETTLE_MS = 300;

export const DEFAULT_EDGE_COLOR = '#94a3b8';

/** 非工作项节点的默认图标（thy-icon）。 */
export const KIND_ICON_STYLE: Record<string, { icon: string; color: string }> = {
  idea: { icon: 'bulb-square-fill', color: '#f98a7c' },
  ticket: { icon: 'project-support', color: '#f6c659' },
  test_case: { icon: 'test-case-square-fill', color: '#3ddc91' },
};

/** 关系展示名与颜色。正反向各自独立。 */
export const RELATION_STYLE: Record<string, RelationStyle> = {
  block: { label: '阻塞', color: '#d64545' },
  blockedBy: { label: '被阻塞', color: '#d64545' },
  cause: { label: '原因', color: '#c47a1a' },
  causedBy: { label: '结果', color: '#c47a1a' },
  clone: { label: '拷贝', color: '#475569' },
  clonedBy: { label: '副本', color: '#475569' },
  relate: { label: '关联', color: '#3b6fd9' },
  'relate:work_item': { label: '关联工作项', color: '#3b6fd9' },
  'relate:idea': { label: '关联产品需求', color: '#7c3aed' },
  'relate:ticket': { label: '关联工单', color: '#db2777' },
  'relate:test_case': { label: '关联测试', color: '#0891b2' },
  duplicate: { label: '重复', color: '#6b7280' },
  mention: { label: '提及', color: '#7c3aed' },
  parent: { label: '父工作项', color: '#0369a1' },
  child: { label: '子工作项', color: '#0369a1' },
};

export const GRAPH_NODE_SIZE = { width: 240, height: 68 } as const;

/** 收起关系时的「+ N」占位节点尺寸 */
export const FOLD_SUMMARY_SIZE = { width: 52, height: 28 } as const;

function entityOf(datum: NodeData): GraphEntity | undefined {
  return datum.data?.['item'] as GraphEntity | undefined;
}

function nodeKind(datum: NodeData): 'hub' | 'fold' | 'card' {
  const item = entityOf(datum);
  if (item?.relationHub) {
    return 'hub';
  }
  if (item?.foldSummary) {
    return 'fold';
  }
  return 'card';
}

function nodeChrome<T>(datum: NodeData, card: T, fold: T, hub: T): T {
  const kind = nodeKind(datum);
  return kind === 'hub' ? hub : kind === 'fold' ? fold : card;
}

/** 右键留给追溯菜单，拖动只认左键。 */
function isLeftDrag(event: { button?: number; buttons?: number }): boolean {
  const buttons = event.buttons ?? 0;
  return buttons > 0 ? (buttons & 1) === 1 : (event.button ?? 0) === 0;
}

export const GRAPH_OPTIONS: Omit<GraphOptions, 'container' | 'width' | 'height'> = {
  autoFit: 'view',
  padding: 48,
  zoomRange: GRAPH_ZOOM_RANGE,
  animation: false,
  node: {
    type: 'work-item-card',
    style: {
      size: (d: NodeData) =>
        nodeChrome(
          d,
          [GRAPH_NODE_SIZE.width, GRAPH_NODE_SIZE.height],
          [FOLD_SUMMARY_SIZE.width, FOLD_SUMMARY_SIZE.height],
          [1, 1],
        ),
      radius: (d: NodeData) => nodeChrome(d, 8, 999, 0),
      fill: (d: NodeData) => nodeChrome(d, '#ffffff', '#f5f3ff', 'transparent'),
      stroke: (d: NodeData) => nodeChrome(d, '#94a3b8', '#7c3aed', 'transparent'),
      lineWidth: (d: NodeData) => nodeChrome(d, 2, 1, 0),
      opacity: (d: NodeData) => nodeChrome(d, 1, 1, 0),
      label: false,
      cursor: (d: NodeData) => nodeChrome(d, 'pointer', 'pointer', 'default'),
      pointerEvents: (d: NodeData) => nodeChrome(d, 'auto', 'auto', 'none'),
    },
    state: {
      root: { stroke: '#6698ff', lineWidth: 2, fill: '#eff6ff' },
    },
  },
  edge: {
    type: 'polyline',
    style: {
      stroke: (d: EdgeData) => (d.data?.['color'] as string) ?? '#94a3b8',
      lineWidth: 1.5,
      radius: 10,
      endArrow: (d: EdgeData) => d.data?.['endArrow'] !== false,
      labelAutoRotate: false,
      labelText: (d: EdgeData) => (d.data?.['label'] as string) ?? '',
      labelFill: (d: EdgeData) => (d.data?.['color'] as string) ?? '#64748b',
      labelFontSize: 11,
      labelFontWeight: 600,
      labelBackground: (d: EdgeData) => Boolean(d.data?.['label']),
      labelBackgroundFill: '#f8fafc',
      labelBackgroundOpacity: 0.95,
      labelPadding: [1, 4],
    },
  },
  behaviors: [
    {
      key: 'drag-canvas',
      type: 'drag-canvas',
      enable: (event: IPointerEvent) => event.targetType === 'canvas' && isLeftDrag(event),
    },
    { key: 'zoom-canvas', type: 'zoom-canvas' },
    {
      key: 'drag-element',
      type: 'drag-element',
      enable: (event: IElementDragEvent) => event.targetType === 'node' && isLeftDrag(event),
      dropEffect: 'none',
      animation: false,
    },
  ],
};
