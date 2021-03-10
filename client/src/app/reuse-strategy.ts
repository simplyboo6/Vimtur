import { RouteReuseStrategy, ActivatedRouteSnapshot, DetachedRouteHandle } from '@angular/router';
import { Injectable } from '@angular/core';

@Injectable()
export class ReuseStrategy implements RouteReuseStrategy {
  private storedRoutes = new Map<string, DetachedRouteHandle>();

  public shouldDetach(route: ActivatedRouteSnapshot): boolean {
    if (!route.routeConfig?.path) {
      return false;
    }
    return route.routeConfig.path === 'playlists';
  }

  public store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle): void {
    if (route.routeConfig?.path) {
      this.storedRoutes.set(route.routeConfig.path, handle);
    }
  }

  public shouldAttach(route: ActivatedRouteSnapshot): boolean {
    if (!route.routeConfig?.path) {
      return false;
    }
    return Boolean(route.routeConfig && this.storedRoutes.get(route.routeConfig.path));
  }

  public retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    if (!route.routeConfig?.path) {
      return null;
    }
    return this.storedRoutes.get(route.routeConfig.path) || null;
  }

  public shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    return future.routeConfig === curr.routeConfig;
  }
}
