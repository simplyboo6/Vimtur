import { enableProdMode } from '@angular/core';
import { bootstrapApplication, enableDebugTools } from '@angular/platform-browser';

import { AppComponent } from './app/components/app/app.component';
import { appConfig } from './app/app.config';
import { environment } from './environments/environment';

if (environment.production) {
  enableProdMode();
}
bootstrapApplication(AppComponent, appConfig)
  .then(applicationRef => {
    // allows to run `ng.profiler.timeChangeDetection();`
    if (!environment.production) {
      enableDebugTools(applicationRef.components[0]);
    }
  })
  // Dev-serve needs console.log so the error isn't swallowed by the HMR overlay.
  .catch(err => (environment.production ? console.error : console.log)(err));
