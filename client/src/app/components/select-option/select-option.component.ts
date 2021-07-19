import { Component, Input, EventEmitter, Output, ElementRef } from '@angular/core';
import { getUid } from 'app/shared/uid';

@Component({
  selector: 'app-select-option[value]',
  templateUrl: './select-option.component.html',
  styleUrls: ['./select-option.component.scss'],
})
export class SelectOptionComponent {
  public readonly uid = getUid();
  @Input() public value: any;
  @Input() public selected = false;
  @Output() public selectedChange = new EventEmitter<boolean>();

  private elementRef: ElementRef;

  public constructor(elementRef: ElementRef) {
    this.elementRef = elementRef;
  }

  public get text(): string {
    return this.elementRef.nativeElement.textContent.trim();
  }

  public onValueChange(newValue: boolean): void {
    this.selected = newValue;
    this.selectedChange.emit(newValue);
  }
}
