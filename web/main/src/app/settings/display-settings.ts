import { invoke } from '@pc-nexus/bridge';

export interface DisplaySetting {
  id: string;
  label: string;
  enabled: boolean;
}

/** 线条颜色：默认灰线，或按事项/关系类型色。 */
export type LineColorMode = 'default' | 'item';

/** 视图设置：数据开关 + 展示（线条颜色）。 */
export interface ViewSettings {
  settings: DisplaySetting[];
  lineColorMode: LineColorMode;
}

/** 数据配置项。enabled 只在读配置失败时使用，正常开闭以 resolver 为准。 */
export const DEFAULT_DISPLAY_SETTINGS: readonly DisplaySetting[] = [
  { id: 'parent', label: '父子关系', enabled: true },
  { id: 'relate', label: '关联关系', enabled: true },
  { id: 'product', label: '关联产品需求', enabled: true },
  { id: 'ticket', label: '关联工单', enabled: true },
  { id: 'test', label: '关联测试', enabled: true },
];

export const DEFAULT_LINE_COLOR_MODE: LineColorMode = 'default';

export function cloneDisplaySettings(settings: readonly DisplaySetting[]): DisplaySetting[] {
  return settings.map((item) => ({ ...item }));
}

export function cloneViewSettings(view: ViewSettings): ViewSettings {
  return {
    settings: cloneDisplaySettings(view.settings),
    lineColorMode: view.lineColorMode,
  };
}

/** 开闭以 resolver 返回的开关为准。请求失败时才退回页面默认项。 */
export function applySavedDisplaySettings(
  saved: Readonly<Record<string, boolean>> | null | undefined,
): DisplaySetting[] {
  return DEFAULT_DISPLAY_SETTINGS.map((item) => ({
    ...item,
    enabled: typeof saved?.[item.id] === 'boolean' ? saved[item.id] : item.enabled,
  }));
}

function readLineColorMode(value: unknown): LineColorMode {
  return value === 'item' ? 'item' : DEFAULT_LINE_COLOR_MODE;
}

export function applySavedViewSettings(
  saved: Readonly<Record<string, unknown>> | null | undefined,
): ViewSettings {
  const flags =
    saved && typeof saved === 'object'
      ? (Object.fromEntries(
          Object.entries(saved).filter(([, v]) => typeof v === 'boolean'),
        ) as Record<string, boolean>)
      : null;
  return {
    settings: applySavedDisplaySettings(flags),
    lineColorMode: readLineColorMode(saved?.['lineColorMode']),
  };
}

/** 读取当前用户的视图设置。没有记录时由 resolver 返回全部打开 + 默认色。 */
export async function loadViewSettings(): Promise<ViewSettings> {
  try {
    const saved = await invoke<undefined, Record<string, unknown>>('getDisplaySettings');
    return applySavedViewSettings(saved);
  } catch {
    return applySavedViewSettings(null);
  }
}

/** @deprecated 使用 loadViewSettings */
export async function loadDisplaySettings(): Promise<DisplaySetting[]> {
  return (await loadViewSettings()).settings;
}

/** 把当前开关与线条颜色写到当前用户名下。没有用户时后端不保存。 */
export function saveViewSettings(view: ViewSettings): Promise<void> {
  return invoke('saveDisplaySettings', {
    ...Object.fromEntries(view.settings.map((item) => [item.id, item.enabled])),
    lineColorMode: view.lineColorMode,
  });
}

/** @deprecated 使用 saveViewSettings */
export function saveDisplaySettings(settings: readonly DisplaySetting[]): Promise<void> {
  return saveViewSettings({ settings: [...settings], lineColorMode: DEFAULT_LINE_COLOR_MODE });
}

/** 数据配置开关覆盖的关系类型。未列入的关系始终展示。 */
export const DISPLAY_SETTING_RELATIONS: Record<string, readonly string[]> = {
  parent: ['parent', 'child'],
  relate: [
    'relate',
    'relate:work_item',
    'block',
    'blockedBy',
    'cause',
    'causedBy',
    'clone',
    'clonedBy',
    'mention',
    'duplicate',
  ],
  product: ['relate:idea'],
  ticket: ['relate:ticket'],
  test: ['relate:test_case'],
};

/** 这种关系是否展示。没有对应开关的关系始终展示。 */
export function isRelationShown(settings: readonly DisplaySetting[], relationType: string): boolean {
  for (const [id, types] of Object.entries(DISPLAY_SETTING_RELATIONS)) {
    if (!types.includes(relationType)) {
      continue;
    }
    return settings.some((item) => item.id === id && item.enabled);
  }
  return true;
}
