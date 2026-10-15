import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { view } from '@pc-nexus/bridge';
import { notify } from '@pc-nexus/capabilities';
import { ThyAction } from 'ngx-tethys/action';
import { ThyDialog, ThyDialogSizes } from 'ngx-tethys/dialog';
import { ThyDivider } from 'ngx-tethys/divider';
import { ThyContent, ThyHeader, ThyLayout } from 'ngx-tethys/layout';
import { ThySwitchModule } from 'ngx-tethys/switch';
import { ThyTooltipDirective } from 'ngx-tethys/tooltip';
import type { DependencyGraph } from './entities/graph.entity';
import { GraphCanvas } from './graph/graph-canvas';
import { mockGraphFrom } from './graph/mock-graph';
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
import {
  applySavedGraphLayout,
  loadSavedGraphLayout,
  saveGraphLayout,
  type SavedGraphLayout,
} from './utils/saved-graph-layout';
import { filterGraphByDisplaySettings } from './utils/graph.util';

@Component({
  selector: 'app-root',
  imports: [
    FormsModule,
    ThyLayout,
    ThyHeader,
    ThyContent,
    ThyAction,
    ThyDivider,
    ThySwitchModule,
    ThyTooltipDirective,
    GraphCanvas,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly usingMockData = signal(true);
  protected readonly showCanvas = signal(true);
  protected readonly displaySettings = signal<DisplaySetting[]>(applySavedDisplaySettings(null));

  private readonly dialog = inject(ThyDialog);

  protected readonly collapsedAnchors = signal<readonly string[]>([]);

  /** 换根追溯后的工作项。空表示用打开页面时的当前工作项。 */
  private readonly traceWorkItemId = signal<string | null>(null);

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

  constructor() {
    void this.reload();
  }

  private resetFoldState(): void {
    this.collapsedAnchors.set([]);
  }

  /** 卸掉再挂上画布，让展示配置变更走同一套初次布局。 */
  private remountCanvas(): void {
    this.showCanvas.set(false);
    setTimeout(() => this.showCanvas.set(true));
  }

  protected setUsingMockData(useMock: boolean): void {
    if (useMock === this.usingMockData()) {
      return;
    }
    this.usingMockData.set(useMock);
    this.traceWorkItemId.set(null);
    void this.reload();
  }

  protected closeDialog(): void {
    view.close().catch(() => undefined);
  }

  protected async reload(): Promise<void> {
    const seq = ++this.requestSeq;
    this.resetFoldState();
    this.loading.set(true);
    this.error.set(null);
    try {
      const traceId = this.traceWorkItemId();
      const dataPromise = this.usingMockData()
        ? Promise.resolve(mockGraphFrom(traceId))
        : getDependencyGraph(traceId ? { workitemId: traceId } : {});
      const [data, settings] = await Promise.all([dataPromise, loadDisplaySettings()]);
      if (seq !== this.requestSeq) {
        return;
      }
      const layout = await loadSavedGraphLayout(data.rootId);
      if (seq !== this.requestSeq) {
        return;
      }
      this.displaySettings.set(settings);
      this.collapsedAnchors.set(layout?.collapsedKeys ?? []);
      this.source.set(applySavedGraphLayout(data, layout));
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

  /** 保存当前根工作项下的坐标与收起状态。 */
  protected async onSaveLayout(positions: Record<string, { x: number; y: number }>): Promise<void> {
    const rootId = this.source()?.rootId;
    if (!rootId) {
      return;
    }
    const layout: SavedGraphLayout = {
      rootId,
      positions,
      collapsedKeys: [...this.collapsedAnchors()],
    };
    try {
      await saveGraphLayout(layout);
      this.source.update((source) => (source ? applySavedGraphLayout(source, layout) : source));
      void notify.success({ title: '保存成功' });
    } catch {
      void notify.error({ title: '保存失败' });
    }
  }

  protected onRetrace(workItemId: string): void {
    if (!workItemId || workItemId === this.source()?.rootId) {
      return;
    }
    this.traceWorkItemId.set(workItemId);
    void this.reload();
  }

  protected onToggleExpand(key: string): void {
    this.collapsedAnchors.update((list) =>
      list.includes(key) ? list.filter((id) => id !== key) : [...list, key],
    );
  }

  protected openSettings(): void {
    const dialogRef = this.dialog.open(DisplaySettingsDialog, {
      size: ThyDialogSizes.md,
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
      this.remountCanvas();
      void saveDisplaySettings(result).catch(() => undefined);
    });
  }
}
