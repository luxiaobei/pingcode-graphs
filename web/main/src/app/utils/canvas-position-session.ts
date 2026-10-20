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
  sideMatchesPreference,
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

/** 画布位置会话：会话 pin、已保存坐标、换根/展开收起时的坐标策略。 */
export class CanvasPositionSession {
  /** 当前会话拖拽 / 布局输出（含折叠占位） */
  readonly pins = new Map<string, GraphNodePosition>();
  /** 服务端下发 / 已保存；一键整理优先还原 */
  private readonly saved = new Map<string, GraphNodePosition>();
  /** 上一帧可见图：收起时用展开子卡坐标给 +N 占位 */
  private lastGraph: DependencyGraph | null = null;
  private lastDepth: number | null = null;
  private lastRootId: string | null = null;
  /** 用户级关系方位偏好（跨工作项共用）；仅折叠占位松手写入 */
  private relationSides = new Map<string, Side>();

  clear(): void {
    this.pins.clear();
    this.saved.clear();
    this.relationSides.clear();
    this.lastGraph = null;
    this.lastDepth = null;
    this.lastRootId = null;
  }

  /**
   * 写入当前可见节点坐标。
   * - 折叠占位：改该关系 pin.side；松手时写入 relationSides
   * - 普通卡（含父/子工作项）：只更新该卡 pin.side，不写关系偏好、不整组重锚
   * @param persistRelationPreference 拖拽中传 false，避免边拖边写偏好；松手传 true
   */
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

  /**
   * 用个人视图完整 positions 覆盖 saved（含当前不可见的 fold / 收起子卡）。
   * 仅 sync 可见节点会丢掉 fold 坐标，导致根用绝对坐标、fold 用相对 arrange 而跑到左侧。
   */
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

  /** 导出可持久化的坐标表（含折叠占位，与普通卡同一套 pin）。 */
  toSaveRecord(): Record<string, { x: number; y: number; side?: Side }> {
    return Object.fromEntries(
      [...this.pins].map(([id, { x, y, side }]) => [id, side ? { x, y, side } : { x, y }]),
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
    // 只同步坐标，不重算 side、不写 relationSides（收起/展开不能污染偏好）
    this.snapshot(g6);
    return this.pins.size ? this.pins : null;
  }

  /**
   * 可见集合未变且均有 pin 时可只 redraw。
   * 展开后子卡仍留着收起前的 pin，必须对比上一帧可见集合，否则会跳过重排。
   */
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

  /** 基准布局：先按方位；与个人保存方位相同才套坐标，否则用 arrange 初始落位。 */
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

  /**
   * 展开/收起通用规则：
   * 1) 先按关系方位偏好 arrange；
   * 2) pin/saved 与明确方位相同 → 用存储坐标；
   * 3) 方位与留存不同 → 按最新方位初始展示，并清掉旧侧 pin / 更新 saved。
   * 折叠占位拖到新侧时，额外把子树贴到占位锚点。
   */
  resolveExpandCollapse(data: DependencyGraph): Map<string, GraphNodePosition> {
    // 先取出 fold pin（含即将展开消失的），供写偏好 + 清旧侧子树；勿删 pin
    const foldPins = new Map(
      [...this.pins].filter(([id]) => isFoldSummaryId(id)),
    );
    syncRelationSidesFromFolds(this.lastGraph, foldPins, this.relationSides);
    const reanchored = clearStalePinsAfterFoldDrag(data, this.lastGraph, foldPins, this.pins);
    const reanchoredIds = new Set(reanchored.flatMap((cluster) => [...cluster.ids]));
    const arranged = arrangeGraph(data, this.relationSides);
    const preferred = preferredSideByNode(data, this.relationSides);
    // 明确方位与留存不同的 pin 丢掉，避免再次盖回旧侧
    for (const [id, pin] of [...this.pins]) {
      if (!sideMatchesPreference(pin.side, preferred.get(id))) {
        this.pins.delete(id);
      }
    }
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
    // pin > saved：会话拖过的卡跳过 merge；方位不一致的 saved 已过滤
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
    // 方位已切换：用新落位覆盖 saved，避免下次再被旧侧坐标拉回
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

  /** 把当前可见节点坐标合并进 saved，不清空（保留不可见 fold / 子卡的个人视图坐标）。 */
  private syncSaved(data: DependencyGraph): void {
    for (const [id, pos] of cardPositionsFromNodes(data.nodes)) {
      this.saved.set(id, pos);
    }
  }

  /**
   * 按相对锚点位置更新被拖卡 side。
   * persistRelationPreference：松手时写折叠偏好；拖拽中只改当前卡 side 供预览出线。
   */
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
