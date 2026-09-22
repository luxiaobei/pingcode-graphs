import { Component, computed, resource, signal } from '@angular/core';
import { invoke, view } from '@pc-nexus/bridge';
import { GraphCanvas } from './graph/graph-canvas';
import { NodeDetail } from './graph/node-detail';
import {
  DependencyGraph,
  GetDependencyGraphPayload,
  GraphWorkItem,
  RELATION_OPTIONS,
  RelationType,
} from './graph/graph.types';

interface WorkitemActionData {
  workitem?: { id?: string; identifier?: string; title?: string };
  project?: { id?: string; name?: string };
}

@Component({
  selector: 'app-root',
  imports: [GraphCanvas, NodeDetail],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly depths = [1, 2, 3] as const;
  protected readonly relationOptions = RELATION_OPTIONS;

  protected readonly depth = signal<1 | 2 | 3>(2);
  protected readonly enabledRelations = signal<RelationType[]>(
    RELATION_OPTIONS.map((item) => item.value),
  );
  protected readonly highlightCriticalPath = signal(false);
  protected readonly selected = signal<GraphWorkItem | null>(null);
  protected readonly reloadToken = signal(0);

  private readonly context = resource({
    loader: () => view.getContext<WorkitemActionData>(),
  });

  protected readonly workitemId = computed(
    () => this.context.value()?.extension?.data?.workitem?.id,
  );

  protected readonly workitemTitle = computed(() => {
    const data = this.context.value()?.extension?.data?.workitem;
    return data?.title || data?.identifier || '工作项关系图';
  });

  protected readonly graphResource = resource({
    params: () => ({
      workitemId: this.workitemId(),
      depth: this.depth(),
      relationTypes: this.enabledRelations(),
      reloadToken: this.reloadToken(),
      contextReady: this.context.hasValue(),
    }),
    loader: async ({ params }) => {
      if (!params.contextReady || !params.workitemId) {
        return null;
      }

      const payload: GetDependencyGraphPayload = {
        workitemId: params.workitemId,
        depth: params.depth,
        relationTypes: params.relationTypes,
      };
      return invoke<GetDependencyGraphPayload, DependencyGraph>('getDependencyGraph', payload);
    },
  });

  protected readonly graph = computed(() => this.graphResource.value() ?? null);
  protected readonly loading = computed(
    () => this.context.isLoading() || this.graphResource.isLoading(),
  );
  protected readonly error = computed(() => {
    const err = this.context.error() ?? this.graphResource.error();
    return err ? String(err) : null;
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
    const graph = this.graph();
    return !!selected && !!graph && selected.id === graph.rootId;
  });

  protected readonly selectedOnCritical = computed(() => {
    const selected = this.selected();
    const graph = this.graph();
    return !!selected && !!graph && graph.criticalPath.includes(selected.id);
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
    this.reloadToken.update((value) => value + 1);
  }

  protected onSelectNode(item: GraphWorkItem): void {
    this.selected.set(item);
  }

  protected clearSelection(): void {
    this.selected.set(null);
  }
}
