import { Component, Output, EventEmitter, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { IntersectionService } from 'services/intersection.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-lazy',
  templateUrl: './lazy.component.html',
  styleUrls: [],
})
export class LazyComponent implements OnDestroy {
  @Output() public readonly loadStateChange = new EventEmitter<boolean>();

  private intersectionService: IntersectionService;
  private lazyRootInternal?: ElementRef;
  private intersectionSubscription?: Subscription;

  @ViewChild('lazyRoot') public set lazyRoot(lazyRoot: ElementRef | undefined) {
    this.ngOnDestroy();
    this.lazyRootInternal = lazyRoot;

    if (lazyRoot) {
      this.intersectionSubscription = this.intersectionService.intersectionEmitter.subscribe(entries => {
        if (!this.lazyRootInternal) {
          return;
        }

        const found = entries.get(this.lazyRootInternal.nativeElement);
        if (found) {
          this.loadStateChange.emit(found.isIntersecting);
        }
      });

      this.intersectionService.observe(lazyRoot);
    }
  }

  public constructor(intersectionService: IntersectionService) {
    this.intersectionService = intersectionService;
  }

  public ngOnDestroy(): void {
    if (this.intersectionSubscription) {
      this.intersectionSubscription.unsubscribe();
      this.intersectionSubscription = undefined;
    }
    if (this.lazyRootInternal) {
      this.intersectionService.unobserve(this.lazyRootInternal);
    }
  }
}
