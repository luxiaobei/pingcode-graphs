import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { notify } from '@pc-nexus/capabilities';
import { ThyAction } from 'ngx-tethys/action';
import { ThyButtonModule } from 'ngx-tethys/button';
import { ThyDialogFooter, ThyDialogRef } from 'ngx-tethys/dialog';
import {
  ThyContent,
  ThyHeader,
  ThyLayout,
  ThySidebar,
  ThySidebarContent,
  ThySidebarHeader,
} from 'ngx-tethys/layout';
import { ThyMenu, ThyMenuItem, ThyMenuItemName } from 'ngx-tethys/menu';
import { ThyRadio, ThyRadioGroup } from 'ngx-tethys/radio';
import { ThySwitchModule } from 'ngx-tethys/switch';
import {
  DEFAULT_LINE_COLOR_MODE,
  type DisplaySetting,
  type LineColorMode,
  type ViewSettings,
} from './display-settings';

type SettingsTab = 'data' | 'display';

@Component({
  selector: 'app-display-settings-dialog',
  imports: [
    FormsModule,
    ThyAction,
    ThyButtonModule,
    ThyDialogFooter,
    ThyLayout,
    ThySidebar,
    ThySidebarHeader,
    ThySidebarContent,
    ThyHeader,
    ThyContent,
    ThyMenu,
    ThyMenuItem,
    ThyMenuItemName,
    ThySwitchModule,
    ThyRadio,
    ThyRadioGroup,
  ],
  templateUrl: './display-settings-dialog.html',
  styleUrl: './display-settings-dialog.scss',
})
export class DisplaySettingsDialog {
  /** 由 ThyDialog initialState 在 ngOnInit 前写入 */
  settings: DisplaySetting[] = [];
  lineColorMode: LineColorMode = DEFAULT_LINE_COLOR_MODE;

  protected activeTab: SettingsTab = 'data';

  private readonly dialogRef = inject<ThyDialogRef<DisplaySettingsDialog, ViewSettings>>(ThyDialogRef);

  protected get panelTitle(): string {
    return this.activeTab === 'data' ? '数据配置' : '展示配置';
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected confirm(): void {
    if (!this.settings.some((item) => item.enabled)) {
      void notify.warning({ title: '至少开启一项' });
      return;
    }
    this.dialogRef.close({
      settings: this.settings.map((item) => ({ ...item })),
      lineColorMode: this.lineColorMode,
    });
  }
}
