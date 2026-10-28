import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { RouteReuseStrategy, provideRouter, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';
import { ReuseStrategy } from './reuse-strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })),
    // Match the old HttpClientModule's transport: keep XHR rather than
    // switching to FetchBackend, and withInterceptorsFromDi()-equivalent empty
    // interceptor state (no HTTP_INTERCEPTORS are registered in this app).
    provideHttpClient(withXhr()),
    { provide: RouteReuseStrategy, useClass: ReuseStrategy },
    // Zone event coalescing skips change-detection ticks when paired
    // emissions resolve within one frame; the gallery search chain boots
    // that way and components stay on their initial template until an
    // unrelated event ticks. Run one tick per cycle like pre-v22
    // behaviour.
    provideZoneChangeDetection({ eventCoalescing: false }),
  ],
};
