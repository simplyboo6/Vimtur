import { Injectable } from '@angular/core';

// Keeps the last scroll position per route so the gallery can restore it when
// Angular's in-memory scrolling would otherwise jump back to the top.
@Injectable({
  providedIn: 'root',
})
export class ScrollMemoryService {
  private positions = new Map<string, number>();

  public remember(route: string, scrollTop: number): void {
    this.positions.set(route, scrollTop);
  }

  public recall(route: string): number | undefined {
    return this.positions.get(route);
  }

  public forget(route: string): void {
    this.positions.delete(route);
  }
}
