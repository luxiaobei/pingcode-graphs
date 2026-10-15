import type { Graph } from '@antv/g6';
import type { DependencyGraph } from '../entities/graph.entity';
import {
  arrangeGraph,
  mergeLayoutPositions,
  resolvePinnedExpandCollapse,
} from './arrange-graph';
import { snapshotGraphPositions } from './g6-helpers';
import { isFoldSummaryId } from './graph.util';
import { cardPositionsFromNodes } from './saved-graph-layout';
import type { GraphNodePosition } from './to-g6-data';

/** 画布位置会话：会话 pin、已保存坐标、换根/展开收起时的坐标策略。 */
export class CanvasPositionSession {
  /** 当前会话拖拽 / 布局输出 */
  readonly pins = new Map<string, GraphNodePosition>();
  /** 服务端下发 / 已保存；一键整理优先还原 */
  private readonly saved = new Map<string, GraphNodePosition>();
  private lastDepth: number | null = null;
  private lastRootId: string | null = null;

  clear(): void {
    this.pins.clear();
    this.saved.clear();
    this.lastDepth = null;
    this.lastRootId = null;
  }

  /** 把 G6 当前可见节点坐标写入 pin（已收起节点不覆盖）。 */
  snapshot(g6: Graph): void {
    snapshotGraphPositions(g6, this.pins);
  }

  /** 导出可持久化的坐标表（折叠占位不落库）。 */
  toSaveRecord(): Record<string, { x: number; y: number }> {
    return Object.fromEntries(
      [...this.pins]
        .filter(([id]) => !isFoldSummaryId(id))
        .map(([id, { x, y }]) => [id, { x, y }]),
    );
  }

  /**
   * 同一根、同一深度且画布上仍有节点时复用 pin；否则清空 pin 并同步 saved，返回 null 表示走基准布局。
   */
  prepare(
    data: DependencyGraph,
    canvasNodeIds: ReadonlySet<string>,
    g6: Graph | null,
  ): ReadonlyMap<string, GraphNodePosition> | null {
    const sharesNode = data.nodes.some((node) => canvasNodeIds.has(node.id));
    const reusePins =
      this.lastRootId === data.rootId && this.lastDepth === data.depth && sharesNode;

    if (!reusePins) {
      this.pins.clear();
      this.lastDepth = data.depth;
      this.lastRootId = data.rootId;
      this.syncSaved(data);
      return null;
    }

    if (!g6) {
      return null;
    }
    this.snapshot(g6);
    return this.pins.size ? this.pins : null;
  }

  /** 可见卡片均已有 pin 时，可只 redraw 不重排（pins 可能仍含已收起节点）。 */
  sameVisibleNodes(data: DependencyGraph): boolean {
    const ids = data.nodes.filter((node) => !node.relationHub).map((node) => node.id);
    return ids.length > 0 && ids.every((id) => this.pins.has(id));
  }

  /** 基准布局：saved 优先，缺的用思维导图补齐。 */
  resolveBaseline(data: DependencyGraph): Map<string, GraphNodePosition> {
    this.syncSaved(data);
    return mergeLayoutPositions(arrangeGraph(data), this.saved);
  }

  /**
   * 展开/收起：工作项拖拽位置绝对保留；丢掉旧的 fold pin，
   * 只给新节点（含 +N）相对父卡当前坐标补位。
   */
  resolveExpandCollapse(data: DependencyGraph): Map<string, GraphNodePosition> {
    for (const id of [...this.pins.keys()]) {
      if (isFoldSummaryId(id)) {
        this.pins.delete(id);
      }
    }
    return resolvePinnedExpandCollapse(data, arrangeGraph(data), this.pins);
  }

  /**
   * 写入 pin。keepHidden 时不丢已收起节点坐标，避免再展开回到初始位。
   */
  seed(positions: ReadonlyMap<string, GraphNodePosition>, keepHidden = false): void {
    if (!keepHidden) {
      this.pins.clear();
    }
    for (const [id, pos] of positions) {
      this.pins.set(id, pos);
    }
  }

  /**
   * fitView 落位时把相对 (0,0) 的思维导图整体挪到画布中心。
   */
  centerForViewport(
    positions: ReadonlyMap<string, GraphNodePosition>,
    width: number,
    height: number,
  ): Map<string, GraphNodePosition> {
    if (width <= 0 || height <= 0) {
      return new Map(positions);
    }
    const dx = width / 2;
    const dy = height / 2;
    return new Map(
      [...positions].map(([id, pos]) => [id, { ...pos, x: pos.x + dx, y: pos.y + dy }]),
    );
  }

  private syncSaved(data: DependencyGraph): void {
    this.saved.clear();
    for (const [id, pos] of cardPositionsFromNodes(data.nodes)) {
      this.saved.set(id, pos);
    }
  }
}
