import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { RouteReuseStrategy, provideRouter, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';
import { ReuseStrategy } from './reuse-strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })),
    // FetchBackend is Angular's default transport now (withFetch() is deprecated
    // as unnecessary). No HTTP_INTERCEPTORS are registered, so the chain is just
    // Angular's built-in XSRF handler and withInterceptorsFromDi() isn't needed.
    provideHttpClient(),
    { provide: RouteReuseStrategy, useClass: ReuseStrategy },
    // Since Angular 21 bootstrapping is zoneless by default (NoopNgZone, so
    // nothing notifies the change-detection scheduler about async work) and
    // this app still relies on implicit Zone ticks: raw service/HTTP
    // subscription callbacks assign component fields without markForCheck(),
    // so nothing schedules a tick and fresh loads wedge on the initial
    // Loading template (see #133). Keep until the boot chain is signal-safe;
    // also paired with the zone.js import in polyfills.ts. eventCoalescing
    // defaults to false, matching pre-v22 behaviour.
    provideZoneChangeDetection(),
  ],
};
