import type { EdgeData, GraphOptions, IElementDragEvent, IPointerEvent, NodeData } from '@antv/g6';
import type { GraphEntity, RelationStyle } from '../entities/graph.entity';

export const GRAPH_MIN_SIZE = 320;

/** 关系图画布固定高度。 */
export const GRAPH_HEIGHT = 1000;

/** 工具栏每次缩放倍率 */
export const GRAPH_ZOOM_STEP = 1.2;

/** 画布缩放区间 [min, max] */
export const GRAPH_ZOOM_RANGE: [number, number] = [0.2, 3];

/** 初次布局落位后再适应画布的延迟（ms） */
export const GRAPH_FIT_SETTLE_MS = 300;

export const DEFAULT_EDGE_COLOR = '#ccd0d8';

/** 关系文案，略深于线条。 */
export const EDGE_LABEL_COLOR = '#c0c4cc';

/** 悬停连回主卡片的线，与根卡片描边相同。 */
export const EDGE_LINK_COLOR = '#6698ff';

/** 彩色模式线色兑白比例（写成实色，避免半透明叠灰）。 */
export const EDGE_COLOR_OPACITY = 0.5;

/** 彩色模式文案兑白比例。 */
export const EDGE_LABEL_COLOR_OPACITY = 0.8;

/** 实色按 opacity 叠到白底。 */
export function fadeColorOnWhite(hex: string, opacity: number): string {
  const raw = hex.replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (full.length !== 6) {
    return hex;
  }
  const n = Number.parseInt(full, 16);
  const mix = (channel: number) => Math.round(channel * opacity + 255 * (1 - opacity));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** 箭头 [沿边长度, 张开高度]。 */
export const EDGE_ARROW_SIZE: [number, number] = [4, 10];

/** 非工作项节点的默认图标（thy-icon）。 */
export const KIND_ICON_STYLE: Record<string, { icon: string; color: string }> = {
  idea: { icon: 'bulb-square-fill', color: '#f98a7c' },
  ticket: { icon: 'project-support', color: '#f6c659' },
  test_case: { icon: 'test-case-square-fill', color: '#3ddc91' },
};

/** 关系文案与彩色线色（关联类色值对齐产品「关联」选择器）。 */
export const RELATION_STYLE: Record<string, RelationStyle> = {
  block: { label: '阻塞', color: '#fa8888' },
  blockedBy: { label: '被阻塞', color: '#ff9f73' },
  cause: { label: '原因', color: '#f6c659' },
  causedBy: { label: '结果', color: '#73d897' },
  clone: { label: '拷贝', color: '#a9e072' },
  clonedBy: { label: '副本', color: '#56abfb' },
  relate: { label: '关联', color: '#868af6' },
  'relate:work_item': { label: '关联工作项', color: '#868af6' },
  bundle: { label: '关联', color: '#868af6' },
  'relate:idea': { label: '关联产品需求', color: KIND_ICON_STYLE['idea'].color },
  'relate:ticket': { label: '关联工单', color: KIND_ICON_STYLE['ticket'].color },
  'relate:test_case': { label: '关联测试', color: KIND_ICON_STYLE['test_case'].color },
  duplicate: { label: '重复', color: '#5dcfff' },
  mention: { label: '提及', color: '#d287f8' },
  parent: { label: '父工作项', color: EDGE_LINK_COLOR },
  child: { label: '子工作项', color: EDGE_LINK_COLOR },
};

export function relationEdgeColor(relationType: string): string {
  return RELATION_STYLE[relationType]?.color ?? DEFAULT_EDGE_COLOR;
}

/** 与 PJM 工作项卡片一致：宽 262，高 80。 */
export const GRAPH_NODE_SIZE = { width: 262, height: 80 } as const;

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
      root: { stroke: EDGE_LINK_COLOR, lineWidth: 2, fill: '#eff6ff' },
    },
  },
  edge: {
    type: 'flat-polyline',
    style: {
      stroke: (d: EdgeData) => (d.data?.['edgeColor'] as string) ?? DEFAULT_EDGE_COLOR,
      lineWidth: 1,
      radius: 10,
      endArrow: (d: EdgeData) => d.data?.['endArrow'] !== false,
      endArrowType: 'simple',
      endArrowSize: EDGE_ARROW_SIZE,
      endArrowLineJoin: 'miter',
      labelAutoRotate: false,
      labelText: (d: EdgeData) => (d.data?.['label'] as string) ?? '',
      labelFill: (d: EdgeData) => (d.data?.['labelColor'] as string) ?? EDGE_LABEL_COLOR,
      labelFontSize: 12,
      labelFontWeight: 600,
      labelBackground: false,
    },
    state: {
      /** 悬停连回主卡片 */
      link: { stroke: EDGE_LINK_COLOR },
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
