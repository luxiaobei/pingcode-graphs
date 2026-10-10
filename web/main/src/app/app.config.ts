import { provideHttpClient } from '@angular/common/http';
import {
  ApplicationConfig,
  importProvidersFrom,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideTethys } from 'ngx-tethys/core';
import { ThyDialogModule } from 'ngx-tethys/dialog';
import { ThyIconRegistry } from 'ngx-tethys/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAnimations(),
    provideHttpClient(),
    provideTethys(),
    importProvidersFrom(ThyDialogModule),
    provideAppInitializer(() => {
      const iconRegistry = inject(ThyIconRegistry);
      const domSanitizer = inject(DomSanitizer);
      iconRegistry.addSvgIconSet(
        domSanitizer.bypassSecurityTrustResourceUrl('assets/icons/svg/sprite.defs.svg'),
      );
    }),
  ],
};
