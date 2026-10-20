import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { dialog, realtime, view } from '@pc-nexus/bridge';
import { notify } from '@pc-nexus/capabilities';
import { ThyAction } from 'ngx-tethys/action';
import { ThyDialog, ThyDialogSizes } from 'ngx-tethys/dialog';
import { ThyContent, ThyHeader, ThyLayout } from 'ngx-tethys/layout';
import { ThyLoading } from 'ngx-tethys/loading';
import { ThyTooltipDirective } from 'ngx-tethys/tooltip';
import type { DependencyGraph } from './entities/graph.entity';
import { GraphCanvas } from './graph/graph-canvas';
import { ENTITY_CHANGED_CHANNEL, type EntityChangedPayload } from './realtime/entity-changed';
import { getDependencyGraph } from './services/graph.service';
import {
  applySavedDisplaySettings,
  cloneDisplaySettings,
  loadDisplaySettings,
  saveDisplaySettings,
  type DisplaySetting,
} from './settings/display-settings';
import { DisplaySettingsDialog } from './settings/display-settings-dialog';
import type { Side } from './utils/arrange-graph';
import { buildVisibleGraph } from './utils/expand-graph';
import { filterGraphByDisplaySettings } from './utils/graph.util';
import {
  applySavedGraphLayout,
  loadSavedGraphLayout,
  saveGraphLayout,
  type SavedGraphLayout,
  type SaveLayoutPayload,
} from './utils/saved-graph-layout';

/** 关系图关心的实体 kind，与后端 publish 对齐。 */
const TRACKED_KINDS = new Set(['work_item', 'idea', 'ticket', 'test_case', 'page']);

/** 工作项菜单弹窗。只有这个入口保留标题和关闭。 */
const ACTION_EXTENSION_TARGET = 'pcm:pjm:workitem:action';

/** 三种展示：详情 tab、菜单弹窗、从 tab 打开的全屏。 */
type GraphSurface = 'pending' | 'tab' | 'dialog' | 'fullscreen';

function graphSurface(
  dialogMode: boolean,
  extension?: {
    key?: string;
    target?: string;
    data?: { hostChrome?: boolean };
    modal?: { hostChrome?: boolean };
  },
): Exclude<GraphSurface, 'pending'> {
  if (!dialogMode) {
    return 'tab';
  }
  const openedFromTab = extension?.modal?.hostChrome === true || extension?.data?.hostChrome === true;
  const actionDialog =
    extension?.target === ACTION_EXTENSION_TARGET || extension?.key === 'pingcode-graphs';
  return actionDialog && !openedFromTab ? 'dialog' : 'fullscreen';
}

@Component({
  selector: 'app-root',
  imports: [
    ThyLayout,
    ThyHeader,
    ThyContent,
    ThyAction,
    ThyLoading,
    ThyTooltipDirective,
    GraphCanvas,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  /** 上下文回来之前保持 pending，避免页头和工具栏闪一下。 */
  protected readonly surface = signal<GraphSurface>('pending');
  protected readonly displaySettings = signal<DisplaySetting[]>(applySavedDisplaySettings(null));

  private readonly dialog = inject(ThyDialog);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly collapsedAnchors = signal<readonly string[]>([]);

  /** 用户级关系方位偏好，跨工作项共用 */
  protected readonly relationSides = signal<Record<string, Side>>({});

  /** 当前根的个人布局（含 fold 坐标）；在可见图生成后再 apply，才能套到 +N 占位上 */
  protected readonly savedLayout = signal<SavedGraphLayout | null>(null);

  /** 换根追溯后的工作项。空表示用打开页面时的当前工作项。 */
  private readonly traceWorkItemId = signal<string | null>(null);

  protected readonly source = signal<DependencyGraph | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  private requestSeq = 0;
  private silentRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly graph = computed(() => {
    const source = this.source();
    if (!source) {
      return null;
    }
    const filtered = filterGraphByDisplaySettings(source, this.displaySettings());
    const visible = buildVisibleGraph(filtered, new Set(this.collapsedAnchors()));
    // fold 节点在 buildVisibleGraph 之后才有，必须在此再套一层 saved
    return applySavedGraphLayout(visible, this.savedLayout());
  });

  constructor() {
    void this.bindViewMode();
    void this.reload();
    void this.subscribeEntityChanged();
    this.destroyRef.onDestroy(() => {
      if (this.silentRefreshTimer) {
        clearTimeout(this.silentRefreshTimer);
        this.silentRefreshTimer = null;
      }
    });
  }

  private async bindViewMode(): Promise<void> {
    const dialogMode = await view.isDialog().catch(() => false);
    const context = await view.getContext().catch(() => null);
    this.surface.set(graphSurface(dialogMode, context?.extension));
  }

  private async subscribeEntityChanged(): Promise<void> {
    try {
      const sub = await realtime.subscribe<EntityChangedPayload>(
        ENTITY_CHANGED_CHANNEL,
        (payload) => this.onEntityChanged(payload),
        { scope: 'global' },
      );
      this.destroyRef.onDestroy(() => sub.unsubscribe());
    } catch (error) {
      console.error('[graphs] realtime subscribe failed', error);
    }
  }

  private onEntityChanged(payload?: EntityChangedPayload): void {
    if (!payload) {
      return;
    }
    if (!TRACKED_KINDS.has(payload.kind)) {
      return;
    }
    const source = this.source();
    if (!source) {
      return;
    }
    const relevant =
      payload.nodeId === source.rootId || source.nodes.some((node) => node.id === payload.nodeId);
    if (!relevant) {
      return;
    }
    this.scheduleSilentRefresh();
  }

  /** 合并短时间内的多次实体变更，避免频繁拉图。 */
  private scheduleSilentRefresh(): void {
    if (this.silentRefreshTimer) {
      clearTimeout(this.silentRefreshTimer);
    }
    this.silentRefreshTimer = setTimeout(() => {
      this.silentRefreshTimer = null;
      void this.reload({ silent: true });
    }, 400);
  }

  private resetFoldState(): void {
    this.collapsedAnchors.set([]);
  }

  protected closeDialog(): void {
    view.close().catch(() => undefined);
  }

  /** 详情 tab 的全屏是再开一层全屏弹窗。 */
  protected toggleFullscreen(): void {
    const workitemId = this.traceWorkItemId();
    void dialog
      .open({
        resource: 'main',
        size: 'fullscreen',
        title: '关系可视化',
        context: {
          hostChrome: true,
          ...(workitemId ? { workitem: { id: workitemId } } : {}),
        },
      })
      .catch(() => undefined);
  }

  protected async reload(options?: { silent?: boolean }): Promise<void> {
    const silent = options?.silent === true;
    const seq = ++this.requestSeq;
    if (!silent) {
      this.resetFoldState();
      this.loading.set(true);
      this.error.set(null);
    }
    try {
      const traceId = this.traceWorkItemId();
      const dataPromise = getDependencyGraph(traceId ? { workitemId: traceId } : {});
      const [data, settings] = await Promise.all([dataPromise, loadDisplaySettings()]);
      if (seq !== this.requestSeq) {
        return;
      }
      const layout = await loadSavedGraphLayout(data.rootId);
      if (seq !== this.requestSeq) {
        return;
      }
      this.displaySettings.set(settings);
      if (silent) {
        this.error.set(null);
      }
      this.collapsedAnchors.set(layout?.collapsedKeys ?? []);
      this.savedLayout.set(layout);
      if (layout?.relationSides) {
        this.relationSides.set(layout.relationSides);
      }
      this.source.set(data);
    } catch (err) {
      if (seq !== this.requestSeq) {
        return;
      }
      if (!silent) {
        this.source.set(null);
      }
      this.error.set(err instanceof Error ? err.message.trim() : String(err));
    } finally {
      if (seq === this.requestSeq && !silent) {
        this.loading.set(false);
      }
    }
  }

  /** 保存当前根工作项下的坐标、收起状态；关系方位由画布一并带出。 */
  protected async onSaveLayout(payload: SaveLayoutPayload): Promise<void> {
    const rootId = this.source()?.rootId;
    if (!rootId) {
      return;
    }
    const layout: SavedGraphLayout = {
      rootId,
      positions: payload.positions,
      collapsedKeys: [...this.collapsedAnchors()],
      relationSides: payload.relationSides,
    };
    try {
      await saveGraphLayout(layout);
      this.relationSides.set(payload.relationSides);
      this.savedLayout.set(layout);
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
      void saveDisplaySettings(result).catch(() => undefined);
    });
  }
}
