import { Subscription } from 'rxjs';
import { Directive, ElementRef, EventEmitter, OnInit, Output, OnDestroy } from '@angular/core';
import { ResizeService } from 'services/resize.service';

@Directive({
  selector: '[appResized]',
})
export class ResizedDirective implements OnInit, OnDestroy {
  @Output()
  public readonly resized = new EventEmitter<void>();

  private resizeService: ResizeService;
  private element: ElementRef;
  private subscription?: Subscription;

  public constructor(resizeService: ResizeService, element: ElementRef) {
    this.resizeService = resizeService;
    this.element = element;
  }

  public ngOnInit(): void {
    this.subscription?.unsubscribe();
    this.subscription = this.resizeService.resizeEmitter.subscribe(entries => {
      const found = entries.get(this.element.nativeElement);
      if (found) {
        this.resized.emit();
      }
    });
    this.resizeService.observe(this.element);
  }

  public ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }
}
