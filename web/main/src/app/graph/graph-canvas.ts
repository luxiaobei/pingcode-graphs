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
import type { DependencyGraph } from '../entities/graph.entity';
import { CanvasPositionSession } from '../utils/canvas-position-session';
import {
  buildElementStates,
  foldKeyFromEvent,
  graphHostSize,
  nodeItemFromEvent,
  sharpenHtmlCamera,
} from '../utils/g6-helpers';
import { isWorkItemEntity, openPivot } from '../utils/graph.util';
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
  private readonly positions = new CanvasPositionSession();
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
    this.positions.snapshot(graph);
    this.saveLayout.emit(this.positions.toSaveRecord());
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
    this.positions.clear();
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
    this.g6.setData(toG6Data(data, layout ?? this.positions.pins));
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
      this.positions.snapshot(this.g6);
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

  /** 当前中心、分叉点、折叠占位和非工作项不能换根。 */
  private traceCandidate(id: string | undefined): string | null {
    const data = untracked(() => this.graph());
    const item = data?.nodes.find((node) => node.id === id);
    if (
      !item ||
      item.relationHub ||
      item.foldSummary ||
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
      this.applyGraphData(data, reused);
      await this.g6.draw();
    } else if (reused) {
      // 展开/收起：保留已拖拽坐标（含已收起节点的 pin），只给新增节点补位
      await this.applyLayoutPositions(data, this.positions.resolveExpandCollapse(data), {
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
    await this.applyLayoutPositions(data, this.positions.resolveBaseline(data), options);
  }

  /**
   * 把给定坐标落到画布并写入 pin。
   * 初次进入走 render；已有节点用 translateElementTo 强制归位。
   */
  private async applyLayoutPositions(
    data: DependencyGraph,
    layoutPositions: ReadonlyMap<string, GraphNodePosition>,
    options: { fitView: boolean; keepHiddenPins?: boolean },
  ): Promise<void> {
    const graph = this.liveGraph();
    if (!graph) {
      return;
    }

    // setData 前判断：之后 getNodeData 已是新数据，分不清是否首次渲染
    const firstPaint = !(graph.getNodeData() ?? []).length;
    const [width, height] = graph.getSize();
    const layout =
      options.fitView && width > 0 && height > 0
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

    if (options.fitView) {
      this.fit();
    }
  }

  private clearFitTimer(): void {
    if (this.fitTimer != null) {
      window.clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
  }
}

function cardOf(event: Event): HTMLElement | null {
  const target = event.target;
  return target instanceof Element ? target.closest<HTMLElement>('[data-node-id]') : null;
}
