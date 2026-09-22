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
import cytoscape, { type Core, type ElementDefinition, type NodeSingular } from 'cytoscape';
import {
  DependencyGraph,
  EDGE_COLORS,
  GraphWorkItem,
  workItemTypeName,
} from './graph.types';

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

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('cyHost');
  private cy: Core | null = null;
  private viewReady = false;
  private resizeObserver: ResizeObserver | null = null;
  private fitTimers: number[] = [];

  constructor() {
    effect(() => {
      const data = this.graph();
      if (!this.viewReady) {
        return;
      }
      this.render(data);
    });

    effect(() => {
      const selectedId = this.selectedId();
      const highlightCritical = this.highlightCriticalPath();
      const data = this.graph();
      if (!this.cy || !data) {
        return;
      }
      this.applyHighlights(data, selectedId, highlightCritical);
    });
  }

  ngAfterViewInit(): void {
    const container = this.host().nativeElement;

    this.cy = cytoscape({
      container,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'text-wrap': 'wrap',
            'text-max-width': '120px',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': 11,
            color: '#1f2937',
            'background-color': '#ffffff',
            'border-width': 2,
            'border-color': '#94a3b8',
            width: 132,
            height: 56,
            shape: 'round-rectangle',
            'overlay-padding': 4,
          },
        },
        {
          selector: 'node.root',
          style: {
            'border-color': '#2563eb',
            'border-width': 3,
            'background-color': '#eff6ff',
          },
        },
        {
          selector: 'node.selected',
          style: {
            'border-color': '#0f766e',
            'border-width': 3,
            'background-color': '#ecfdf5',
          },
        },
        {
          selector: 'node.critical',
          style: {
            'border-color': '#dc2626',
            'background-color': '#fef2f2',
          },
        },
        {
          selector: 'node.dimmed',
          style: {
            opacity: 0.25,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'line-color': 'data(color)',
            'target-arrow-color': 'data(color)',
            label: 'data(label)',
            'font-size': 9,
            color: '#64748b',
            'text-rotation': 'autorotate',
            'text-margin-y': -8,
          },
        },
        {
          selector: 'edge.critical',
          style: {
            width: 3,
            'line-color': '#dc2626',
            'target-arrow-color': '#dc2626',
          },
        },
        {
          selector: 'edge.dimmed',
          style: {
            opacity: 0.2,
          },
        },
      ],
      layout: { name: 'preset' },
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.2,
    });

    this.cy.on('tap', 'node', (event) => {
      const node = event.target as NodeSingular;
      const item = node.data('item') as GraphWorkItem;
      this.selectNode.emit(item);
    });

    this.cy.on('tap', (event) => {
      if (event.target === this.cy) {
        this.clearSelection.emit();
      }
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.cy?.resize();
      if (this.cy && this.cy.nodes().length > 0) {
        this.cy.fit(undefined, 48);
      }
    });
    this.resizeObserver.observe(container);

    this.viewReady = true;
    this.render(this.graph());
  }

  ngOnDestroy(): void {
    this.clearFitTimers();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.cy?.destroy();
    this.cy = null;
  }

  protected fit(): void {
    this.cy?.resize();
    this.cy?.fit(undefined, 48);
  }

  private render(data: DependencyGraph | null): void {
    if (!this.cy) {
      return;
    }

    this.clearFitTimers();
    this.cy.elements().remove();
    if (!data?.nodes.length) {
      return;
    }

    const elements: ElementDefinition[] = [
      ...data.nodes.map((item) => ({
        group: 'nodes' as const,
        data: {
          id: item.id,
          label: `${item.identifier ?? ''}\n${truncate(item.title ?? '未命名', 28)}\n${workItemTypeName(item)}`,
          item,
        },
        classes: item.id === data.rootId ? 'root' : '',
      })),
      ...data.edges.map((edge) => ({
        group: 'edges' as const,
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          color: EDGE_COLORS[edge.relationType] ?? '#94a3b8',
          relationType: edge.relationType,
        },
      })),
    ];

    this.cy.add(elements);
    this.cy.resize();
    this.cy
      .layout({
        name: 'cose',
        animate: false,
        randomize: true,
        padding: 48,
        componentSpacing: 80,
        nodeRepulsion: () => 14000,
        idealEdgeLength: () => 140,
        nestingFactor: 1.2,
        fit: true,
      })
      .run();

    this.applyHighlights(data, this.selectedId(), this.highlightCriticalPath());
    this.scheduleFit();
  }

  private scheduleFit(): void {
    // Modal / fullscreen host often settles size after first paint.
    for (const delay of [0, 50, 200, 500]) {
      const timer = window.setTimeout(() => {
        this.cy?.resize();
        this.cy?.fit(undefined, 48);
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

  private applyHighlights(
    data: DependencyGraph,
    selectedId: string | null,
    highlightCritical: boolean,
  ): void {
    if (!this.cy) {
      return;
    }

    const criticalSet = new Set(highlightCritical ? data.criticalPath : []);
    this.cy.nodes().forEach((node) => {
      node.removeClass('selected critical dimmed');
      if (node.id() === selectedId) {
        node.addClass('selected');
      }
      if (criticalSet.has(node.id())) {
        node.addClass('critical');
      }
      if (highlightCritical && !criticalSet.has(node.id())) {
        node.addClass('dimmed');
      }
    });

    this.cy.edges().forEach((edge) => {
      edge.removeClass('critical dimmed');
      const onCritical =
        criticalSet.has(edge.data('source')) &&
        criticalSet.has(edge.data('target')) &&
        edge.data('relationType') === 'block';
      if (highlightCritical && onCritical) {
        edge.addClass('critical');
      } else if (highlightCritical) {
        edge.addClass('dimmed');
      }
    });
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}
