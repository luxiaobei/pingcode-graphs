import type { Graph } from '@antv/g6';
import { FOLD_SUMMARY_SIZE, GRAPH_NODE_SIZE } from '../constants/graph.constants';
import type { DependencyGraph } from '../entities/graph.entity';
import {
  arrangeGraph,
  mergeLayoutPositions,
  resolvePinnedExpandCollapse,
  settleReanchoredSubtree,
  sideFromDelta,
  sideFromParent,
  type Side,
} from './arrange-graph';
import { snapshotGraphPositions } from './g6-helpers';
import { isFoldSummaryId, isFoldSummaryNode, relationBetween } from './graph.util';
import { cardPositionsFromNodes } from './saved-graph-layout';
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
  /** 用户级关系方位偏好（跨工作项共用）；仅折叠占位拖拽写入 */
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
   * - 折叠占位：改该关系 pin.side，并写入 relationSides（个人偏好）
   * - 普通工作项：只更新该卡 pin.side 供出线跟着指，不写 relationSides
   * - 根卡：只记坐标
   */
  snapshot(g6: Graph, graph?: DependencyGraph | null, draggedId?: string | null): void {
    snapshotGraphPositions(g6, this.pins);
    if (draggedId && graph) {
      this.applyDragSide(graph, draggedId);
    }
  }

  setRelationSides(sides: ReadonlyMap<string, Side> | Record<string, Side> | null | undefined): void {
    this.relationSides.clear();
    if (!sides) {
      return;
    }
    const entries = sides instanceof Map ? sides.entries() : Object.entries(sides);
    for (const [type, side] of entries) {
      if (side === 'left' || side === 'right' || side === 'top' || side === 'bottom') {
        this.relationSides.set(type, side);
      }
    }
  }

  getRelationSides(): Record<string, Side> {
    return Object.fromEntries(this.relationSides);
  }

  /** 导出可持久化的坐标表（折叠占位不落库；带 side）。 */
  toSaveRecord(): Record<string, { x: number; y: number; side?: Side }> {
    return Object.fromEntries(
      [...this.pins]
        .filter(([id]) => !isFoldSummaryId(id))
        .map(([id, { x, y, side }]) => [id, side ? { x, y, side } : { x, y }]),
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
   * 展开/收起：工作项与已拖动的 +N 保位；
   * 折叠占位若拖到新方位，丢掉旧侧子卡 pin，按新侧 arrange 重锚整棵子树。
   */
  resolveExpandCollapse(data: DependencyGraph): Map<string, GraphNodePosition> {
    const foldPins = new Map(
      [...this.pins].filter(([id]) => isFoldSummaryId(id)),
    );
    // 仅把「已拖过的折叠占位」side 写入偏好，供 arrange / 展开落位
    syncRelationSidesFromFolds(this.lastGraph, foldPins, this.relationSides);
    const reanchored = clearStalePinsAfterFoldDrag(data, this.lastGraph, foldPins, this.pins);
    const arranged = arrangeGraph(data, this.relationSides);
    const layout = resolvePinnedExpandCollapse(data, arranged, this.pins);
    for (const cluster of reanchored) {
      settleReanchoredSubtree(data, layout, cluster.ids, cluster.side, cluster.anchor);
    }
    placeFoldsAtExpandedSlots(data, this.lastGraph, this.pins, layout, foldPins);
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
   * 拖拽松手后按相对父卡位置更新 side。
   * 折叠占位额外写入 relationSides；普通卡只改自身 pin，避免顶侧误判污染偏好。
   */
  private applyDragSide(graph: DependencyGraph, draggedId: string): void {
    const node = graph.nodes.find((item) => item.id === draggedId);
    if (!node || node.relationHub || !node.revealedByAnchorId) {
      return;
    }
    // 根卡无父，只动坐标
    if (node.id === graph.rootId) {
      return;
    }
    const pin = this.pins.get(draggedId);
    const parent = this.pins.get(node.revealedByAnchorId);
    if (!pin || !parent) {
      return;
    }
    const fold = isFoldSummaryNode(node);
    const half = fold
      ? { w: FOLD_SUMMARY_SIZE.width / 2, h: FOLD_SUMMARY_SIZE.height / 2 }
      : { w: GRAPH_NODE_SIZE.width / 2, h: GRAPH_NODE_SIZE.height / 2 };
    const side = sideFromParent(parent, pin, half);
    this.pins.set(draggedId, { ...pin, side });
    if (fold && node.foldSummary) {
      this.relationSides.set(node.foldSummary.relationType, side);
    }
  }
}

/**
 * 收起时把 +N 放到该关系展开子卡的原坐标中心；若用户已拖过该占位则保留。
 */
function placeFoldsAtExpandedSlots(
  data: DependencyGraph,
  prev: DependencyGraph | null,
  pins: ReadonlyMap<string, GraphNodePosition>,
  layout: Map<string, GraphNodePosition>,
  foldPins: ReadonlyMap<string, GraphNodePosition>,
): void {
  for (const node of data.nodes) {
    if (!isFoldSummaryNode(node)) {
      continue;
    }
    const kept = foldPins.get(node.id);
    if (kept && Number.isFinite(kept.x) && Number.isFinite(kept.y)) {
      const base = layout.get(node.id);
      layout.set(node.id, {
        ...(base ?? kept),
        x: kept.x,
        y: kept.y,
        side: kept.side ?? base?.side,
      });
      continue;
    }
    if (!prev) {
      continue;
    }
    const fold = node.foldSummary;
    const parentId = node.revealedByAnchorId;
    if (!fold || !parentId) {
      continue;
    }
    const prevNodes = new Map(prev.nodes.map((item) => [item.id, item]));
    const kids = prev.nodes.filter((child) => {
      if (child.relationHub || isFoldSummaryNode(child) || child.revealedByAnchorId !== parentId) {
        return false;
      }
      return relationBetween(prev.edges, prevNodes, parentId, child.id) === fold.relationType;
    });
    const points = kids
      .map((child) => pins.get(child.id))
      .filter((pos): pos is GraphNodePosition => Boolean(pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)));
    if (!points.length) {
      continue;
    }
    const x = points.reduce((sum, pos) => sum + pos.x, 0) / points.length;
    const y = points.reduce((sum, pos) => sum + pos.y, 0) / points.length;
    const base = layout.get(node.id);
    const side = points.find((pos) => pos.side)?.side ?? base?.side;
    layout.set(node.id, { ...(base ?? { x, y }), x, y, side });
  }
}

/** 收起占位上的 side 写入关系偏好，供 arrange 排到对应侧、展开后跟最新方位。 */
function syncRelationSidesFromFolds(
  prev: DependencyGraph | null,
  foldPins: ReadonlyMap<string, GraphNodePosition>,
  relationSides: Map<string, Side>,
): void {
  if (!prev) {
    return;
  }
  for (const node of prev.nodes) {
    if (!isFoldSummaryNode(node) || !node.foldSummary) {
      continue;
    }
    const pin = foldPins.get(node.id);
    if (pin?.side) {
      relationSides.set(node.foldSummary.relationType, pin.side);
    }
  }
}

interface ReanchorCluster {
  ids: Set<string>;
  side: Side;
  anchor: { x: number; y: number };
}

/**
 * 折叠占位拖到新方位后展开：清掉仍停在旧侧的子树 pin，强制按新侧重排。
 */
function clearStalePinsAfterFoldDrag(
  data: DependencyGraph,
  prev: DependencyGraph | null,
  foldPins: ReadonlyMap<string, GraphNodePosition>,
  pins: Map<string, GraphNodePosition>,
): ReanchorCluster[] {
  if (!prev) {
    return [];
  }
  const dataNodes = new Map(data.nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string, string[]>();
  for (const node of data.nodes) {
    if (node.relationHub || !node.revealedByAnchorId) {
      continue;
    }
    const list = childrenOf.get(node.revealedByAnchorId) ?? [];
    list.push(node.id);
    childrenOf.set(node.revealedByAnchorId, list);
  }

  const clusters: ReanchorCluster[] = [];
  for (const node of prev.nodes) {
    if (!isFoldSummaryNode(node) || !node.foldSummary || !node.revealedByAnchorId) {
      continue;
    }
    if (dataNodes.has(node.id)) {
      continue;
    }
    const foldPin = foldPins.get(node.id);
    if (!foldPin?.side) {
      continue;
    }
    const parentId = node.revealedByAnchorId;
    const parentPin = pins.get(parentId);
    if (!parentPin) {
      continue;
    }
    const relationType = node.foldSummary.relationType;
    const clusterIds = new Set<string>();
    for (const child of data.nodes) {
      if (child.relationHub || isFoldSummaryNode(child) || child.revealedByAnchorId !== parentId) {
        continue;
      }
      if (relationBetween(data.edges, dataNodes, parentId, child.id) !== relationType) {
        continue;
      }
      const childPin = pins.get(child.id);
      if (childPin) {
        const geoSide = sideFromDelta(childPin.x - parentPin.x, childPin.y - parentPin.y);
        if (geoSide === foldPin.side) {
          pins.set(child.id, { ...childPin, side: foldPin.side });
          continue;
        }
      }
      const queue = [child.id];
      while (queue.length) {
        const id = queue.shift()!;
        pins.delete(id);
        clusterIds.add(id);
        queue.push(...(childrenOf.get(id) ?? []));
      }
    }
    if (clusterIds.size) {
      clusters.push({
        ids: clusterIds,
        side: foldPin.side,
        anchor: { x: foldPin.x, y: foldPin.y },
      });
    }
  }
  return clusters;
}
