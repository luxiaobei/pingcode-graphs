import type { Graph, IElementEvent } from '@antv/g6';
import { GRAPH_MIN_SIZE } from '../constants/graph.constants';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
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

/** 计算节点的 G6 状态：根节点标为 root */
export function buildElementStates(data: DependencyGraph): Record<string, string[]> {
  const stateMap: Record<string, string[]> = {};
  for (const node of data.nodes) {
    stateMap[node.id] = node.id === data.rootId ? ['root'] : [];
  }
  return stateMap;
}

/** 点击是否落在卡片 +/- 上 */
export function isBadgeTarget(event: IElementEvent): boolean {
  const target = (event as { nativeEvent?: { target?: EventTarget | null } }).nativeEvent?.target;
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return Boolean(element?.closest('.card-badge'));
}

/** 从节点点击事件取出业务实体 */
export function nodeItemFromEvent(g6: Graph, event: IElementEvent): GraphEntity | undefined {
  const data = g6.getNodeData(String(event.target.id))?.data;
  return data?.['item'] as GraphEntity | undefined;
}

type ScaleMove = { scale: number; x: number; y: number };

/** 只接受均匀缩放加平移。旋转、错切留给 G6 自己画。 */
function scaleMove(transform: string): ScaleMove | null {
  const matched = transform.match(/^matrix\(([^)]+)\)$/);
  if (!matched?.[1]) {
    return null;
  }
  const [scaleX, skewY, skewX, scaleY, x, y] = matched[1].split(',').map((part) => Number(part.trim()));
  if ([scaleX, skewY, skewX, scaleY, x, y].some((value) => !Number.isFinite(value))) {
    return null;
  }
  if (Math.abs(skewX) > 1e-3 || Math.abs(skewY) > 1e-3 || Math.abs(scaleX - scaleY) > 1e-3 || scaleX <= 0) {
    return null;
  }
  return { scale: scaleX, x, y };
}

/** G6 用 transform 拉伸 HTML 卡片，字会糊。改成 zoom，平移按倍率还原。 */
export function sharpenHtmlCamera(camera: HTMLElement): void {
  const move = scaleMove(camera.style.transform);
  if (!move || !CSS.supports('zoom', '1')) {
    return;
  }
  for (const child of camera.children) {
    if (child instanceof HTMLElement && child.style.willChange === 'transform') {
      child.style.willChange = 'auto';
    }
  }
  if (Math.abs(move.scale - 1) < 1e-4) {
    clearZoom(camera, move);
    return;
  }
  const x = move.x / move.scale;
  const y = move.y / move.scale;
  camera.dataset['htmlZoom'] = String(move.scale);
  camera.dataset['htmlX'] = String(x);
  camera.dataset['htmlY'] = String(y);
  camera.style.zoom = String(move.scale);
  camera.style.transform = `matrix(1, 0, 0, 1, ${x}, ${y})`;
}

/** 改写后的矩阵缩放已是 1。平移没变是观察者回声，不要把 zoom 清掉。 */
function clearZoom(camera: HTMLElement, move: ScaleMove): void {
  const zoom = Number(camera.dataset['htmlZoom'] ?? '1');
  const x = Number(camera.dataset['htmlX'] ?? '');
  const y = Number(camera.dataset['htmlY'] ?? '');
  const echo =
    Math.abs(zoom - 1) > 1e-4 &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(move.x - x) < 0.05 &&
    Math.abs(move.y - y) < 0.05;
  if (echo) {
    return;
  }
  if (camera.style.zoom !== '' && camera.style.zoom !== '1') {
    camera.style.zoom = '1';
  }
  delete camera.dataset['htmlZoom'];
  delete camera.dataset['htmlX'];
  delete camera.dataset['htmlY'];
}
