import { Injectable, ElementRef, EventEmitter } from '@angular/core';

// Having large numbers of IntersectionObserver's creates a lot of lag.
// So centralise it here.
@Injectable({
  providedIn: 'root',
})
export class IntersectionService {
  public readonly intersectionEmitter = new EventEmitter<Map<any, IntersectionObserverEntry>>();

  private intersectionObserver: IntersectionObserver;

  public constructor() {
    const options = {
      rootMargin: '50%',
      threshold: 0,
    };

    this.intersectionObserver = new IntersectionObserver((entries: IntersectionObserverEntry[]) => {
      const map = new Map<any, IntersectionObserverEntry>();
      for (const entry of entries) {
        map.set(entry.target, entry);
      }
      this.intersectionEmitter.emit(map);
    }, options);
  }

  public observe(element: ElementRef): void {
    this.intersectionObserver.observe(element.nativeElement);
  }

  public unobserve(element: ElementRef): void {
    this.intersectionObserver.unobserve(element.nativeElement);
  }
}
