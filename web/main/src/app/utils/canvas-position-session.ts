import type { Graph } from '@antv/g6';
import { FOLD_SUMMARY_SIZE, GRAPH_NODE_SIZE } from '../constants/graph.constants';
import type { DependencyGraph } from '../entities/graph.entity';
import {
  arrangeGraph,
  mergeLayoutPositions,
  preferredSideByNode,
  resolvePinnedExpandCollapse,
  retainPositionsForPreferredSide,
  settleReanchoredSubtree,
  sideFromParent,
  type Side,
} from './arrange-graph';
import {
  clearStalePinsAfterFoldDrag,
  placeFoldsAtExpandedSlots,
  syncRelationSidesFromFolds,
} from './fold-layout';
import { snapshotGraphPositions } from './g6-helpers';
import { isFoldSummaryId, isFoldSummaryNode } from './graph.util';
import { cardPositionsFromNodes } from './saved-graph-layout';
import { assignRelationSides } from './side';
import type { GraphNodePosition } from './to-g6-data';

/** 画布位置会话：pin / saved / 换根与展开收起策略。 */
export class CanvasPositionSession {
  /** 当前会话坐标（含折叠占位） */
  readonly pins = new Map<string, GraphNodePosition>();
  /** 个人视图已保存坐标 */
  private readonly saved = new Map<string, GraphNodePosition>();
  /** 上一帧可见图（收起时对齐 +N） */
  private lastGraph: DependencyGraph | null = null;
  private lastDepth: number | null = null;
  private lastRootId: string | null = null;
  /** 关系方位偏好（跨工作项；折叠松手写入） */
  private relationSides = new Map<string, Side>();

  clear(): void {
    this.pins.clear();
    this.saved.clear();
    // relationSides 跨工作项，不清空
    this.lastGraph = null;
    this.lastDepth = null;
    this.lastRootId = null;
  }

  /** 写入可见节点坐标；松手时可写折叠关系偏好。 */
  snapshot(
    g6: Graph,
    graph?: DependencyGraph | null,
    draggedId?: string | null,
    persistRelationPreference = true,
  ): void {
    snapshotGraphPositions(g6, this.pins);
    if (draggedId && graph) {
      this.applyDragSide(graph, draggedId, persistRelationPreference);
    }
  }

  setRelationSides(sides: ReadonlyMap<string, Side> | Record<string, Side> | null | undefined): void {
    assignRelationSides(this.relationSides, sides);
  }

  getRelationSides(): Record<string, Side> {
    return Object.fromEntries(this.relationSides);
  }

  /** 用个人视图完整 positions 覆盖 saved（含不可见 fold）。 */
  replaceSaved(
    positions: ReadonlyMap<string, GraphNodePosition> | Record<string, GraphNodePosition> | null | undefined,
  ): void {
    this.saved.clear();
    if (!positions) {
      return;
    }
    const entries = positions instanceof Map ? positions.entries() : Object.entries(positions);
    for (const [id, pos] of entries) {
      if (!id || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
        continue;
      }
      this.saved.set(id, pos.side ? { x: pos.x, y: pos.y, side: pos.side } : { x: pos.x, y: pos.y });
    }
  }

  /** 是否已有个人视图坐标（应用时勿再 centerForViewport，避免绝对坐标被二次平移）。 */
  hasSavedPositions(): boolean {
    return this.saved.size > 0;
  }

  /** 导出可持久化坐标（含折叠占位）。 */
  toSaveRecord(): Record<string, { x: number; y: number; side?: Side }> {
    return Object.fromEntries(
      [...this.pins].map(([id, { x, y, side }]) => [id, side ? { x, y, side } : { x, y }]),
    );
  }

  /** 同根同深度可复用 pin；否则清空并返回 null（走基准布局）。 */
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
      // relationSides 跨工作项共用，换根不清空
      this.lastGraph = null;
      this.lastDepth = data.depth;
      this.lastRootId = data.rootId;
      this.syncSaved(data);
      return null;
    }

    if (!g6) {
      return null;
    }
    // 只同步坐标，不写偏好
    this.snapshot(g6);
    return this.pins.size ? this.pins : null;
  }

  /** 可见集合未变且均有 pin 时可只 redraw。 */
  sameVisibleNodes(data: DependencyGraph): boolean {
    const ids = data.nodes.filter((node) => !node.relationHub).map((node) => node.id);
    if (!ids.length || !ids.every((id) => this.pins.has(id))) {
      return false;
    }
    if (!this.lastGraph) {
      return false;
    }
    const prevIds = this.lastGraph.nodes
      .filter((node) => !node.relationHub)
      .map((node) => node.id);
    if (prevIds.length !== ids.length) {
      return false;
    }
    const prevSet = new Set(prevIds);
    return ids.every((id) => prevSet.has(id));
  }

  /** 记录当前可见图，供下次收起时对齐 +N 占位。 */
  rememberGraph(data: DependencyGraph): void {
    this.lastGraph = data;
  }

  /** 基准布局：arrange + 与偏好一致的 saved。 */
  resolveBaseline(data: DependencyGraph): Map<string, GraphNodePosition> {
    this.syncSaved(data);
    const arranged = arrangeGraph(data, this.relationSides);
    const preferred = preferredSideByNode(data, this.relationSides);
    const layout = mergeLayoutPositions(
      arranged,
      retainPositionsForPreferredSide(this.saved, preferred),
    );
    this.lastGraph = data;
    return layout;
  }

  /** 展开/收起：arrange → pin/saved 保位 → 折叠换侧重锚。 */
  resolveExpandCollapse(data: DependencyGraph): Map<string, GraphNodePosition> {
    const foldPins = new Map(
      [...this.pins].filter(([id]) => isFoldSummaryId(id)),
    );
    syncRelationSidesFromFolds(this.lastGraph, foldPins, this.relationSides);
    const reanchored = clearStalePinsAfterFoldDrag(data, this.lastGraph, foldPins, this.pins);
    const reanchoredIds = new Set(reanchored.flatMap((cluster) => [...cluster.ids]));
    const arranged = arrangeGraph(data, this.relationSides);
    const preferred = preferredSideByNode(data, this.relationSides);
    // 普通卡 pin 保留（勿因 relationSides 默认值清掉）
    let layout = resolvePinnedExpandCollapse(data, arranged, this.pins, preferred);
    for (const cluster of reanchored) {
      settleReanchoredSubtree(data, layout, cluster.ids, cluster.side, cluster.anchor);
      for (const id of cluster.ids) {
        const pos = layout.get(id);
        if (pos) {
          layout.set(id, { ...pos, side: cluster.side });
        }
      }
    }
    placeFoldsAtExpandedSlots(
      data,
      this.lastGraph,
      this.pins,
      layout,
      foldPins,
      this.relationSides,
    );
    const skipIds = new Set<string>([...this.pins.keys(), ...reanchoredIds]);
    layout = mergeLayoutPositions(
      layout,
      retainPositionsForPreferredSide(this.saved, preferred),
      skipIds,
    );
    for (const id of reanchoredIds) {
      const pos = layout.get(id);
      if (!pos) {
        continue;
      }
      this.saved.set(id, pos.side ? { x: pos.x, y: pos.y, side: pos.side } : { x: pos.x, y: pos.y });
    }
    // 方位已切：用新落位覆盖 saved
    for (const [id, pos] of layout) {
      const saved = this.saved.get(id);
      const want = preferred.get(id) ?? pos.side;
      if (saved?.side && want && saved.side !== want) {
        this.saved.set(id, { x: pos.x, y: pos.y, side: want });
      }
    }
    this.lastGraph = data;
    return layout;
  }

  /** 写入 pin；keepHidden 时保留已收起节点坐标。 */
  seed(positions: ReadonlyMap<string, GraphNodePosition>, keepHidden = false): void {
    if (!keepHidden) {
      this.pins.clear();
    }
    for (const [id, pos] of positions) {
      this.pins.set(id, pos);
    }
  }

  /** 相对 (0,0) 的布局平移到画布中心。 */
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

  /** 可见节点坐标合并进 saved（保留不可见项）。 */
  private syncSaved(data: DependencyGraph): void {
    for (const [id, pos] of cardPositionsFromNodes(data.nodes)) {
      this.saved.set(id, pos);
    }
  }

  /** 按相对锚点更新被拖卡 side；松手时可写折叠偏好。 */
  private applyDragSide(
    graph: DependencyGraph,
    draggedId: string,
    persistRelationPreference: boolean,
  ): void {
    const node = graph.nodes.find((item) => item.id === draggedId);
    if (!node || node.relationHub || !node.revealedByAnchorId) {
      return;
    }
    // 根卡无父，只动坐标
    if (node.id === graph.rootId) {
      return;
    }
    const pin = this.pins.get(draggedId);
    const anchorId = node.revealedByAnchorId;
    const anchor = this.pins.get(anchorId);
    if (!pin || !anchor) {
      return;
    }
    const fold = isFoldSummaryNode(node);
    const half = fold
      ? { w: FOLD_SUMMARY_SIZE.width / 2, h: FOLD_SUMMARY_SIZE.height / 2 }
      : { w: GRAPH_NODE_SIZE.width / 2, h: GRAPH_NODE_SIZE.height / 2 };
    const side = sideFromParent(anchor, pin, half);
    this.pins.set(draggedId, { ...pin, side });

    if (!persistRelationPreference) {
      return;
    }

    if (fold && node.foldSummary) {
      this.relationSides.set(node.foldSummary.relationType, side);
    }
  }
}
