import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { CanvasEvent, Graph, type IElementEvent, NodeEvent } from '@antv/g6';
import { DependencyGraph, GraphWorkItem } from './graph.types';
import { toG6Data } from './to-g6-data';

@Component({
  selector: 'app-graph-canvas',
  templateUrl: './graph-canvas.html',
  styleUrl: './graph-canvas.scss',
})
export class GraphCanvas implements AfterViewInit, OnDestroy {
  readonly graph = input<DependencyGraph | null>(null);
  readonly selectedId = input<string | null>(null);
  readonly highlightCriticalPath = input(false);

  readonly selectNode = output<GraphWorkItem>();
  readonly clearSelection = output<void>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('g6Host');
  private g6: Graph | null = null;
  private viewReady = false;
  private resizeObserver: ResizeObserver | null = null;
  private fitTimers: number[] = [];

  constructor() {
    effect(() => {
      const data = this.graph();
      if (!this.viewReady) {
        return;
      }
      void this.render(data);
    });

    effect(() => {
      const selectedId = this.selectedId();
      const highlightCritical = this.highlightCriticalPath();
      const data = this.graph();
      if (!this.g6 || !data) {
        return;
      }
      void this.applyHighlights(data, selectedId, highlightCritical);
    });
  }

  ngAfterViewInit(): void {
    const container = this.host().nativeElement;
    const { width, height } = container.getBoundingClientRect();

    this.g6 = new Graph({
      container,
      width: Math.max(width, 320),
      height: Math.max(height, 320),
      autoFit: 'view',
      padding: 48,
      animation: false,
      layout: {
        type: 'd3-force',
        preventOverlap: true,
        collide: { radius: 80 },
        link: { distance: 140 },
        manyBody: { strength: -420 },
        center: { strength: 0.08 },
      },
      node: {
        type: 'rect',
        style: {
          size: [132, 56],
          radius: 8,
          fill: '#ffffff',
          stroke: '#94a3b8',
          lineWidth: 2,
          labelText: (d) => (d.data?.['label'] as string) ?? '',
          labelFill: '#1f2937',
          labelFontSize: 11,
          labelPlacement: 'center',
          labelWordWrap: true,
          labelMaxWidth: 120,
          cursor: 'pointer',
        },
        state: {
          root: { stroke: '#2563eb', lineWidth: 3, fill: '#eff6ff' },
          selected: { stroke: '#0f766e', lineWidth: 3, fill: '#ecfdf5' },
          critical: { stroke: '#dc2626', fill: '#fef2f2' },
          dimmed: { opacity: 0.25 },
        },
      },
      edge: {
        type: 'quadratic',
        style: {
          stroke: (d) => (d.data?.['color'] as string) ?? '#94a3b8',
          lineWidth: 2,
          endArrow: true,
          labelText: (d) => (d.data?.['label'] as string) ?? '',
          labelFill: '#64748b',
          labelFontSize: 9,
          labelBackground: true,
          labelBackgroundFill: '#f8fafc',
          labelBackgroundOpacity: 0.9,
          labelPadding: [1, 4],
        },
        state: {
          critical: { stroke: '#dc2626', lineWidth: 3 },
          dimmed: { opacity: 0.2 },
        },
      },
      behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
    });

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

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.g6) {
        return;
      }
      const rect = container.getBoundingClientRect();
      this.g6.resize(Math.max(rect.width, 320), Math.max(rect.height, 320));
      void this.g6.fitView({ when: 'always', direction: 'both' });
    });
    this.resizeObserver.observe(container);

    this.viewReady = true;
    void this.render(this.graph());
  }

  ngOnDestroy(): void {
    this.clearFitTimers();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.g6?.destroy();
    this.g6 = null;
  }

  protected fit(): void {
    void this.g6?.fitView({ when: 'always', direction: 'both' });
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
    await this.applyHighlights(data, this.selectedId(), this.highlightCriticalPath());
    this.scheduleFit();
  }

  private scheduleFit(): void {
    for (const delay of [0, 50, 200, 500]) {
      const timer = window.setTimeout(() => {
        void this.g6?.fitView({ when: 'always', direction: 'both' });
      }, delay);
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
