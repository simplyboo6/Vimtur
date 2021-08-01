import {
  Component,
  Input,
  EventEmitter,
  Output,
  ElementRef,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { getUid } from 'app/shared/uid';

@Component({
  selector: 'app-select-option[value]',
  templateUrl: './select-option.component.html',
  styleUrls: ['./select-option.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectOptionComponent {
  public readonly uid = getUid();
  @Input() public value: any;
  @Input() public selected = false;
  @Input() public highlighted?: boolean;
  @Output() public selectedChange = new EventEmitter<boolean>();
  @Output() public highlightedEvent = new EventEmitter<void>();

  private elementRef: ElementRef;
  private changeDetectorRef: ChangeDetectorRef;

  public constructor(elementRef: ElementRef, changeDetectorRef: ChangeDetectorRef) {
    this.elementRef = elementRef;
    this.changeDetectorRef = changeDetectorRef;
  }

  public get text(): string {
    return this.elementRef.nativeElement.textContent.trim();
  }

  public setHighlighted(value: boolean): void {
    if (value !== this.highlighted) {
      this.highlighted = value;
      this.changeDetectorRef.detectChanges();
    }
  }

  public onValueChange(newValue: boolean): void {
    this.selected = newValue;
    this.selectedChange.emit(newValue);
  }

  public scroll(): void {
    this.elementRef.nativeElement.scrollIntoView({ block: 'nearest' });
  }
}
