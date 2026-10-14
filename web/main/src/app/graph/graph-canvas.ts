import {
  ApplicationRef,
  Component,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Graph, GraphEvent, NodeEvent, type IElementEvent } from '@antv/g6';
import { ThyAction } from 'ngx-tethys/action';
import {
  ThyDropdownDirective,
  ThyDropdownMenuComponent,
  ThyDropdownMenuItemDirective,
  ThyDropdownMenuItemNameDirective,
} from 'ngx-tethys/dropdown';
import { ThyTooltipDirective } from 'ngx-tethys/tooltip';
import {
  GRAPH_FIT_SETTLE_MS,
  GRAPH_OPTIONS,
  GRAPH_ZOOM_RANGE,
  GRAPH_ZOOM_STEP,
} from '../constants/graph.constants';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import { arrangeGraph } from '../utils/arrange-graph';
import {
  buildElementStates,
  foldKeyFromEvent,
  graphHostSize,
  nodeItemFromEvent,
  sharpenHtmlCamera,
  snapshotGraphPositions,
} from '../utils/g6-helpers';
import { openPivot } from '../utils/graph.util';
import { toG6Data, type GraphNodePosition } from '../utils/to-g6-data';
import { bindWorkItemCardRuntime } from './work-item-card';

@Component({
  selector: 'app-graph-canvas',
  imports: [
    ThyAction,
    ThyTooltipDirective,
    ThyDropdownDirective,
    ThyDropdownMenuComponent,
    ThyDropdownMenuItemDirective,
    ThyDropdownMenuItemNameDirective,
  ],
  templateUrl: './graph-canvas.html',
  styleUrl: './graph-canvas.scss',
})
export class GraphCanvas {
  readonly graph = input<DependencyGraph | null>(null);

  readonly toggleExpand = output<string>();

  readonly retrace = output<string>();

  /** 保存个人布局：当前可见卡片坐标 */
  readonly saveLayout = output<Record<string, { x: number; y: number }>>();

  protected readonly zoomPercent = signal(100);

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('g6Host');
  private readonly traceOrigin = viewChild.required<ElementRef<HTMLElement>>('traceOrigin');
  private readonly traceDropdown = viewChild.required(ThyDropdownDirective);
  private readonly destroyRef = inject(DestroyRef);

  private g6: Graph | null = null;
  private readonly ready = signal(false);
  private resizeObserver: ResizeObserver | null = null;
  private htmlCameraObserver: MutationObserver | null = null;
  private fitTimer: number | null = null;
  private renderSeq = 0;
  private lastDepth: number | null = null;
  private lastRootId: string | null = null;
  /** 当前会话拖拽后的坐标 */
  private readonly pinnedPositions = new Map<string, GraphNodePosition>();
  /** 服务端下发 / 已保存的布局；一键整理优先还原 */
  private readonly savedPositions = new Map<string, GraphNodePosition>();
  private readonly traceStop = new AbortController();
  private traceTargetId: string | null = null;
  private traceMenuTimer = 0;

  private readonly zoomMinPercent = Math.round(GRAPH_ZOOM_RANGE[0] * 100);
  private readonly zoomMaxPercent = Math.round(GRAPH_ZOOM_RANGE[1] * 100);

  constructor() {
    bindWorkItemCardRuntime(inject(EnvironmentInjector), inject(ApplicationRef));
    afterNextRender(() => this.initGraph());
    this.destroyRef.onDestroy(() => this.destroyGraph());

    effect(() => {
      if (this.ready()) {
        void this.render(this.graph());
      }
    });
  }

  protected canZoomIn(): boolean {
    return this.zoomPercent() < this.zoomMaxPercent;
  }

  protected canZoomOut(): boolean {
    return this.zoomPercent() > this.zoomMinPercent;
  }

  protected zoomIn(): void {
    if (this.g6 && this.canZoomIn()) {
      void this.g6.zoomBy(GRAPH_ZOOM_STEP).then(() => this.syncZoomPercent());
    }
  }

  protected zoomOut(): void {
    if (this.g6 && this.canZoomOut()) {
      void this.g6.zoomBy(1 / GRAPH_ZOOM_STEP).then(() => this.syncZoomPercent());
    }
  }

  /** 定位到当前工作项（图根节点）并居中显示。 */
  protected locate(): void {
    const data = this.graph();
    const graph = this.liveGraph();
    const rootId = data?.rootId;
    if (!graph || !rootId || !data?.nodes.some((node) => node.id === rootId)) {
      return;
    }
    void graph
      .focusElement(rootId, { duration: 300 })
      .then(() => this.syncZoomPercent())
      .catch(() => undefined);
  }

  /** 快照当前卡片坐标，交给上层写入服务端。 */
  protected save(): void {
    const graph = this.liveGraph();
    if (!graph) {
      return;
    }
    snapshotGraphPositions(graph, this.pinnedPositions);
    this.saveLayout.emit(
      Object.fromEntries([...this.pinnedPositions].map(([id, { x, y }]) => [id, { x, y }])),
    );
  }

  /**
   * 一键整理：优先还原服务端位置；没有服务端数据时用思维导图初始化位置。
   */
  protected organize(): void {
    const data = untracked(() => this.graph());
    if (!data?.nodes.length || !this.liveGraph()) {
      return;
    }
    void this.layoutBaseline(data, { fitView: true }).catch(() => undefined);
  }

  protected fit(): void {
    const graph = this.liveGraph();
    if (!graph) {
      return;
    }
    void graph
      .fitView({ when: 'always', direction: 'both' })
      .then(() => this.syncZoomPercent())
      .catch(() => undefined);
  }

  private initGraph(): void {
    const container = this.host().nativeElement;
    this.g6 = new Graph({ container, ...graphHostSize(container), ...GRAPH_OPTIONS });
    this.bindTraceMenu(container);
    this.bindGraphEvents();
    this.bindHtmlCamera(container);
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.g6) {
        return;
      }
      const { width, height } = graphHostSize(container);
      this.g6.resize(width, height);
    });
    this.resizeObserver.observe(container);
    this.ready.set(true);
  }

  private destroyGraph(): void {
    this.clearFitTimer();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.htmlCameraObserver?.disconnect();
    this.htmlCameraObserver = null;
    this.pinnedPositions.clear();
    this.savedPositions.clear();
    this.lastDepth = null;
    this.lastRootId = null;
    window.clearTimeout(this.traceMenuTimer);
    this.traceStop.abort();
    this.g6?.off();
    this.g6?.destroy();
    this.g6 = null;
    this.ready.set(false);
  }

  private applyGraphData(
    data: DependencyGraph,
    positions?: ReadonlyMap<string, GraphNodePosition>,
  ): void {
    if (!this.g6) {
      return;
    }
    this.g6.setData(toG6Data(data, positions ?? this.pinnedPositions));
  }

  private bindGraphEvents(): void {
    if (!this.g6) {
      return;
    }

    this.g6.on(NodeEvent.CLICK, (event: IElementEvent) => {
      if (!this.g6) {
        return;
      }
      const item = nodeItemFromEvent(this.g6, event);
      if (!item || item.relationHub) {
        return;
      }
      const foldKey = foldKeyFromEvent(event);
      if (foldKey) {
        this.toggleExpand.emit(foldKey);
        return;
      }
      openPivot(item);
    });

    this.g6.on(GraphEvent.AFTER_TRANSFORM, () => {
      this.syncZoomPercent();
      this.syncTraceMenuScale();
    });
    this.g6.on(NodeEvent.DRAG_START, () => this.g6?.stopLayout());
    this.g6.on(NodeEvent.DRAG_END, () => {
      if (!this.g6) {
        return;
      }
      snapshotGraphPositions(this.g6, this.pinnedPositions);
      const data = untracked(() => this.graph());
      if (data) {
        this.applyGraphData(data);
        void this.g6.draw();
      }
    });
  }

  /** 右键卡片不拖动；非当前工作项弹出「以此工作项追溯」。 */
  private bindTraceMenu(container: HTMLElement): void {
    const signal = this.traceStop.signal;
    container.addEventListener('pointerdown', this.keepRightClick, { capture: true, signal });
    container.addEventListener('contextmenu', this.onTraceMenu, { signal });
  }

  private readonly keepRightClick = (event: PointerEvent): void => {
    if (event.button === 2 && cardOf(event)) {
      event.stopPropagation();
    }
  };

  private readonly onTraceMenu = (event: MouseEvent): void => {
    const card = cardOf(event);
    if (!card) {
      return;
    }
    event.preventDefault();
    const id = this.traceCandidate(card.dataset['nodeId']);
    if (id) {
      this.openTraceMenu(id, event.clientX, event.clientY);
    }
  };

  /** 当前中心、分叉点和非工作项不能换根。 */
  private traceCandidate(id: string | undefined): string | null {
    const data = untracked(() => this.graph());
    const item = data?.nodes.find((node) => node.id === id);
    if (!item || item.relationHub || item.id === data?.rootId || !isWorkItem(item)) {
      return null;
    }
    return item.id;
  }

  /** hide 是异步的，下一拍再打开，避免还挂着上一次菜单。 */
  private openTraceMenu(id: string, x: number, y: number): void {
    this.traceTargetId = id;
    this.syncTraceMenuScale();
    const origin = this.traceOrigin().nativeElement;
    origin.style.left = `${x}px`;
    origin.style.top = `${y}px`;
    this.traceDropdown().hide(0);
    window.clearTimeout(this.traceMenuTimer);
    this.traceMenuTimer = window.setTimeout(() => this.traceDropdown().show(0));
  }

  /** 菜单跟着画面缩放，最小停在还能点中的尺寸。 */
  private syncTraceMenuScale(): void {
    const zoom = Math.min(1, Math.max(0.6, this.graphZoom() ?? 1));
    document.documentElement.style.setProperty('--trace-menu-scale', String(zoom));
  }

  protected confirmTrace(): void {
    const id = this.traceTargetId;
    this.traceTargetId = null;
    if (id) {
      this.retrace.emit(id);
    }
  }

  /** 同一根节点、同一深度时取出现有坐标，不在这里给新卡片找位置。 */
  private preparePositions(data: DependencyGraph): ReadonlyMap<string, GraphNodePosition> | null {
    const canvasNodeIds = new Set((this.g6?.getNodeData() ?? []).map((node) => String(node.id)));
    const sharesNode = data.nodes.some((node) => canvasNodeIds.has(node.id));
    const reusePins =
      this.lastRootId === data.rootId && this.lastDepth === data.depth && sharesNode;

    if (!reusePins) {
      this.pinnedPositions.clear();
      this.lastDepth = data.depth;
      this.lastRootId = data.rootId;
      this.syncSavedPositions(data);
      return null;
    }

    const graph = this.liveGraph();
    if (!graph) {
      return null;
    }
    snapshotGraphPositions(graph, this.pinnedPositions);
    return this.pinnedPositions.size ? this.pinnedPositions : null;
  }

  /** 从节点上的 position（服务端字段）同步已保存布局。 */
  private syncSavedPositions(data: DependencyGraph): void {
    this.savedPositions.clear();
    for (const node of data.nodes) {
      if (node.relationHub || !node.position) {
        continue;
      }
      const { x, y } = node.position;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        this.savedPositions.set(node.id, { x, y });
      }
    }
  }

  /**
   * 基准布局：有服务端位置则还原（缺的节点用思维导图补齐），否则整图初始化。
   */
  private resolveBaselinePositions(data: DependencyGraph): Map<string, GraphNodePosition> {
    this.syncSavedPositions(data);
    const arranged = arrangeGraph(data);
    const hasSaved = data.nodes.some(
      (node) => !node.relationHub && this.savedPositions.has(node.id),
    );
    if (!hasSaved) {
      return arranged;
    }
    const next = new Map(arranged);
    for (const [id, pos] of this.savedPositions) {
      if (next.has(id)) {
        next.set(id, { ...next.get(id), ...pos });
      }
    }
    return next;
  }

  /**
   * 展开/收起：保留已有 pin（含拖拽），只给新出现的节点用思维导图坐标。
   */
  private resolveExpandCollapsePositions(data: DependencyGraph): Map<string, GraphNodePosition> {
    const arranged = arrangeGraph(data);
    const next = new Map(arranged);
    for (const [id, pos] of this.pinnedPositions) {
      if (next.has(id)) {
        next.set(id, { ...next.get(id), ...pos });
      }
    }
    return next;
  }

  /** 展开收起会增减卡片。集合一致才保留拖拽位置，否则按整理规则重排。 */
  private sameVisibleNodes(data: DependencyGraph): boolean {
    const ids = data.nodes.filter((node) => !node.relationHub).map((node) => node.id);
    return (
      ids.length === this.pinnedPositions.size && ids.every((id) => this.pinnedPositions.has(id))
    );
  }

  private liveGraph(): Graph | null {
    return this.g6 && !this.g6.destroyed ? this.g6 : null;
  }

  /** 卡片是 HTML，跟着相机 transform 放大后会糊。相机层一变就把缩放改成 zoom。 */
  private bindHtmlCamera(container: HTMLElement): void {
    const sync = (): void => {
      const camera = container.querySelector<HTMLElement>('#g-canvas-camera');
      if (!camera) {
        return;
      }
      if (!this.htmlCameraObserver) {
        this.htmlCameraObserver = new MutationObserver(() => sharpenHtmlCamera(camera));
        this.htmlCameraObserver.observe(camera, {
          attributes: true,
          attributeFilter: ['style'],
          childList: true,
        });
      }
      sharpenHtmlCamera(camera);
    };
    this.g6?.on(GraphEvent.AFTER_RENDER, sync);
    this.g6?.on(GraphEvent.AFTER_DRAW, sync);
    this.g6?.on(GraphEvent.AFTER_TRANSFORM, sync);
  }

  /** 视口拆掉后 getZoom 会读到空对象，这时当没有缩放。 */
  private graphZoom(): number | null {
    const graph = this.liveGraph();
    if (!graph) {
      return null;
    }
    try {
      return graph.getZoom();
    } catch {
      return null;
    }
  }

  private syncZoomPercent(): void {
    const zoom = this.graphZoom();
    if (zoom != null) {
      this.zoomPercent.set(Math.round(zoom * 100));
    }
  }

  private async render(data: DependencyGraph | null): Promise<void> {
    if (!this.g6) {
      return;
    }

    const seq = ++this.renderSeq;
    this.clearFitTimer();

    if (!data?.nodes.length) {
      this.pinnedPositions.clear();
      this.savedPositions.clear();
      this.lastDepth = null;
      this.lastRootId = null;
      this.g6.setData({ nodes: [], edges: [] });
      await this.g6.render();
      return;
    }

    const positions = this.preparePositions(data);
    if (positions && this.sameVisibleNodes(data)) {
      // 可见节点未变：保留拖拽位置
      this.applyGraphData(data, positions);
      await this.g6.draw();
    } else if (positions) {
      // 展开/收起：保留已拖拽坐标（含已收起节点的 pin），只给新增节点补位
      await this.applyLayoutPositions(data, this.resolveExpandCollapsePositions(data), {
        fitView: false,
        keepHiddenPins: true,
      });
    } else {
      // 初次进入 / 换根：服务端位置优先，否则思维导图初始化
      await this.layoutBaseline(data, { fitView: true });
      if (seq !== this.renderSeq) {
        return;
      }
      this.fitTimer = window.setTimeout(() => {
        if (seq === this.renderSeq) {
          this.fit();
        }
      }, GRAPH_FIT_SETTLE_MS);
    }

    const graph = this.liveGraph();
    if (seq !== this.renderSeq || !graph) {
      return;
    }

    await graph.setElementState(buildElementStates(data), false).catch(() => undefined);
  }

  /** 一键整理 / 首次进入：服务端位置优先，否则思维导图初始化。 */
  private async layoutBaseline(
    data: DependencyGraph,
    options: { fitView: boolean },
  ): Promise<void> {
    await this.applyLayoutPositions(data, this.resolveBaselinePositions(data), options);
  }

  /**
   * 把给定坐标落到画布并写入 pin。
   * 初次进入走 render；已有节点用 translateElementTo 强制归位。
   * keepHiddenPins：展开/收起时保留已隐藏节点的拖拽坐标，避免再展开回到初始位。
   */
  private async applyLayoutPositions(
    data: DependencyGraph,
    positions: ReadonlyMap<string, GraphNodePosition>,
    options: { fitView: boolean; keepHiddenPins?: boolean },
  ): Promise<void> {
    const graph = this.liveGraph();
    if (!graph) {
      return;
    }

    // setData 前判断：之后 getNodeData 已是新数据，分不清是否首次渲染
    const firstPaint = !(graph.getNodeData() ?? []).length;
    // 思维导图相对 (0,0) 布局，而默认相机看画布中心；fitView 落位时整体挪到画布中心
    const [width, height] = graph.getSize();
    const layout =
      options.fitView && width > 0 && height > 0
        ? new Map(
            [...positions].map(([id, pos]) => [
              id,
              { ...pos, x: pos.x + width / 2, y: pos.y + height / 2 },
            ]),
          )
        : positions;
    this.seedPinnedPositions(layout, options.keepHiddenPins);
    this.applyGraphData(data, layout);

    if (firstPaint) {
      await graph.render();
      this.applyGraphData(data, layout);
      await graph.draw();
    } else {
      await graph.draw();
      const moves = Object.fromEntries(
        [...layout].map(([id, pos]) => [id, [pos.x, pos.y] as [number, number]]),
      );
      if (Object.keys(moves).length) {
        await graph.translateElementTo(moves, false).catch(() => undefined);
      }
      await graph.draw();
    }

    if (options.fitView) {
      this.fit();
    }
  }

  private seedPinnedPositions(
    positions: ReadonlyMap<string, GraphNodePosition>,
    keepHidden = false,
  ): void {
    if (!keepHidden) {
      this.pinnedPositions.clear();
    }
    for (const [id, pos] of positions) {
      this.pinnedPositions.set(id, pos);
    }
  }

  private clearFitTimer(): void {
    if (this.fitTimer != null) {
      window.clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
  }
}

function isWorkItem(item: GraphEntity): boolean {
  return item.navigationTarget === 'workitem' || item.id.startsWith('work_item:');
}

function cardOf(event: Event): HTMLElement | null {
  const target = event.target;
  return target instanceof Element ? target.closest<HTMLElement>('[data-node-id]') : null;
}
