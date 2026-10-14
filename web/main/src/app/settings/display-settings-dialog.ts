import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { notify } from '@pc-nexus/capabilities';
import { ThyButtonModule } from 'ngx-tethys/button';
import { ThyDialogBody, ThyDialogFooter, ThyDialogHeader, ThyDialogRef } from 'ngx-tethys/dialog';
import { ThySwitchModule } from 'ngx-tethys/switch';
import type { DisplaySetting } from './display-settings';

@Component({
  selector: 'app-display-settings-dialog',
  imports: [FormsModule, ThySwitchModule, ThyButtonModule, ThyDialogHeader, ThyDialogBody, ThyDialogFooter],
  templateUrl: './display-settings-dialog.html',
  styleUrl: './display-settings-dialog.scss',
})
export class DisplaySettingsDialog {
  /** 由 ThyDialog initialState 在 ngOnInit 前写入 */
  settings: DisplaySetting[] = [];

  private readonly dialogRef = inject<ThyDialogRef<DisplaySettingsDialog, DisplaySetting[]>>(ThyDialogRef);

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected confirm(): void {
    if (!this.settings.some((item) => item.enabled)) {
      void notify.warning({ title: '至少开启一项' });
      return;
    }
    this.dialogRef.close(this.settings.map((item) => ({ ...item })));
  }
}
