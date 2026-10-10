export interface DisplaySetting {
  id: string;
  label: string;
  enabled: boolean;
}

/** 展示配置默认项，与关系图设置弹窗一致 */
export const DEFAULT_DISPLAY_SETTINGS: readonly DisplaySetting[] = [
  { id: 'parent', label: '父子关系', enabled: true },
  { id: 'relate', label: '关联关系', enabled: true },
  { id: 'dependency', label: '依赖关系', enabled: false },
  { id: 'product', label: '关联产品需求', enabled: false },
  { id: 'ticket', label: '关联工单', enabled: false },
  { id: 'test', label: '关联测试', enabled: false },
  { id: 'objective', label: '关联目标', enabled: false },
];

export function cloneDisplaySettings(settings: readonly DisplaySetting[]): DisplaySetting[] {
  return settings.map((item) => ({ ...item }));
}
