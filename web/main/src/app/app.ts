import { Component, computed, signal } from '@angular/core';
import { RELATION_OPTIONS } from './constants/graph.constants';
import type { DependencyGraph, GraphEntity } from './entities/graph.entity';
import { DEFAULT_RELATION_TYPES, type RelationType } from './enums/graph.enum';
import { GraphCanvas } from './graph/graph-canvas';
import { loadDependencyGraph } from './graph/load-dependency-graph';
import { NodeDetail } from './graph/node-detail';
import { getDependencyGraph } from './services/graph.service';
import { buildVisibleGraph } from './utils/expand-graph';
import { filterGraphByRelations } from './utils/graph.util';

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
  protected readonly expandedAnchors = signal<readonly string[]>([]);
  protected readonly collapsedAnchors = signal<readonly string[]>([]);

  protected readonly source = signal<DependencyGraph | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  private requestSeq = 0;

  protected readonly graph = computed(() => {
    const source = this.source();
    if (!source) {
      return null;
    }
    const filtered = filterGraphByRelations(source, this.enabledRelations());
    return buildVisibleGraph(filtered, this.depth(), {
      expandedIds: new Set(this.expandedAnchors()),
      collapsedIds: new Set(this.collapsedAnchors()),
    });
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

  constructor() {
    void this.reload();
  }

  private resetFoldState(): void {
    this.expandedAnchors.set([]);
    this.collapsedAnchors.set([]);
  }

  protected setDepth(value: 1 | 2 | 3): void {
    this.depth.set(value);
    this.resetFoldState();
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
    this.resetFoldState();
    this.selected.set(null);
  }

  protected isRelationEnabled(type: RelationType): boolean {
    return this.enabledRelations().includes(type);
  }

  protected toggleMockData(): void {
    this.selected.set(null);
    this.usingMockData.update((value) => !value);
    void this.reload();
  }

  protected toggleCriticalPath(): void {
    this.highlightCriticalPath.update((value) => !value);
  }

  protected async reload(): Promise<void> {
    const seq = ++this.requestSeq;
    this.selected.set(null);
    this.resetFoldState();
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = this.usingMockData()
        ? await getDependencyGraph()
        : await loadDependencyGraph(3, [...DEFAULT_RELATION_TYPES]);
      if (seq !== this.requestSeq) {
        return;
      }
      this.source.set(data);
      this.loading.set(false);
    } catch (err) {
      if (seq !== this.requestSeq) {
        return;
      }
      this.source.set(null);
      this.error.set(err instanceof Error ? err.message.trim() : String(err));
      this.loading.set(false);
    }
  }

  protected onSelectNode(item: GraphEntity): void {
    this.selected.set(item);
  }

  protected clearSelection(): void {
    this.selected.set(null);
  }

  protected onToggleExpand(anchorId: string): void {
    const node = this.graph()?.nodes.find((item) => item.id === anchorId);
    if (!node?.expandToggle) {
      return;
    }
    if (node.expandToggle === 'collapsed') {
      this.collapsedAnchors.update((list) => list.filter((id) => id !== anchorId));
      this.expandedAnchors.update((list) =>
        list.includes(anchorId) ? list : [...list, anchorId],
      );
    } else {
      this.expandedAnchors.update((list) => list.filter((id) => id !== anchorId));
      this.collapsedAnchors.update((list) =>
        list.includes(anchorId) ? list : [...list, anchorId],
      );
    }
    this.selected.set(null);
  }
}
