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
import { CanvasEvent, Graph, type IElementEvent, NodeEvent } from '@antv/g6';
import { GRAPH_MIN_SIZE, GRAPH_OPTIONS } from '../constants/graph.constants';
import type { DependencyGraph, GraphWorkItem } from '../entities/graph.entity';
import { toG6Data } from './to-g6-data';

@Component({
  selector: 'app-graph-canvas',
  templateUrl: './graph-canvas.html',
  styleUrl: './graph-canvas.scss',
})
export class GraphCanvas {
  readonly graph = input<DependencyGraph | null>(null);
  readonly selectedId = input<string | null>(null);
  readonly highlightCriticalPath = input(false);

  readonly selectNode = output<GraphWorkItem>();
  readonly clearSelection = output<void>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('g6Host');
  private readonly destroyRef = inject(DestroyRef);

  private g6: Graph | null = null;
  private readonly ready = signal(false);
  private resizeObserver: ResizeObserver | null = null;
  private fitTimers: number[] = [];

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

  protected fit(): void {
    void this.g6?.fitView({ when: 'always', direction: 'both' });
  }

  private initGraph(): void {
    const container = this.host().nativeElement;
    this.g6 = this.createGraph(container);
    this.bindGraphEvents();
    this.observeResize(container);
    this.ready.set(true);
  }

  private destroyGraph(): void {
    this.clearFitTimers();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
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
      const item = this.g6?.getNodeData(id)?.data?.['item'] as GraphWorkItem | undefined;
      if (item) {
        this.selectNode.emit(item);
      }
    });

    this.g6.on(CanvasEvent.CLICK, () => {
      this.clearSelection.emit();
    });
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
    this.fit();
  }

  private async render(data: DependencyGraph | null): Promise<void> {
    if (!this.g6) {
      return;
    }

    this.clearFitTimers();

    if (!data?.nodes.length) {
      this.g6.setData({ nodes: [], edges: [] });
      await this.g6.render();
      return;
    }

    this.g6.setData(toG6Data(data));
    await this.g6.render();
    await this.applyHighlights(
      data,
      untracked(() => this.selectedId()),
      untracked(() => this.highlightCriticalPath()),
    );
    this.scheduleFit();
  }

  private scheduleFit(): void {
    for (const delay of [0, 50, 200, 500]) {
      const timer = window.setTimeout(() => this.fit(), delay);
      this.fitTimers.push(timer);
    }
  }

  private clearFitTimers(): void {
    for (const timer of this.fitTimers) {
      window.clearTimeout(timer);
    }
    this.fitTimers = [];
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
        edge.relationType === 'block' &&
        criticalSet.has(edge.source) &&
        criticalSet.has(edge.target);
      stateMap[edge.id] = onCritical ? ['critical'] : highlightCritical ? ['dimmed'] : [];
    }

    await this.g6.setElementState(stateMap, false);
  }
}
