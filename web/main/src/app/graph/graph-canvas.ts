import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CanvasEvent, Graph, GraphEvent, type IElementEvent, NodeEvent } from '@antv/g6';
import {
  GRAPH_FIT_SETTLE_MS,
  GRAPH_OPTIONS,
  GRAPH_ZOOM_RANGE,
  GRAPH_ZOOM_STEP,
} from '../constants/graph.constants';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import {
  buildElementStates,
  graphHostSize,
  isBadgeTarget,
  nodeItemFromEvent,
  rememberFoldSides,
  snapshotGraphPositions,
} from '../utils/g6-helpers';
import { visiblePositions } from '../utils/pin-layout';
import {
  toG6Data,
  type FoldPlacement,
  type GraphNodePosition,
} from '../utils/to-g6-data';

@Component({
  selector: 'app-graph-canvas',
  templateUrl: './graph-canvas.html',
  styleUrl: './graph-canvas.scss',
})
export class GraphCanvas {
  readonly graph = input<DependencyGraph | null>(null);
  readonly selectedId = input<string | null>(null);
  readonly highlightCriticalPath = input(false);

  readonly selectNode = output<GraphEntity>();
  readonly clearSelection = output<void>();
  readonly toggleExpand = output<string>();

  protected readonly zoomPercent = signal(100);

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('g6Host');
  private readonly destroyRef = inject(DestroyRef);

  private g6: Graph | null = null;
  private readonly ready = signal(false);
  private resizeObserver: ResizeObserver | null = null;
  private fitTimer: number | null = null;
  private renderSeq = 0;
  private lastDepth: number | null = null;
  private lastRootId: string | null = null;
  private readonly pinnedPositions = new Map<string, GraphNodePosition>();
  private readonly foldSideById = new Map<string, FoldPlacement>();

  private readonly zoomMinPercent = Math.round(GRAPH_ZOOM_RANGE[0] * 100);
  private readonly zoomMaxPercent = Math.round(GRAPH_ZOOM_RANGE[1] * 100);

  constructor() {
    afterNextRender(() => this.initGraph());
    this.destroyRef.onDestroy(() => this.destroyGraph());

    effect(() => {
      if (this.ready()) {
        void this.render(this.graph());
      }
    });

    effect(() => {
      if (!this.ready() || !this.g6) {
        return;
      }
      const data = untracked(() => this.graph());
      const graph = this.liveGraph();
      if (data && graph) {
        void graph
          .setElementState(
            buildElementStates(data, this.selectedId(), this.highlightCriticalPath()),
            false,
          )
          .catch(() => undefined);
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
    this.pinnedPositions.clear();
    this.foldSideById.clear();
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
    this.g6.setData(toG6Data(data, positions ?? this.pinnedPositions, this.foldSideById));
    rememberFoldSides(this.g6, this.foldSideById);
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
      if (!item) {
        return;
      }
      if (item.expandToggle && isBadgeTarget(event)) {
        this.toggleExpand.emit(item.id);
        return;
      }
      this.selectNode.emit(item);
    });

    this.g6.on(CanvasEvent.CLICK, () => this.clearSelection.emit());
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

  /** 同一根节点、同一深度，且画布上还有重叠节点时沿用坐标；否则重新布局。 */
  private preparePositions(data: DependencyGraph): ReadonlyMap<string, GraphNodePosition> | null {
    const canvasNodeIds = new Set((this.g6?.getNodeData() ?? []).map((node) => String(node.id)));
    const sharesNode = data.nodes.some((node) => canvasNodeIds.has(node.id));
    const reusePins =
      this.lastRootId === data.rootId && this.lastDepth === data.depth && sharesNode;

    if (!reusePins) {
      this.pinnedPositions.clear();
      this.foldSideById.clear();
      this.lastDepth = data.depth;
      this.lastRootId = data.rootId;
      return null;
    }

    const graph = this.liveGraph();
    if (!graph) {
      return null;
    }
    snapshotGraphPositions(graph, this.pinnedPositions);
    return this.pinnedPositions.size ? visiblePositions(data, this.pinnedPositions) : null;
  }

  private liveGraph(): Graph | null {
    return this.g6 && !this.g6.destroyed ? this.g6 : null;
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
      this.foldSideById.clear();
      this.lastDepth = null;
      this.lastRootId = null;
      this.g6.setData({ nodes: [], edges: [] });
      await this.g6.render();
      return;
    }

    const positions = this.preparePositions(data);
    if (positions) {
      this.applyGraphData(data, positions);
      await this.g6.draw();
    } else {
      this.g6.setData(toG6Data(data, undefined, this.foldSideById));
      await this.g6.render();
      if (seq !== this.renderSeq) {
        return;
      }
      snapshotGraphPositions(this.g6, this.pinnedPositions);
      this.applyGraphData(data, this.pinnedPositions);
      await this.g6.draw();
      if (seq !== this.renderSeq) {
        return;
      }
      this.fit();
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
        buildElementStates(
          data,
          untracked(() => this.selectedId()),
          untracked(() => this.highlightCriticalPath()),
        ),
        false,
      )
      .catch(() => undefined);
  }

  private clearFitTimer(): void {
    if (this.fitTimer != null) {
      window.clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
  }
}
