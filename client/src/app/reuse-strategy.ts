import { RouteReuseStrategy, ActivatedRouteSnapshot, DetachedRouteHandle } from '@angular/router';
import { Injectable } from "@angular/core";

@Injectable()
export class ReuseStrategy implements RouteReuseStrategy {
  private storedRoutes = new Map<string, DetachedRouteHandle>();

  public shouldDetach(route: ActivatedRouteSnapshot): boolean {
    return route.routeConfig.path === 'playlists';
  }

  public store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle): void {
    console.log('store', route.routeConfig.path);
    this.storedRoutes.set(route.routeConfig.path, handle);
  }

  public shouldAttach(route: ActivatedRouteSnapshot): boolean {
    return Boolean(route.routeConfig && this.storedRoutes.get(route.routeConfig.path));
  }

  public retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle {
    return this.storedRoutes.get(route.routeConfig.path);
  }

  public shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    return future.routeConfig === curr.routeConfig;
  }
}
