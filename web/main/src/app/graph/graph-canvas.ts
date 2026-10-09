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
  GRAPH_MIN_SIZE,
  GRAPH_OPTIONS,
  GRAPH_ZOOM_RANGE,
  GRAPH_ZOOM_STEP,
} from '../constants/graph.constants';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import { isCriticalRelation } from '../utils/graph.util';
import { toG6Data, type GraphNodePosition } from '../utils/to-g6-data';

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

  protected readonly zoomPercent = signal(100);

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('g6Host');
  private readonly destroyRef = inject(DestroyRef);

  private g6: Graph | null = null;
  private readonly ready = signal(false);
  private resizeObserver: ResizeObserver | null = null;
  private fitTimer: number | null = null;
  private renderSeq = 0;
  /** 拖拽后固定坐标；仅当当前全部节点都有坐标时跳过力导向 */
  private readonly pinnedPositions = new Map<string, GraphNodePosition>();

  private readonly zoomMinPercent = Math.round(GRAPH_ZOOM_RANGE[0] * 100);
  private readonly zoomMaxPercent = Math.round(GRAPH_ZOOM_RANGE[1] * 100);

  constructor() {
    afterNextRender(() => this.initGraph());

    this.destroyRef.onDestroy(() => this.destroyGraph());

    effect(() => {
      if (!this.ready()) {
        return;
      }
      void this.render(this.graph());
    });

    effect(() => {
      if (!this.ready()) {
        return;
      }
      const selectedId = this.selectedId();
      const highlightCritical = this.highlightCriticalPath();
      const data = untracked(() => this.graph());
      if (!data) {
        return;
      }
      void this.applyHighlights(data, selectedId, highlightCritical);
    });
  }

  protected canZoomIn(): boolean {
    return this.zoomPercent() < this.zoomMaxPercent;
  }

  protected canZoomOut(): boolean {
    return this.zoomPercent() > this.zoomMinPercent;
  }

  protected zoomIn(): void {
    if (!this.g6 || !this.canZoomIn()) {
      return;
    }
    void this.g6.zoomBy(GRAPH_ZOOM_STEP).then(() => this.syncZoomPercent());
  }

  protected zoomOut(): void {
    if (!this.g6 || !this.canZoomOut()) {
      return;
    }
    void this.g6.zoomBy(1 / GRAPH_ZOOM_STEP).then(() => this.syncZoomPercent());
  }

  protected fit(): void {
    void this.g6?.fitView({ when: 'always', direction: 'both' }).then(() => this.syncZoomPercent());
  }

  private initGraph(): void {
    const container = this.host().nativeElement;
    this.g6 = this.createGraph(container);
    this.bindGraphEvents();
    this.observeResize(container);
    this.ready.set(true);
  }

  private destroyGraph(): void {
    this.clearFitTimer();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.pinnedPositions.clear();
    this.g6?.destroy();
    this.g6 = null;
    this.ready.set(false);
  }

  private createGraph(container: HTMLElement): Graph {
    const { width, height } = container.getBoundingClientRect();
    return new Graph({
      container,
      width: Math.max(width, GRAPH_MIN_SIZE),
      height: Math.max(height, GRAPH_MIN_SIZE),
      ...GRAPH_OPTIONS,
    });
  }

  private bindGraphEvents(): void {
    if (!this.g6) {
      return;
    }

    this.g6.on(NodeEvent.CLICK, (event: IElementEvent) => {
      const id = String(event.target.id);
      const item = this.g6?.getNodeData(id)?.data?.['item'] as GraphEntity | undefined;
      if (item) {
        this.selectNode.emit(item);
      }
    });

    this.g6.on(CanvasEvent.CLICK, () => {
      this.clearSelection.emit();
    });

    this.g6.on(GraphEvent.AFTER_TRANSFORM, () => {
      this.syncZoomPercent();
    });

    this.g6.on(NodeEvent.DRAG_START, () => {
      this.g6?.stopLayout();
    });

    this.g6.on(NodeEvent.DRAG_END, () => {
      this.snapshotAllPositions();
    });
  }

  private snapshotAllPositions(): void {
    if (!this.g6) {
      return;
    }
    for (const node of this.g6.getNodeData()) {
      const id = String(node.id);
      const [x, y] = this.g6.getElementPosition(id);
      this.pinnedPositions.set(id, { x, y });
    }
  }

  /** 去掉已不在图中的钉住坐标；若有新增未钉住节点则整图放弃钉住并重排 */
  private resolvePinnedPositions(data: DependencyGraph): ReadonlyMap<string, GraphNodePosition> | null {
    const nodeIds = new Set(data.nodes.map((node) => node.id));
    for (const id of [...this.pinnedPositions.keys()]) {
      if (!nodeIds.has(id)) {
        this.pinnedPositions.delete(id);
      }
    }

    if (!this.pinnedPositions.size) {
      return null;
    }

    const allPinned = data.nodes.every((node) => this.pinnedPositions.has(node.id));
    if (!allPinned) {
      this.pinnedPositions.clear();
      return null;
    }

    return this.pinnedPositions;
  }

  private syncZoomPercent(): void {
    const zoom = this.g6?.getZoom() ?? 1;
    this.zoomPercent.set(Math.round(zoom * 100));
  }

  private observeResize(container: HTMLElement): void {
    this.resizeObserver = new ResizeObserver(() => this.resizeToHost(container));
    this.resizeObserver.observe(container);
  }

  private resizeToHost(container: HTMLElement): void {
    if (!this.g6) {
      return;
    }
    const rect = container.getBoundingClientRect();
    this.g6.resize(Math.max(rect.width, GRAPH_MIN_SIZE), Math.max(rect.height, GRAPH_MIN_SIZE));
  }

  private async render(data: DependencyGraph | null): Promise<void> {
    if (!this.g6) {
      return;
    }

    const seq = ++this.renderSeq;
    this.clearFitTimer();

    if (!data?.nodes.length) {
      this.pinnedPositions.clear();
      this.g6.setData({ nodes: [], edges: [] });
      await this.g6.render();
      return;
    }

    const positions = this.resolvePinnedPositions(data);
    this.g6.setData(toG6Data(data, positions ?? undefined));

    if (positions) {
      await this.g6.draw();
    } else {
      await this.g6.render();
      if (seq !== this.renderSeq) {
        return;
      }
      this.fit();
      // 力导向还会再收束一阵，延迟再适应一次
      this.fitTimer = window.setTimeout(() => {
        if (seq === this.renderSeq) {
          this.fit();
        }
      }, GRAPH_FIT_SETTLE_MS);
    }

    if (seq !== this.renderSeq) {
      return;
    }

    await this.applyHighlights(
      data,
      untracked(() => this.selectedId()),
      untracked(() => this.highlightCriticalPath()),
    );
  }

  private clearFitTimer(): void {
    if (this.fitTimer != null) {
      window.clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
  }

  private async applyHighlights(
    data: DependencyGraph,
    selectedId: string | null,
    highlightCritical: boolean,
  ): Promise<void> {
    if (!this.g6) {
      return;
    }

    const criticalSet = new Set(highlightCritical ? data.criticalPath : []);
    const stateMap: Record<string, string[]> = {};

    for (const node of data.nodes) {
      const states: string[] = [];
      if (node.id === data.rootId) {
        states.push('root');
      }
      if (node.id === selectedId) {
        states.push('selected');
      }
      if (criticalSet.has(node.id)) {
        states.push('critical');
      } else if (highlightCritical) {
        states.push('dimmed');
      }
      stateMap[node.id] = states;
    }

    for (const edge of data.edges) {
      const onCritical =
        highlightCritical &&
        isCriticalRelation(edge.relationType) &&
        criticalSet.has(edge.source) &&
        criticalSet.has(edge.target);
      stateMap[edge.id] = onCritical ? ['critical'] : highlightCritical ? ['dimmed'] : [];
    }

    await this.g6.setElementState(stateMap, false);
  }
}
