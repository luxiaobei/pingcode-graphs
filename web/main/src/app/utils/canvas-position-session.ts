import type { Graph } from '@antv/g6';
import { FOLD_SUMMARY_SIZE, GRAPH_NODE_SIZE } from '../constants/graph.constants';
import type { DependencyGraph } from '../entities/graph.entity';
import {
  arrangeGraph,
  mergeLayoutPositions,
  resolvePinnedExpandCollapse,
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
import { isFoldSummaryId, isFoldSummaryNode, siblingsOfRelation } from './graph.util';
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
  /** 用户级关系方位偏好（跨工作项共用）；折叠占位或拖父工作项写入 */
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
   * - 折叠占位：改该关系 pin.side，并写入 relationSides
   * - 父工作项：persistRelationPreference 时写 parent 偏好（松手后整组重锚）
   * - 其它普通卡：只更新该卡 pin.side
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

  /**
   * 拖父工作项换方位后：清旧侧兄弟 pin，按新侧 arrange，整组贴到拖放位置。
   * 只改 side、不挪卡时出线仍像「从上出发」。
   */
  reanchorParentAfterDrag(
    graph: DependencyGraph,
    draggedId: string,
  ): Map<string, GraphNodePosition> | null {
    const node = graph.nodes.find((item) => item.id === draggedId);
    if (!node || node.relationHub || !node.revealedByAnchorId) {
      return null;
    }
    const anchorId = node.revealedByAnchorId;
    const parentNodes = siblingsOfRelation(graph, anchorId, 'parent');
    if (!parentNodes.some((item) => item.id === draggedId)) {
      return null;
    }

    const dragPin = this.pins.get(draggedId);
    if (!dragPin?.side) {
      return null;
    }
    const side = dragPin.side;
    const prevPreferred = this.relationSides.get('parent');
    this.relationSides.set('parent', side);

    const parentIds = parentNodes.map((item) => item.id);

    // 偏好与兄弟 side 已是新方位 → 不必整组重排
    if (
      prevPreferred === side &&
      parentIds.every((id) => id === draggedId || this.pins.get(id)?.side === side)
    ) {
      return null;
    }

    for (const id of parentIds) {
      if (id === draggedId) {
        this.pins.set(id, { ...dragPin, side });
      } else {
        this.pins.delete(id);
      }
    }

    const arranged = arrangeGraph(graph, this.relationSides);
    const layout = resolvePinnedExpandCollapse(graph, arranged, this.pins);
    const placed = layout.get(draggedId);
    if (placed) {
      const dx = dragPin.x - placed.x;
      const dy = dragPin.y - placed.y;
      if (dx || dy) {
        for (const id of parentIds) {
          const pos = layout.get(id);
          if (pos) {
            layout.set(id, { ...pos, x: pos.x + dx, y: pos.y + dy, side });
          }
        }
      }
    }
    for (const id of parentIds) {
      const pos = layout.get(id);
      if (pos) {
        layout.set(id, { ...pos, side });
      }
    }
    settleReanchoredSubtree(graph, layout, new Set(parentIds), side);
    this.seed(layout, true);
    this.lastGraph = graph;
    return layout;
  }

  setRelationSides(sides: ReadonlyMap<string, Side> | Record<string, Side> | null | undefined): void {
    assignRelationSides(this.relationSides, sides);
  }

  getRelationSides(): Record<string, Side> {
    return Object.fromEntries(this.relationSides);
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

  /** 基准布局：saved / 关系方位偏好优先，缺的用思维导图补齐。 */
  resolveBaseline(data: DependencyGraph): Map<string, GraphNodePosition> {
    this.syncSaved(data);
    const layout = mergeLayoutPositions(
      arrangeGraph(data, this.relationSides),
      this.saved,
    );
    this.lastGraph = data;
    return layout;
  }

  /**
   * 展开/收起：工作项与 +N 均靠 pin 保位（展开时 fold 从可见图消失也不删 pin）；
   * 折叠占位若拖到新方位，丢掉旧侧子卡 pin，按新侧 arrange 重锚整棵子树。
   */
  resolveExpandCollapse(data: DependencyGraph): Map<string, GraphNodePosition> {
    // 先取出 fold pin（含即将展开消失的），供写偏好 + 清旧侧子树；勿删 pin
    const foldPins = new Map(
      [...this.pins].filter(([id]) => isFoldSummaryId(id)),
    );
    syncRelationSidesFromFolds(this.lastGraph, foldPins, this.relationSides);
    const reanchored = clearStalePinsAfterFoldDrag(data, this.lastGraph, foldPins, this.pins);
    const arranged = arrangeGraph(data, this.relationSides);
    const layout = resolvePinnedExpandCollapse(data, arranged, this.pins);
    for (const cluster of reanchored) {
      settleReanchoredSubtree(data, layout, cluster.ids, cluster.side, cluster.anchor);
    }
    placeFoldsAtExpandedSlots(
      data,
      this.lastGraph,
      this.pins,
      layout,
      foldPins,
      this.relationSides,
    );
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

  private syncSaved(data: DependencyGraph): void {
    this.saved.clear();
    for (const [id, pos] of cardPositionsFromNodes(data.nodes)) {
      this.saved.set(id, pos);
    }
  }

  /**
   * 按相对锚点位置更新被拖卡 side。
   * persistRelationPreference：松手时写折叠偏好；拖拽中只改当前卡 side 供预览出线。
   * 父卡偏好由 reanchorParentAfterDrag 写入，避免此处先写导致跳过整组重锚。
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
