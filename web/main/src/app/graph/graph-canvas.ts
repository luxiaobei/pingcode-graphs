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
import { Graph, GraphEvent, type IElementEvent, NodeEvent } from '@antv/g6';
import { ThyAction } from 'ngx-tethys/action';
import { ThyTooltipDirective } from 'ngx-tethys/tooltip';
import { bindWorkItemCardRuntime } from './work-item-card';
import {
  GRAPH_FIT_SETTLE_MS,
  GRAPH_OPTIONS,
  GRAPH_ZOOM_RANGE,
  GRAPH_ZOOM_STEP,
} from '../constants/graph.constants';
import type { DependencyGraph } from '../entities/graph.entity';
import {
  buildElementStates,
  graphHostSize,
  foldKeyFromEvent,
  nodeItemFromEvent,
  sharpenHtmlCamera,
  snapshotGraphPositions,
} from '../utils/g6-helpers';
import { arrangeGraph } from '../utils/arrange-graph';
import { openPivot } from '../utils/graph.util';
import { toG6Data, type GraphNodePosition } from '../utils/to-g6-data';

@Component({
  selector: 'app-graph-canvas',
  imports: [ThyAction, ThyTooltipDirective],
  templateUrl: './graph-canvas.html',
  styleUrl: './graph-canvas.scss',
})
export class GraphCanvas {
  readonly graph = input<DependencyGraph | null>(null);

  readonly toggleExpand = output<string>();

  protected readonly zoomPercent = signal(100);

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('g6Host');
  private readonly destroyRef = inject(DestroyRef);

  private g6: Graph | null = null;
  private readonly ready = signal(false);
  private resizeObserver: ResizeObserver | null = null;
  private htmlCameraObserver: MutationObserver | null = null;
  private fitTimer: number | null = null;
  private renderSeq = 0;
  private lastDepth: number | null = null;
  private lastRootId: string | null = null;
  private readonly pinnedPositions = new Map<string, GraphNodePosition>();

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

  /** 定位入口，功能后续再接。 */
  protected locate(): void {}

  /** 保存入口，功能后续再接。 */
  protected save(): void {}

  /**
   * 一键整理：按思维导图规则重排（根居中，左需求/工单、右目标/测试、上下其他关系）。
   * 初次进入与拖拽打乱后共用这套坐标。
   */
  protected organize(): void {
    const data = untracked(() => this.graph());
    if (!data?.nodes.length || !this.liveGraph()) {
      return;
    }
    void this.layoutToMindMap(data, { fitView: true }).catch(() => undefined);
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
    this.lastDepth = null;
    this.lastRootId = null;
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

    this.g6.on(GraphEvent.AFTER_TRANSFORM, () => this.syncZoomPercent());
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
      return null;
    }

    const graph = this.liveGraph();
    if (!graph) {
      return null;
    }
    snapshotGraphPositions(graph, this.pinnedPositions);
    return this.pinnedPositions.size ? this.pinnedPositions : null;
  }

  /** 展开收起会增减卡片。集合一致才保留拖拽位置，否则按整理规则重排。 */
  private sameVisibleNodes(data: DependencyGraph): boolean {
    const ids = data.nodes.filter((node) => !node.relationHub).map((node) => node.id);
    return ids.length === this.pinnedPositions.size && ids.every((id) => this.pinnedPositions.has(id));
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

  private syncZoomPercent(): void {
    const graph = this.liveGraph();
    if (!graph) {
      return;
    }
    try {
      this.zoomPercent.set(Math.round(graph.getZoom() * 100));
    } catch {
      // 销毁过程中视口可能已经拆掉
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
      this.lastDepth = null;
      this.lastRootId = null;
      this.g6.setData({ nodes: [], edges: [] });
      await this.g6.render();
      return;
    }

    const positions = this.preparePositions(data);
    if (positions && this.sameVisibleNodes(data)) {
      this.applyGraphData(data, positions);
      await this.g6.draw();
    } else if (positions) {
      // 展开/收起后节点有增减：按思维导图重排，不强制适应画布以免打断当前视口
      await this.layoutToMindMap(data, { fitView: false });
    } else {
      // 初次进入 / 换根：初始化思维导图位置并适应画布
      await this.layoutToMindMap(data, { fitView: true });
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

    await graph
      .setElementState(
        buildElementStates(data),
        false,
      )
      .catch(() => undefined);
  }

  /**
   * 写入思维导图坐标并落到画布。
   * 初次进入走 render；已有画布节点用 translateElementTo 强制归位
   *（打乱后仅 setData+draw 往往不会更新坐标）。
   */
  private async layoutToMindMap(
    data: DependencyGraph,
    options: { fitView: boolean },
  ): Promise<void> {
    const graph = this.liveGraph();
    if (!graph) {
      return;
    }

    // setData 前判断：之后 getNodeData 已是新数据，分不清是否首次渲染
    const firstPaint = !(graph.getNodeData() ?? []).length;
    this.seedPinnedPositions(arrangeGraph(data));
    this.applyGraphData(data, this.pinnedPositions);

    if (firstPaint) {
      await graph.render();
      this.applyGraphData(data, this.pinnedPositions);
      await graph.draw();
    } else {
      await graph.draw();
      const moves = Object.fromEntries(
        [...this.pinnedPositions].map(([id, pos]) => [id, [pos.x, pos.y] as [number, number]]),
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

  private seedPinnedPositions(arranged: ReadonlyMap<string, GraphNodePosition>): void {
    this.pinnedPositions.clear();
    for (const [id, pos] of arranged) {
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
