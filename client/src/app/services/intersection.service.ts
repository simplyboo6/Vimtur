import { Injectable, ElementRef, EventEmitter } from '@angular/core';

// Having large numbers of IntersectionObserver's creates a lot of lag.
// So centralise it here.
@Injectable({
  providedIn: 'root',
})
export class IntersectionService {
  public readonly intersectionEmitter = new EventEmitter<Map<any, IntersectionObserverEntry>>();

  private intersectionObserver: IntersectionObserver;
  private intersectionObserverFull: IntersectionObserver;

  public constructor() {
    this.intersectionObserver = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => {
        const map = new Map<any, IntersectionObserverEntry>();
        for (const entry of entries) {
          map.set(entry.target, entry);
        }
        this.intersectionEmitter.emit(map);
      },
      {
        // When even 1 pixel is visible.
        rootMargin: '50%',
        threshold: 0,
      },
    );

    this.intersectionObserverFull = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => {
        const map = new Map<any, IntersectionObserverEntry>();
        for (const entry of entries) {
          map.set(entry.target, entry);
        }
        this.intersectionEmitter.emit(map);
      },
      {
        // When all pixels are visible.
        rootMargin: '0px',
        threshold: 1,
      },
    );
  }

  public observe(element: ElementRef, fullyVisible = false): void {
    if (fullyVisible) {
      this.intersectionObserverFull.observe(element.nativeElement);
    } else {
      this.intersectionObserver.observe(element.nativeElement);
    }
  }

  public unobserve(element: ElementRef): void {
    this.intersectionObserver.unobserve(element.nativeElement);
    this.intersectionObserverFull.unobserve(element.nativeElement);
  }
}
