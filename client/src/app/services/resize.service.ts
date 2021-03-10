import { Injectable, ElementRef, EventEmitter } from '@angular/core';
import ResizeObserver from 'resize-observer-polyfill';

@Injectable({
  providedIn: 'root',
})
export class ResizeService {
  public readonly resizeEmitter = new EventEmitter<Map<any, ResizeObserverEntry>>();

  private resizeObserver: ResizeObserver;

  public constructor() {
    this.resizeObserver = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const map = new Map<any, ResizeObserverEntry>();
      for (const entry of entries) {
        map.set(entry.target, entry);
      }
      this.resizeEmitter.emit(map);
    });
  }

  public observe(element: ElementRef): void {
    this.resizeObserver.observe(element.nativeElement);
  }

  public unobserve(element: ElementRef): void {
    this.resizeObserver.unobserve(element.nativeElement);
  }
}
