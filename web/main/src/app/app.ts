import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { view } from '@pc-nexus/bridge';
import { ThyDialog, ThyDialogSizes } from 'ngx-tethys/dialog';
import { ThySwitchModule } from 'ngx-tethys/switch';
import type { DependencyGraph, GraphEntity } from './entities/graph.entity';
import { GraphCanvas } from './graph/graph-canvas';
import { MOCK_GRAPH } from './graph/mock-graph';
import { NodeDetail } from './graph/node-detail';
import { getDependencyGraph } from './services/graph.service';
import {
  applySavedDisplaySettings,
  cloneDisplaySettings,
  loadDisplaySettings,
  saveDisplaySettings,
  type DisplaySetting,
} from './settings/display-settings';
import { DisplaySettingsDialog } from './settings/display-settings-dialog';
import { buildVisibleGraph } from './utils/expand-graph';
import { filterGraphByDisplaySettings } from './utils/graph.util';

@Component({
  selector: 'app-root',
  imports: [FormsModule, ThySwitchModule, GraphCanvas, NodeDetail],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly usingMockData = signal(true);
  protected readonly showCanvas = signal(true);
  protected readonly displaySettings = signal<DisplaySetting[]>(applySavedDisplaySettings(null));

  private readonly dialog = inject(ThyDialog);

  protected readonly selected = signal<GraphEntity | null>(null);
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
    const filtered = filterGraphByDisplaySettings(source, this.displaySettings());
    return buildVisibleGraph(filtered, new Set(this.collapsedAnchors()));
  });

  protected readonly focusTitle = computed(() => {
    const data = this.graph();
    const root = data?.nodes.find((node) => node.id === data.rootId);
    return root ? `${root.identifier} · ${root.title}` : '关联关系图';
  });

  protected readonly selectedIsRoot = computed(() => {
    const selected = this.selected();
    const data = this.graph();
    return !!selected && !!data && selected.id === data.rootId;
  });

  constructor() {
    void this.reload();
  }

  private resetFoldState(): void {
    this.collapsedAnchors.set([]);
  }

  /** 卸掉再挂上画布，让展示配置和手动刷新走同一套初次布局。 */
  private remountCanvas(): void {
    this.showCanvas.set(false);
    setTimeout(() => this.showCanvas.set(true));
  }

  protected setUsingMockData(useMock: boolean): void {
    if (useMock === this.usingMockData()) {
      return;
    }
    this.usingMockData.set(useMock);
    void this.reload();
  }

  protected closeDialog(): void {
    view.close().catch(() => undefined);
  }

  protected async reload(): Promise<void> {
    const seq = ++this.requestSeq;
    this.selected.set(null);
    this.resetFoldState();
    this.loading.set(true);
    this.error.set(null);
    try {
      const dataPromise = this.usingMockData()
        ? Promise.resolve(structuredClone(MOCK_GRAPH))
        : getDependencyGraph();
      const [data, settings] = await Promise.all([dataPromise, loadDisplaySettings()]);
      if (seq !== this.requestSeq) {
        return;
      }
      this.displaySettings.set(settings);
      this.source.set(data);
    } catch (err) {
      if (seq !== this.requestSeq) {
        return;
      }
      this.source.set(null);
      this.error.set(err instanceof Error ? err.message.trim() : String(err));
    } finally {
      if (seq === this.requestSeq) {
        this.loading.set(false);
      }
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
    this.collapsedAnchors.update((list) => {
      if (node.expandToggle === 'collapsed') {
        return list.filter((id) => id !== anchorId);
      }
      return list.includes(anchorId) ? list : [...list, anchorId];
    });
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
      this.resetFoldState();
      this.selected.set(null);
      this.remountCanvas();
      void saveDisplaySettings(result).catch(() => undefined);
    });
  }
}
