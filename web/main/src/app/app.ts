import { Component, computed, signal } from '@angular/core';
import { GraphCanvas } from './graph/graph-canvas';
import { NodeDetail } from './graph/node-detail';
import { buildMockGraph } from './graph/mock-graph';
import {
  GraphWorkItem,
  RELATION_OPTIONS,
  RelationType,
} from './graph/graph.types';

@Component({
  selector: 'app-root',
  imports: [GraphCanvas, NodeDetail],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly depths = [1, 2, 3] as const;
  protected readonly relationOptions = RELATION_OPTIONS;
  protected readonly usingMockData = true;

  protected readonly depth = signal<1 | 2 | 3>(2);
  protected readonly enabledRelations = signal<RelationType[]>(
    RELATION_OPTIONS.map((item) => item.value),
  );
  protected readonly highlightCriticalPath = signal(false);
  protected readonly selected = signal<GraphWorkItem | null>(null);

  protected readonly reloadToken = signal(0);

  protected readonly workitemTitle = computed(() => {
    const root = this.graph().nodes.find((node) => node.id === this.graph().rootId);
    return root ? `${root.identifier} · ${root.title}` : '工作项关系图（模拟数据）';
  });

  protected readonly graph = computed(() => {
    // Depend on reloadToken so refresh forces a new graph reference.
    void this.reloadToken();
    return buildMockGraph(this.depth(), this.enabledRelations());
  });

  protected readonly loading = computed(() => false);
  protected readonly error = computed(() => null);

  protected readonly stats = computed(() => {
    const data = this.graph();
    return {
      nodes: data.nodes.length,
      edges: data.edges.length,
      criticalLength: Math.max(data.criticalPath.length - 1, 0),
    };
  });

  protected readonly selectedIsRoot = computed(() => {
    const selected = this.selected();
    return !!selected && selected.id === this.graph().rootId;
  });

  protected readonly selectedOnCritical = computed(() => {
    const selected = this.selected();
    return !!selected && this.graph().criticalPath.includes(selected.id);
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

  protected toggleCriticalPath(): void {
    this.highlightCriticalPath.update((value) => !value);
  }

  protected reload(): void {
    this.selected.set(null);
    this.reloadToken.update((value) => value + 1);
  }

  protected onSelectNode(item: GraphWorkItem): void {
    this.selected.set(item);
  }

  protected clearSelection(): void {
    this.selected.set(null);
  }
}
