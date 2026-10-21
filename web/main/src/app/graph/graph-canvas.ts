import {
  afterNextRender,
  ApplicationRef,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  EnvironmentInjector,
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
import type { DependencyGraph } from '../entities/graph.entity';
import type { LineColorMode } from '../settings/display-settings';
import type { Side } from '../utils/arrange-graph';
import { CanvasPositionSession } from '../utils/canvas-position-session';
import {
  buildElementStates,
  foldKeyFromEvent,
  graphHostSize,
  nodeItemFromEvent,
  sharpenHtmlCamera,
} from '../utils/g6-helpers';
import {
  isFoldSummaryNode,
  isWorkItemEntity,
  openPivot,
  relationBetween,
} from '../utils/graph.util';
import type { SavedNodePosition, SaveLayoutPayload } from '../utils/saved-graph-layout';
import { tidyGraphLayout } from '../utils/tidy-graph-layout';
import { toG6Data, type GraphNodePosition } from '../utils/to-g6-data';
import { setFullStrokeEdges } from './flat-polyline';
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

  /** 详情 tab 关掉左侧画布操作。 */
  readonly showTools = input(true);

  /** 工作项 tab 不提供换根追溯。 */
  readonly allowRetrace = input(true);

  /** 工作项 tab 里用路由打开详情，避免在详情页内再调 openDetail。 */
  readonly openInPage = input(false);

  /** 用户级关系方位偏好（跨工作项） */
  readonly relationSides = input<Record<string, Side> | null>(null);

  /** 个人视图完整坐标（含 fold / 收起子卡），供 baseline 合并 */
  readonly savedPositions = input<Record<string, SavedNodePosition> | null>(null);

  /** 线条颜色：默认灰线，或按事项/关系类型色 */
  readonly lineColorMode = input<LineColorMode>('default');

  readonly toggleExpand = output<string>();

  readonly retrace = output<string>();

  /** 保存个人布局：卡片坐标 + 用户级关系方位 */
  readonly saveLayout = output<SaveLayoutPayload>();

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
  private readonly positions = new CanvasPositionSession();
  private readonly traceStop = new AbortController();
  private traceTargetId: string | null = null;
  private traceMenuTimer = 0;
  /** 当前拖拽的节点；仅折叠占位松手时改方位 */
  private draggingNodeId: string | null = null;
  /** 拖拽中重算折线，避免边被拉成斜线 */
  private dragEdgeRaf = 0;
  /** 正在悬停的非主卡片。空表示连线用默认色。 */
  private hoveredCardId: string | null = null;
  /** 上一轮染过色的边，离开时要清掉。 */
  private linkedEdges: string[] = [];
  /** 写过 --card-accent 的卡片。 */
  private accentCard: HTMLElement | null = null;
  /** 染色排队：上一次画完再画下一次，避免快速划过时颜色错乱。 */
  private hoverJob: Promise<void> | null = null;
  private hoverAgain = false;

  private readonly zoomMinPercent = Math.round(GRAPH_ZOOM_RANGE[0] * 100);
  private readonly zoomMaxPercent = Math.round(GRAPH_ZOOM_RANGE[1] * 100);

  constructor() {
    bindWorkItemCardRuntime(inject(EnvironmentInjector), inject(ApplicationRef));
    afterNextRender(() => this.initGraph());
    this.destroyRef.onDestroy(() => this.destroyGraph());

    effect(() => {
      this.positions.setRelationSides(this.relationSides());
    });

    effect(() => {
      this.positions.replaceSaved(this.savedPositions());
    });

    effect(() => {
      if (this.ready()) {
        this.lineColorMode();
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

  /** 点击百分比：缩放到 100%，不移动视口中心。 */
  protected resetZoom(): void {
    const graph = this.liveGraph();
    if (!graph || this.zoomPercent() === 100) {
      return;
    }
    void graph
      .zoomTo(1)
      .then(() => this.syncZoomPercent())
      .catch(() => undefined);
  }

  /** 定位到当前工作项（图根节点）：缩放到 100% 并居中。 */
  protected locate(): void {
    void this.locateRoot({ duration: 300 });
  }

  /** 快照当前卡片坐标，交给上层写入服务端。 */
  protected save(): void {
    const g6 = this.liveGraph();
    if (!g6) {
      return;
    }
    const data = untracked(() => this.graph());
    this.positions.snapshot(g6, data);
    this.saveLayout.emit({
      positions: this.positions.toSaveRecord(),
      relationSides: this.positions.getRelationSides(),
    });
  }

  /** 一键整理：当前 pins 多数票重排；不读 saved、不自动保存。初始化走 layoutBaseline。 */
  protected organize(): void {
    const data = untracked(() => this.graph());
    const g6 = this.liveGraph();
    if (!data?.nodes.length || !g6) {
      return;
    }
    this.positions.snapshot(g6, data);
    const tidied = tidyGraphLayout(data, this.positions.pins);
    void this.applyLayoutPositions(data, tidied, {
      viewport: 'none',
      keepHiddenPins: true,
    }).catch(() => undefined);
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

  /** 缩放到 100%，并把当前工作项（根节点）放到视口中心。 */
  private async locateRoot(options?: { duration?: number }): Promise<void> {
    const data = untracked(() => this.graph());
    const graph = this.liveGraph();
    const rootId = data?.rootId;
    if (!graph || !rootId || !data?.nodes.some((node) => node.id === rootId)) {
      return;
    }
    const duration = options?.duration ?? 0;
    const animation = duration > 0 ? { duration } : false;
    try {
      await graph.zoomTo(1, animation);
      await graph.focusElement(rootId, animation);
      this.syncZoomPercent();
    } catch {
      // 视口未就绪时忽略
    }
  }

  private initGraph(): void {
    const container = this.host().nativeElement;
    this.g6 = new Graph({ container, ...graphHostSize(container), ...GRAPH_OPTIONS });
    // 按下画布即清选区（平移/点选都可能残留蓝底）
    container.addEventListener('pointerdown', () => window.getSelection()?.removeAllRanges(), {
      capture: true,
      signal: this.traceStop.signal,
    });
    this.bindTraceMenu(container);
    this.bindCardHover(container);
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
    if (this.dragEdgeRaf) {
      cancelAnimationFrame(this.dragEdgeRaf);
      this.dragEdgeRaf = 0;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.htmlCameraObserver?.disconnect();
    this.htmlCameraObserver = null;
    this.positions.clear();
    this.hoveredCardId = null;
    this.linkedEdges = [];
    this.clearCardAccent();
    setFullStrokeEdges([]);
    window.clearTimeout(this.traceMenuTimer);
    this.traceStop.abort();
    this.g6?.off();
    this.g6?.destroy();
    this.g6 = null;
    this.ready.set(false);
  }

  private applyGraphData(
    data: DependencyGraph,
    layout?: ReadonlyMap<string, GraphNodePosition>,
  ): void {
    if (!this.g6) {
      return;
    }
    const next = toG6Data(data, layout ?? this.positions.pins, this.lineColorMode());
    this.g6.setData(next);
    // 切换线条模式后刷新边色
    this.g6.updateEdgeData(
      (next.edges ?? []).map((edge) => ({
        id: edge.id,
        data: edge.data,
        style: edge.style,
      })),
    );
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
      const foldKey = item.foldSummary?.key ?? foldKeyFromEvent(event);
      if (foldKey) {
        this.toggleExpand.emit(foldKey);
        return;
      }
      openPivot(item, { inPage: this.openInPage() });
    });

    this.g6.on(GraphEvent.AFTER_TRANSFORM, () => {
      this.syncZoomPercent();
      this.syncTraceMenuScale();
    });
    this.g6.on(NodeEvent.DRAG_START, (event: IElementEvent) => {
      this.g6?.stopLayout();
      this.draggingNodeId = String(event.target.id);
      // 拖拽易带出浏览器文字选区，卡住蓝底需再点卡片才消
      window.getSelection()?.removeAllRanges();
    });
    this.g6.on(NodeEvent.DRAG, () => {
      if (this.dragEdgeRaf) {
        return;
      }
      this.dragEdgeRaf = requestAnimationFrame(() => {
        this.dragEdgeRaf = 0;
        this.syncEdgesWhileDragging();
      });
    });
    this.g6.on(NodeEvent.DRAG_END, () => {
      if (this.dragEdgeRaf) {
        cancelAnimationFrame(this.dragEdgeRaf);
        this.dragEdgeRaf = 0;
      }
      if (!this.g6) {
        return;
      }
      const data = untracked(() => this.graph());
      const draggedId = this.draggingNodeId;
      this.draggingNodeId = null;
      // 写 side；仅折叠占位松手时同步关系方位偏好（父/子普通卡不写偏好、不整组重锚）
      this.positions.snapshot(this.g6, data, draggedId, true);
      if (!data) {
        return;
      }
      this.applyGraphData(data);
      void this.g6.draw();
    });
  }

  /**
   * 拖拽中按当前位置更新 side 并重算正交折点（不写关系偏好；松手后仅折叠占位写偏好）。
   */
  private syncEdgesWhileDragging(): void {
    const g6 = this.g6;
    const data = untracked(() => this.graph());
    const draggedId = this.draggingNodeId;
    if (!g6 || !data || !draggedId) {
      return;
    }
    this.positions.snapshot(g6, data, draggedId, false);
    const next = toG6Data(data, this.positions.pins, this.lineColorMode());
    g6.updateEdgeData(
      (next.edges ?? []).map((edge) => ({
        id: edge.id,
        style: edge.style,
        data: edge.data,
      })),
    );
    g6.updateNodeData(
      (next.nodes ?? []).map((node) => ({
        id: node.id,
        data: {
          ...g6.getNodeData(String(node.id))?.data,
          foldMarks: node.data?.['foldMarks'],
        },
      })),
    );
    void g6.draw().then(() => {
      if (this.linkedEdges.length) {
        this.paintHoverLink();
      }
    });
  }

  /** 悬停非主卡片时，把它到主卡片的折线整段染成高亮色。 */
  private bindCardHover(container: HTMLElement): void {
    const signal = this.traceStop.signal;
    container.addEventListener('mouseover', this.onCardHover, { signal });
    container.addEventListener('mouseout', this.onCardHoverOut, { signal });
  }

  private readonly onCardHover = (event: MouseEvent): void => {
    const id = hoverCardId(
      event.target,
      untracked(() => this.graph()),
    );
    if (id === this.hoveredCardId) {
      return;
    }
    this.hoveredCardId = id;
    this.paintHoverLink();
  };

  private readonly onCardHoverOut = (event: MouseEvent): void => {
    const data = untracked(() => this.graph());
    if (hoverCardId(event.target, data) !== this.hoveredCardId) {
      return;
    }
    // 滑到另一张卡片上时，交给 mouseover。
    if (hoverCardId(event.relatedTarget, data)) {
      return;
    }
    this.hoveredCardId = null;
    this.paintHoverLink();
  };

  private paintHoverLink(): void {
    if (this.hoverJob) {
      this.hoverAgain = true;
      return;
    }
    this.hoverJob = this.drawHoverLink()
      .catch(() => undefined)
      .finally(() => {
        this.hoverJob = null;
        if (!this.hoverAgain) {
          return;
        }
        this.hoverAgain = false;
        this.paintHoverLink();
      });
  }

  private async drawHoverLink(): Promise<void> {
    const graph = this.liveGraph();
    if (!graph) {
      return;
    }
    const data = untracked(() => this.graph());
    const live = new Set((graph.getEdgeData() ?? []).map((edge) => String(edge.id)));
    const next = new Set(
      (data && this.hoveredCardId ? edgesToRoot(data, this.hoveredCardId) : []).filter((id) =>
        live.has(id),
      ),
    );
    const clear = this.linkedEdges.filter((id) => live.has(id) && !next.has(id));
    this.linkedEdges = [...next];
    setFullStrokeEdges(next);
    const colorMode = this.lineColorMode() === 'item';
    this.syncCardAccent(graph, data, this.hoveredCardId, colorMode);

    if (colorMode) {
      // 彩色：hover 只加深线条
      const patches: { id: string; data: Record<string, unknown> }[] = [];
      for (const id of clear) {
        const edge = graph.getEdgeData(id);
        const faded = edge?.data?.['edgeColorFaded'];
        if (edge?.data && typeof faded === 'string') {
          patches.push({
            id,
            data: { ...edge.data, edgeColor: faded },
          });
        }
      }
      for (const id of next) {
        const edge = graph.getEdgeData(id);
        const solid = edge?.data?.['edgeColorSolid'];
        if (edge?.data && typeof solid === 'string') {
          patches.push({
            id,
            data: { ...edge.data, edgeColor: solid },
          });
        }
      }
      if (patches.length) {
        graph.updateEdgeData(patches);
        await graph.draw();
      }
    } else {
      const states: Record<string, string[]> = {};
      for (const id of clear) {
        states[id] = [];
      }
      for (const id of next) {
        states[id] = ['link'];
      }
      if (Object.keys(states).length) {
        await graph.setElementState(states, false);
      }
    }
    if (this.linkedEdges.length) {
      await graph.frontElement(this.linkedEdges);
    }
  }

  /** 彩色 hover：卡片边框跟关系色。 */
  private syncCardAccent(
    graph: Graph,
    data: DependencyGraph | null,
    cardId: string | null,
    colorMode: boolean,
  ): void {
    this.clearCardAccent();
    if (!colorMode || !data || !cardId) {
      return;
    }
    const edgeId = edgesToRoot(data, cardId)[0];
    const solid = edgeId ? graph.getEdgeData(edgeId)?.data?.['edgeColorSolid'] : null;
    if (typeof solid !== 'string') {
      return;
    }
    const card = findCardEl(this.host().nativeElement, cardId);
    if (!card) {
      return;
    }
    card.style.setProperty('--card-accent', solid);
    this.accentCard = card;
  }

  private clearCardAccent(): void {
    if (!this.accentCard) {
      return;
    }
    this.accentCard.style.removeProperty('--card-accent');
    this.accentCard = null;
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
    if (!this.allowRetrace()) {
      return;
    }
    const card = cardOf(event);
    if (!card) {
      return;
    }
    event.preventDefault();
    const id = this.traceCandidate(card.dataset['nodeId']);
    if (id) {
      this.host().nativeElement.querySelector('.card--active')?.classList.remove('card--active');
      card.classList.add('card--active');
      this.openTraceMenu(id, event.clientX, event.clientY);
    }
  };

  /** 当前中心、分叉点、折叠占位和非工作项不能换根。 */
  private traceCandidate(id: string | undefined): string | null {
    const data = untracked(() => this.graph());
    const item = data?.nodes.find((node) => node.id === id);
    if (
      !item ||
      item.relationHub ||
      isFoldSummaryNode(item) ||
      item.id === data?.rootId ||
      !isWorkItemEntity(item)
    ) {
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

  protected onTraceMenuActive(active: boolean): void {
    if (!active) {
      this.host().nativeElement.querySelector('.card--active')?.classList.remove('card--active');
    }
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
      this.positions.clear();
      this.g6.setData({ nodes: [], edges: [] });
      await this.g6.render();
      return;
    }

    const canvasNodeIds = new Set(this.g6.getNodeData().map((node) => String(node.id)));
    const reused = this.positions.prepare(data, canvasNodeIds, this.g6);
    if (reused && this.positions.sameVisibleNodes(data)) {
      // 可见节点未变：保留拖拽位置
      this.positions.rememberGraph(data);
      this.applyGraphData(data, reused);
      await this.g6.draw();
    } else if (reused) {
      // 展开/收起：保留已拖拽坐标（含已收起节点的 pin），+N 对齐展开位
      await this.applyLayoutPositions(data, this.positions.resolveExpandCollapse(data), {
        viewport: 'none',
        keepHiddenPins: true,
      });
    } else {
      // 初次进入 / 换根：默认 100% 并定位当前工作项
      await this.layoutBaseline(data, { viewport: 'root' });
      if (seq !== this.renderSeq) {
        return;
      }
      this.fitTimer = window.setTimeout(() => {
        if (seq === this.renderSeq) {
          void this.locateRoot();
        }
      }, GRAPH_FIT_SETTLE_MS);
    }

    const graph = this.liveGraph();
    if (seq !== this.renderSeq || !graph) {
      return;
    }

    await graph.setElementState(buildElementStates(data), false).catch(() => undefined);
    this.paintHoverLink();
  }

  /** 首次进入 / 换根：saved 优先，否则 arrange。 */
  private async layoutBaseline(
    data: DependencyGraph,
    options: { viewport: 'fit' | 'root' | 'none' },
  ): Promise<void> {
    // saved 已是绝对坐标，勿再 centerForViewport
    const viewport = this.positions.hasSavedPositions() ? 'none' : options.viewport;
    await this.applyLayoutPositions(data, this.positions.resolveBaseline(data), { viewport });
    if (viewport === 'none' && options.viewport === 'root') {
      await this.locateRoot();
    }
  }

  /**
   * 把给定坐标落到画布并写入 pin。
   * 初次进入走 render；已有节点用 translateElementTo 强制归位。
   */
  private async applyLayoutPositions(
    data: DependencyGraph,
    layoutPositions: ReadonlyMap<string, GraphNodePosition>,
    options: { viewport: 'fit' | 'root' | 'none'; keepHiddenPins?: boolean },
  ): Promise<void> {
    const graph = this.liveGraph();
    if (!graph) {
      return;
    }

    // setData 前判断：之后 getNodeData 已是新数据，分不清是否首次渲染
    const firstPaint = !(graph.getNodeData() ?? []).length;
    const [width, height] = graph.getSize();
    const centerLayout = options.viewport !== 'none' && width > 0 && height > 0;
    const layout = centerLayout
      ? this.positions.centerForViewport(layoutPositions, width, height)
      : layoutPositions;
    this.positions.seed(layout, options.keepHiddenPins);
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

    if (options.viewport === 'fit') {
      this.fit();
    } else if (options.viewport === 'root') {
      await this.locateRoot();
    }
  }

  private clearFitTimer(): void {
    if (this.fitTimer != null) {
      window.clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
  }
}

/** 主卡片、分叉点和「+ N」不染色。 */
function hoverCardId(target: EventTarget | null, data: DependencyGraph | null): string | null {
  const card = target instanceof Element ? target.closest<HTMLElement>('article.card') : null;
  const id = card?.dataset['nodeId'];
  const item = id && data ? data.nodes.find((node) => node.id === id) : undefined;
  if (!data || !item || item.id === data.rootId || item.relationHub || isFoldSummaryNode(item)) {
    return null;
  }
  return item.id;
}

/** 从这张卡片沿展开父级走回主卡片，边 id 与 trunkEdges 一致。 */
function edgesToRoot(data: DependencyGraph, startId: string): string[] {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const ids: string[] = [];
  const seen = new Set<string>();
  let current = nodes.get(startId);
  while (current?.revealedByAnchorId && !seen.has(current.id)) {
    seen.add(current.id);
    const parentId = current.revealedByAnchorId;
    const relationType =
      current.foldSummary?.relationType ?? relationBetween(data.edges, nodes, parentId, current.id);
    ids.push(`${parentId}:${relationType}:${current.id}`);
    current = nodes.get(parentId);
  }
  return ids;
}

function findCardEl(root: HTMLElement, cardId: string): HTMLElement | null {
  const cards = root.querySelectorAll<HTMLElement>('article.card');
  for (const card of cards) {
    if (card.dataset['nodeId'] === cardId) {
      return card;
    }
  }
  return null;
}

function cardOf(event: Event): HTMLElement | null {
  const target = event.target;
  return target instanceof Element ? target.closest<HTMLElement>('[data-node-id]') : null;
}
