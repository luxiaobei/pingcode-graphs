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

export const DEFAULT_EDGE_COLOR = '#CCD0D8';

/** 关系文案。只比线条 #CCD0D8 深一点点。 */
export const EDGE_LABEL_COLOR = '#C0C4CC';

/** 箭头 [沿边长度, 张开高度]。半角约 45°，两边斜线比原先短一截。 */
export const EDGE_ARROW_SIZE: [number, number] = [4, 10];

/** 非工作项节点的默认图标（thy-icon）。 */
export const KIND_ICON_STYLE: Record<string, { icon: string; color: string }> = {
  idea: { icon: 'bulb-square-fill', color: '#f98a7c' },
  ticket: { icon: 'project-support', color: '#f6c659' },
  test_case: { icon: 'test-case-square-fill', color: '#3ddc91' },
};

/** 关系展示名。正反向各自独立。 */
export const RELATION_STYLE: Record<string, RelationStyle> = {
  block: { label: '阻塞' },
  blockedBy: { label: '被阻塞' },
  cause: { label: '原因' },
  causedBy: { label: '结果' },
  clone: { label: '拷贝' },
  clonedBy: { label: '副本' },
  relate: { label: '关联' },
  'relate:work_item': { label: '关联工作项' },
  'relate:idea': { label: '关联产品需求' },
  'relate:ticket': { label: '关联工单' },
  'relate:test_case': { label: '关联测试' },
  duplicate: { label: '重复' },
  mention: { label: '提及' },
  parent: { label: '父工作项' },
  child: { label: '子工作项' },
  /** 上方位等其它关系整体收起时的边文案 */
  bundle: { label: '关联' },
};

/** 与 PJM 工作项卡片一致：宽 262，高 80。 */
export const GRAPH_NODE_SIZE = { width: 262, height: 80 } as const;

/** thy-tag lg 高度。箭头停在占位边上，宽高要和标签本身一致。 */
const FOLD_SUMMARY_HEIGHT = 28;

/** thy-tag lg：左右 padding 12px，边框 1px。 */
const FOLD_TAG_CHROME_X = 12 * 2 + 1 * 2;

const FOLD_LABEL_FONT =
  '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Helvetica Neue", Arial, sans-serif';

let foldLabelCanvas: HTMLCanvasElement | null = null;

function foldLabelWidth(text: string): number {
  foldLabelCanvas ??= typeof document === 'undefined' ? null : document.createElement('canvas');
  const context = foldLabelCanvas?.getContext('2d');
  if (!context) {
    return 12.5 + text.replace(/^\+ /, '').length * 8.8;
  }
  context.font = FOLD_LABEL_FONT;
  return context.measureText(text).width;
}

/** 「+ N」占位尺寸，贴合 thy-tag lg，避免箭头和标签之间留空。 */
export function foldSummarySize(count: number): { width: number; height: number } {
  return {
    width: Math.ceil(foldLabelWidth(`+ ${count}`) + FOLD_TAG_CHROME_X),
    height: FOLD_SUMMARY_HEIGHT,
  };
}

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
      size: (d: NodeData) => {
        const item = entityOf(d);
        if (item?.relationHub) {
          return [1, 1];
        }
        if (item?.foldSummary) {
          const size = foldSummarySize(item.foldSummary.count);
          return [size.width, size.height];
        }
        return [GRAPH_NODE_SIZE.width, GRAPH_NODE_SIZE.height];
      },
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
    type: 'flat-polyline',
    style: {
      stroke: DEFAULT_EDGE_COLOR,
      lineWidth: 1,
      radius: 10,
      endArrow: (d: EdgeData) => d.data?.['endArrow'] !== false,
      endArrowType: 'simple',
      endArrowSize: EDGE_ARROW_SIZE,
      endArrowLineJoin: 'miter',
      labelAutoRotate: false,
      labelText: (d: EdgeData) => (d.data?.['label'] as string) ?? '',
      labelFill: EDGE_LABEL_COLOR,
      labelFontSize: 12,
      labelFontWeight: 600,
      labelBackground: false,
    },
    state: {
      /** 悬停非主卡片时，它到主卡片的连线 */
      link: { stroke: '#6698ff' },
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
