import {
  Component,
  ContentChildren,
  QueryList,
  EventEmitter,
  Input,
  Output,
  OnDestroy,
  forwardRef,
  ElementRef,
  AfterContentInit,
  AfterViewChecked,
  NgZone,
} from '@angular/core';
import { SelectOptionComponent } from '../select-option/select-option.component';
import { Subscription, timer } from 'rxjs';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { isMobile } from 'is-mobile';

interface BasicSelectOption {
  name: string;
  value: any;
}

@Component({
  selector: 'app-select',
  templateUrl: './select.component.html',
  styleUrls: ['./select.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SelectComponent),
      multi: true,
    },
  ],
})
export class SelectComponent
  implements OnDestroy, ControlValueAccessor, AfterContentInit, AfterViewChecked {
  @Input() public placeholder?: string;
  @Input() public disabled?: boolean;
  public open = false;
  public text?: string;
  // TODO Make this a config option
  public readonly useNative = isMobile();
  public dropdownMaxHeight?: string;
  public dropBottom?: string;
  public basicOptions?: BasicSelectOption[];

  @ContentChildren(SelectOptionComponent)
  public set options(optionsRaw: QueryList<SelectOptionComponent>) {
    // Clear subscriptions to values
    this.resetSubscriptions();

    const options = Array.from(optionsRaw);
    this.clearHighlighted(true);
    this.optionsInternal = options;
    this.searchStrings = options.map(option => option.text.toLowerCase());
    this.clearHighlighted(true);
    this.selectedOptions = [];

    this.basicOptions = [];
    for (const option of options) {
      this.basicOptions.push({ name: option.text, value: option.value });
      // Set the selected state of each option.
      option.selected = this.valueInternal.includes(option.value);
      if (option.selected) {
        this.selectedOptions.push(option);
      }

      // Subscribe to the change for each.
      this.subscriptions.push(
        option.selectedChange.subscribe(selected => {
          let updated = false;
          if (!selected) {
            this.selectedOptions = this.selectedOptions.filter(item => option !== item);
            updated = true;
          } else if (!this.selectedOptions.includes(option)) {
            this.selectedOptions = [...this.selectedOptions, option];
            updated = true;
          }

          if (updated) {
            this.updateSelected();
            if (selected) {
              this.selected.emit(option.value);
            } else {
              this.deselected.emit(option.value);
            }
          }
        }),
      );
    }

    this.sortSelected();

    this.subscriptions.push(
      this.valueChange.subscribe(value => {
        if (this.onChange) {
          this.onChange(value);
        }
      }),
    );

    this.updateText();
  }

  @Input()
  public get value(): any[] {
    return this.valueInternal;
  }
  public set value(newValue: any[]) {
    this.writeValue(newValue);
  }
  @Output() public valueChange = new EventEmitter<any[]>();
  @Output() public selected = new EventEmitter<any>();
  @Output() public deselected = new EventEmitter<any>();

  // public to be accessed by the template.
  public selectedOptions: SelectOptionComponent[] = [];
  public optionsInternal?: SelectOptionComponent[];
  public inContent = false;
  public valueInternal: any[] = [];

  private subscriptions: Subscription[] = [];
  private onChange?: (values: any[]) => void;
  private onTouched?: () => void;
  private touched = false;
  private selfRef: ElementRef;
  private zone: NgZone;
  private lastTop?: number;
  private timeout?: any;
  private highlightIndex?: number;
  private searchStrings?: string[];
  private searchSubscription?: Subscription;
  private searchString?: string;

  public constructor(selfRef: ElementRef, zone: NgZone) {
    this.selfRef = selfRef;
    this.zone = zone;
  }

  public ngAfterContentInit(): void {
    this.onResize();
  }

  public ngAfterViewChecked(): void {
    const { top } = this.selfRef.nativeElement.getBoundingClientRect();
    const topAdjusted = Math.ceil(top);
    if (topAdjusted !== this.lastTop) {
      this.lastTop = topAdjusted;
      this.zone.run(() => {
        this.onResize();
      });
    }
  }

  public ngOnDestroy(): void {
    this.resetSubscriptions();

    this.touched = false;
    this.optionsInternal = undefined;
    this.selectedOptions = [];
    this.text = undefined;
    this.valueInternal = [];
    this.onChange = undefined;
    this.onTouched = undefined;
    this.inContent = false;

    if (this.timeout !== undefined) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
  }

  public onKeydown(source: string, event: any): void {
    if (source === 'select' && !this.open && event.key === ' ') {
      this.open = true;
      event.preventDefault();
    }
    if (this.open && event.key === 'Escape') {
      this.open = false;
      this.clearHighlighted(true);
      event.preventDefault();
    }

    if (!this.optionsInternal) {
      return;
    }

    if (event.key === 'ArrowDown') {
      let index = (this.highlightIndex === undefined ? -1 : this.highlightIndex) + 1;
      if (index >= this.optionsInternal.length) {
        index = 0;
      }
      this.updateHighlighted(index);
    } else if (event.key === 'ArrowUp') {
      let index =
        (this.highlightIndex === undefined ? this.optionsInternal.length : this.highlightIndex) - 1;
      if (index < 0) {
        index = this.optionsInternal.length - 1;
      }
      this.updateHighlighted(index);
    } else if (event.key === 'Enter') {
      if (this.highlightIndex !== undefined) {
        const option = this.optionsInternal[this.highlightIndex];
        option.onValueChange(!option.selected);
      }
    } else if (this.searchStrings) {
      const searchString = (this.searchString || '') + event.key.toLowerCase();
      const startIndex = this.searchStrings.findIndex(str => str.startsWith(searchString));
      const includeIndex = this.searchStrings.findIndex(str => str.includes(searchString));
      const foundIndex = startIndex >= 0 ? startIndex : includeIndex;
      if (foundIndex >= 0) {
        this.updateHighlighted(foundIndex);
      } else {
        this.clearHighlighted();
      }
      this.searchString = searchString;

      this.searchSubscription?.unsubscribe();
      this.searchSubscription = timer(1000).subscribe(() => {
        this.searchString = undefined;
      });
    }
  }

  private resetSubscriptions(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];

    this.searchSubscription?.unsubscribe();
    this.searchSubscription = undefined;
  }

  public onFocusOut(): void {
    if (!this.inContent) {
      this.open = false;
      this.clearHighlighted(true);
    }
  }

  public onResize(): void {
    const { top, height, bottom } = this.selfRef.nativeElement.getBoundingClientRect();
    const padding = height * 2;
    const dropdownStart = bottom;
    const dropupStart = top;

    const body = document.body;
    const html = document.documentElement;
    const windowHeight =
      Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, window.innerHeight) -
      padding;
    const spaceDropdown = windowHeight - dropdownStart;
    const spaceDropup = dropupStart - padding;

    const dropdown = spaceDropdown > spaceDropup;
    const maxHeight = Math.floor(dropdown ? spaceDropdown : spaceDropup);

    const dropdownMaxHeight = `${maxHeight}px`;
    const dropBottom = dropdown ? undefined : `${Math.floor(height)}px`;

    if (dropdownMaxHeight !== this.dropdownMaxHeight || dropBottom !== this.dropBottom) {
      if (this.timeout !== undefined) {
        clearTimeout(this.timeout);
        this.timeout = undefined;
      }
      this.timeout = setTimeout(() => {
        this.zone.run(() => {
          this.dropdownMaxHeight = dropdownMaxHeight;
          this.dropBottom = dropBottom;
        });
      }, 0);
    }
  }

  public writeValue(newValue: any[] | null | undefined): void {
    if (newValue === null || newValue === undefined || !Array.isArray(newValue)) {
      newValue = [];
    }
    if (newValue !== this.valueInternal) {
      this.valueInternal = newValue;
      this.selectedOptions = [];
      if (this.optionsInternal) {
        for (const option of Array.from(this.optionsInternal)) {
          option.selected = this.valueInternal.includes(option.value);
          if (option.selected) {
            this.selectedOptions.push(option);
          }
        }
        this.sortSelected();
      }
      this.touched = false;
      this.updateText();
    }
  }

  public registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  public registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  public setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  public onNativeSelectChange(values: any[]): void {
    if (!this.optionsInternal) {
      return;
    }

    const added = values.filter(val => !this.valueInternal.includes(val));
    const removed = this.valueInternal.filter(val => !values.includes(val));

    for (const option of this.optionsInternal) {
      option.selected = values.includes(option.value);
    }
    this.selectedOptions = this.optionsInternal.filter(opt => opt.selected);

    this.updateSelected();
    for (const val of added) {
      this.selected.emit(val);
    }
    for (const val of removed) {
      this.deselected.emit(val);
    }
  }

  public clearHighlighted(force?: boolean): void {
    if (this.highlightIndex !== undefined || force) {
      this.updateHighlighted(undefined);
    }
  }

  private updateHighlighted(index?: number): void {
    if (!this.optionsInternal) {
      return;
    }

    if (index === this.highlightIndex && index !== undefined) {
      return;
    }

    if (index === undefined) {
      this.highlightIndex = index;
      for (const item of this.optionsInternal) {
        item.highlighted = undefined;
      }
      return;
    }

    if (this.highlightIndex === undefined) {
      for (let i = 0; i < this.optionsInternal.length; i++) {
        this.optionsInternal[i].highlighted = index === i;
        if (index === i) {
          this.optionsInternal[i].scroll();
        }
      }
      this.highlightIndex = index;
      return;
    }

    this.optionsInternal[this.highlightIndex].highlighted = false;
    this.optionsInternal[index].highlighted = true;
    this.highlightIndex = index;
    this.optionsInternal[this.highlightIndex].scroll();
  }

  private updateSelected(): void {
    this.sortSelected();

    if (!this.touched && this.onTouched) {
      this.touched = true;
      this.onTouched();
    }

    this.valueInternal = this.selectedOptions.map(selected => selected.value);
    this.valueChange.next(this.valueInternal);
    this.updateText();
  }

  private sortSelected(): void {
    const options = this.optionsInternal;
    if (!options) {
      return;
    }

    this.selectedOptions.sort((a, b) => {
      return options.indexOf(a) - options.indexOf(b);
    });
  }

  private updateText(): void {
    if (this.selectedOptions.length === 0) {
      this.text = undefined;
    } else {
      this.text = this.selectedOptions.map(sel => sel.text).join(', ');
    }
  }
}
