import { Component, computed, effect, signal } from '@angular/core';
import { RELATION_OPTIONS } from './constants/graph.constants';
import type { DependencyGraph, GraphEntity } from './entities/graph.entity';
import type { RelationType } from './enums/graph.enum';
import { GraphCanvas } from './graph/graph-canvas';
import { loadDependencyGraph } from './graph/load-dependency-graph';
import { buildMockGraph } from './graph/mock-graph';
import { NodeDetail } from './graph/node-detail';

@Component({
  selector: 'app-root',
  imports: [GraphCanvas, NodeDetail],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly depths = [1, 2, 3] as const;
  protected readonly relationOptions = RELATION_OPTIONS;
  protected readonly usingMockData = signal(true);

  protected readonly depth = signal<1 | 2 | 3>(2);
  protected readonly enabledRelations = signal<RelationType[]>(
    RELATION_OPTIONS.map((item) => item.value),
  );
  protected readonly highlightCriticalPath = signal(false);
  protected readonly selected = signal<GraphEntity | null>(null);

  protected readonly reloadToken = signal(0);
  private readonly loadedGraph = signal<DependencyGraph | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  private requestSeq = 0;

  constructor() {
    effect(() => {
      if (this.usingMockData()) {
        this.requestSeq += 1;
        this.loading.set(false);
        this.error.set(null);
        return;
      }
      const depth = this.depth();
      const relationTypes = this.enabledRelations();
      void this.reloadToken();
      void this.loadGraph(depth, relationTypes);
    });
  }

  protected readonly graph = computed(() => {
    if (this.usingMockData()) {
      void this.reloadToken();
      return buildMockGraph(this.depth(), this.enabledRelations());
    }
    return this.loadedGraph();
  });

  protected readonly focusTitle = computed(() => {
    const data = this.graph();
    if (!data) {
      return this.loading() ? '正在加载…' : '关系图';
    }
    const root = data.nodes.find((node) => node.id === data.rootId);
    if (!root) {
      return '关系图';
    }
    return [root.identifier, root.title].filter(Boolean).join(' · ') || root.id;
  });

  protected readonly stats = computed(() => {
    const data = this.graph();
    if (!data) {
      return null;
    }
    return {
      nodes: data.nodes.length,
      edges: data.edges.length,
      criticalLength: Math.max(data.criticalPath.length - 1, 0),
    };
  });

  protected readonly selectedIsRoot = computed(() => {
    const selected = this.selected();
    const data = this.graph();
    return !!selected && !!data && selected.id === data.rootId;
  });

  protected readonly selectedOnCritical = computed(() => {
    const selected = this.selected();
    const data = this.graph();
    return !!selected && !!data && data.criticalPath.includes(selected.id);
  });

  protected setDepth(value: 1 | 2 | 3): void {
    this.depth.set(value);
    this.selected.set(null);
  }

  protected toggleRelation(type: RelationType): void {
    const current = this.enabledRelations();
    if (current.includes(type)) {
      if (current.length === 1) {
        return;
      }
      this.enabledRelations.set(current.filter((item) => item !== type));
    } else {
      this.enabledRelations.set([...current, type]);
    }
    this.selected.set(null);
  }

  protected isRelationEnabled(type: RelationType): boolean {
    return this.enabledRelations().includes(type);
  }

  protected toggleMockData(): void {
    this.selected.set(null);
    this.usingMockData.update((value) => !value);
  }

  protected toggleCriticalPath(): void {
    this.highlightCriticalPath.update((value) => !value);
  }

  protected reload(): void {
    this.selected.set(null);
    this.reloadToken.update((value) => value + 1);
  }

  protected onSelectNode(item: GraphEntity): void {
    this.selected.set(item);
  }

  protected clearSelection(): void {
    this.selected.set(null);
  }

  private async loadGraph(depth: 1 | 2 | 3, relationTypes: RelationType[]): Promise<void> {
    const seq = ++this.requestSeq;
    this.loading.set(true);
    this.error.set(null);
    this.loadedGraph.set(null);

    try {
      const data = await loadDependencyGraph(depth, relationTypes);
      if (seq !== this.requestSeq) {
        return;
      }
      this.loadedGraph.set(data);
      this.loading.set(false);
    } catch (err) {
      if (seq !== this.requestSeq) {
        return;
      }
      this.loadedGraph.set(null);
      this.error.set(err instanceof Error ? err.message.trim() : String(err));
      this.loading.set(false);
    }
  }
}
