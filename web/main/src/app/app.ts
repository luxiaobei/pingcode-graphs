import { Component, computed, inject, signal } from '@angular/core';
import { view } from '@pc-nexus/bridge';
import { ThyDialog, ThyDialogSizes } from 'ngx-tethys/dialog';
import { RELATION_OPTIONS } from './constants/graph.constants';
import type { DependencyGraph, GraphEntity } from './entities/graph.entity';
import type { RelationType } from './enums/graph.enum';
import { GraphCanvas } from './graph/graph-canvas';
import { NodeDetail } from './graph/node-detail';
import { getDependencyGraph, USING_MOCK_GRAPH } from './services/graph.service';
import {
  cloneDisplaySettings,
  DEFAULT_DISPLAY_SETTINGS,
  type DisplaySetting,
} from './settings/display-settings';
import { DisplaySettingsDialog } from './settings/display-settings-dialog';
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
  protected readonly usingMockData = USING_MOCK_GRAPH;
  protected readonly displaySettings = signal<DisplaySetting[]>(
    cloneDisplaySettings(DEFAULT_DISPLAY_SETTINGS),
  );

  private readonly dialog = inject(ThyDialog);

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
    const root = data?.nodes.find((node) => node.id === data.rootId);
    return root ? `${root.identifier} · ${root.title}` : '关联关系图';
  });

  protected readonly stats = computed(() => {
    const data = this.graph();
    if (!data) {
      return { nodes: 0, edges: 0, criticalLength: 0 };
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

  protected toggleCriticalPath(): void {
    this.highlightCriticalPath.update((value) => !value);
  }

  protected closeDialog(): void {
    view.close().catch(() => undefined);
  }

  protected async reload(): Promise<void> {
    this.selected.set(null);
    this.resetFoldState();
    this.loading.set(true);
    this.error.set(null);
    try {
      this.source.set(
        await getDependencyGraph({
          depth: 3,
          relationTypes: [...this.enabledRelations()],
        }),
      );
    } catch (err) {
      this.source.set(null);
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
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

  protected openSettings(): void {
    const dialogRef = this.dialog.open(DisplaySettingsDialog, {
      size: ThyDialogSizes.sm,
      initialState: {
        settings: cloneDisplaySettings(this.displaySettings()),
      },
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (!Array.isArray(result)) {
        return;
      }
      this.displaySettings.set(result);
    });
  }
}
