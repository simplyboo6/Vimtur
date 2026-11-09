import { ChangeDetectionStrategy, Component, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from 'services/config.service';
import { SelectComponent } from './select.component';
import { SelectOptionComponent } from '../select-option/select-option.component';

interface TestOption {
  name: string;
  value: string;
}

@Component({
  template: `
    <app-select [placeholder]="placeholder">
      <app-select-option value="alpha">Alpha</app-select-option>
      <app-select-option value="beta">Beta</app-select-option>
      <app-select-option value="charlie">Charlie</app-select-option>
    </app-select>
  `,
  imports: [SelectComponent, SelectOptionComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
})
class StaticHostComponent {
  public placeholder = '+ Items';
}

@Component({
  template: `
    <app-select placeholder="+ Items">
      @for (option of options; track option.value) {
        <app-select-option [value]="option.value">{{ option.name }}</app-select-option>
      }
    </app-select>
  `,
  imports: [SelectComponent, SelectOptionComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
})
class DynamicHostComponent {
  public options: TestOption[] = [{ name: 'Alpha', value: 'alpha' }];
}

@Component({
  template: `
    <app-select [(value)]="value" (created)="onCreated($event)" [creatable]="true" placeholder="+ Items">
      @for (option of options; track option.value) {
        <app-select-option [value]="option.value">{{ option.name }}</app-select-option>
      }
    </app-select>
  `,
  imports: [SelectComponent, SelectOptionComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
})
class CreateHostComponent {
  // Display text and value match here, as they do for tags and actors.
  public options: TestOption[] = [
    { name: 'Alpha', value: 'Alpha' },
    { name: 'Beta', value: 'Beta' },
    { name: 'Charlie', value: 'Charlie' },
  ];
  public value: string[] = [];
  public created: string[] = [];

  public onCreated(name: string): void {
    this.created.push(name);
    this.options = [...this.options, { name, value: name }];
    // Mirrors MediaService replacing the value array rather than mutating it.
    this.value = [...this.value, name];
  }
}

function configService(useNativeSelectOnMobile: boolean): ConfigService {
  return {
    getConfiguration: () => of({ user: { useNativeSelectOnMobile } }),
  } as unknown as ConfigService;
}

function configure<T>(host: Type<T>, useNativeSelectOnMobile = false): ComponentFixture<T> {
  TestBed.configureTestingModule({
    imports: [host],
    providers: [{ provide: ConfigService, useValue: configService(useNativeSelectOnMobile) }],
  });
  return TestBed.createComponent(host);
}

function selectComponent<T>(fixture: ComponentFixture<T>): SelectComponent {
  const debugElement = fixture.debugElement.query(By.directive(SelectComponent));
  if (!debugElement) {
    throw new Error('SelectComponent not found');
  }
  return debugElement.componentInstance as SelectComponent;
}

function optionCheckbox(fixture: ComponentFixture<unknown>, index: number): HTMLInputElement {
  return fixture.debugElement.queryAll(By.directive(SelectOptionComponent))[index].nativeElement.querySelector('input[type="checkbox"]') as HTMLInputElement;
}

function mockIPhoneUserAgent(): void {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148');
}

function options(fixture: ComponentFixture<unknown>): SelectOptionComponent[] {
  return fixture.debugElement.queryAll(By.directive(SelectOptionComponent)).map(debugElement => debugElement.componentInstance as SelectOptionComponent);
}

function query<T extends Element>(fixture: ComponentFixture<unknown>, selector: string): T {
  return fixture.nativeElement.querySelector(selector) as T;
}

function openCreateField(fixture: ComponentFixture<unknown>): HTMLInputElement {
  const component = selectComponent(fixture);
  component.open = true;
  fixture.detectChanges();
  return query<HTMLInputElement>(fixture, '.create-row input');
}

function enterText(fixture: ComponentFixture<unknown>, input: HTMLInputElement, text: string): Promise<void> {
  input.value = text;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
  return fixture.whenStable();
}

function dispatchKey(element: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
  element.dispatchEvent(event);
  return event;
}

// writeValue applies on a setTimeout so the CVA does not mutate during change detection.
async function flushWrite(fixture: ComponentFixture<unknown>): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture.detectChanges();
}

describe('SelectComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the placeholder until options are selected', () => {
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();

    const select = query<HTMLSelectElement>(fixture, 'select.form-select');
    expect(select.textContent?.trim()).toBe('+ Items');
  });

  it('joins the summary in option order, not value order', async () => {
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);

    component.value = ['charlie', 'alpha'];
    await flushWrite(fixture);

    const select = query<HTMLSelectElement>(fixture, 'select.form-select');
    expect(select.textContent?.trim()).toBe('Alpha, Charlie');
  });

  it('opens on mousedown and closes on Escape', () => {
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const select = query<HTMLSelectElement>(fixture, 'select.form-select');
    const content = query<HTMLElement>(fixture, '.select-content');

    expect(content.classList.contains('closed')).toBe(true);

    const mousedown = new MouseEvent('mousedown', { button: 0, cancelable: true });
    select.dispatchEvent(mousedown);
    fixture.detectChanges();

    expect(component.open).toBe(true);
    expect(mousedown.defaultPrevented).toBe(true);
    expect(content.classList.contains('closed')).toBe(false);

    dispatchKey(select, 'Escape');
    fixture.detectChanges();

    expect(component.open).toBe(false);
    expect(content.classList.contains('closed')).toBe(true);
  });

  it('emits value changes and selection events when options are toggled', async () => {
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const rows = fixture.nativeElement.querySelectorAll('.form-check') as NodeListOf<HTMLElement>;

    const valueChange = vi.fn();
    const selected = vi.fn();
    const deselected = vi.fn();
    const onChange = vi.fn();
    const onTouched = vi.fn();
    component.valueChange.subscribe(valueChange);
    component.selected.subscribe(selected);
    component.deselected.subscribe(deselected);
    component.registerOnChange(onChange);
    component.registerOnTouched(onTouched);

    component.open = true;
    fixture.detectChanges();

    rows[0].click();
    fixture.detectChanges();
    expect(valueChange).toHaveBeenLastCalledWith(['alpha']);
    expect(selected).toHaveBeenCalledWith('alpha');
    expect(onChange).toHaveBeenLastCalledWith(['alpha']);
    expect(onTouched).toHaveBeenCalledTimes(1);

    rows[0].click();
    fixture.detectChanges();
    expect(valueChange).toHaveBeenLastCalledWith([]);
    expect(deselected).toHaveBeenCalledWith('alpha');
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(onTouched).toHaveBeenCalledTimes(1);
  });

  it('applies externally written values and clears safely', async () => {
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const select = query<HTMLSelectElement>(fixture, 'select.form-select');

    component.value = ['alpha', 'charlie'];
    await flushWrite(fixture);
    expect(select.textContent?.trim()).toBe('Alpha, Charlie');
    expect(options(fixture).map(option => option.selected)).toEqual([true, false, true]);

    component.value = null as unknown as string[];
    await flushWrite(fixture);
    expect(select.textContent?.trim()).toBe('+ Items');
    expect(options(fixture).map(option => option.selected)).toEqual([false, false, false]);

    component.value = undefined as unknown as string[];
    await flushWrite(fixture);
    expect(options(fixture).map(option => option.selected)).toEqual([false, false, false]);

    component.value = 'not-an-array' as never;
    await flushWrite(fixture);
    expect(options(fixture).map(option => option.selected)).toEqual([false, false, false]);
  });

  it('checks newly projected options that are already in the value', async () => {
    const fixture = configure(DynamicHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const host = fixture.componentInstance as DynamicHostComponent;

    component.value = ['alpha', 'beta'];
    await flushWrite(fixture);
    expect(options(fixture).map(option => option.selected)).toEqual([true]);

    host.options = [...host.options, { name: 'Beta', value: 'beta' }];
    fixture.detectChanges();
    await flushWrite(fixture);

    expect(fixture.nativeElement.querySelectorAll('app-select-option')).toHaveLength(2);
    expect(options(fixture).map(option => option.selected)).toEqual([true, true]);
    expect(optionCheckbox(fixture, 1).checked).toBe(true);
    expect(query<HTMLSelectElement>(fixture, 'select.form-select').textContent?.trim()).toBe('Alpha, Beta');
  });

  it('updates the summary when an option is removed', async () => {
    const fixture = configure(DynamicHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const host = fixture.componentInstance as DynamicHostComponent;

    host.options = [
      { name: 'Alpha', value: 'alpha' },
      { name: 'Beta', value: 'beta' },
    ];
    fixture.detectChanges();
    component.value = ['alpha', 'beta'];
    await flushWrite(fixture);
    expect(query<HTMLSelectElement>(fixture, 'select.form-select').textContent?.trim()).toBe('Alpha, Beta');

    host.options = [{ name: 'Beta', value: 'beta' }];
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('app-select-option')).toHaveLength(1);
    expect(query<HTMLSelectElement>(fixture, 'select.form-select').textContent?.trim()).toBe('Beta');
  });

  it('opens with Space and prevents the default scroll', () => {
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const select = query<HTMLSelectElement>(fixture, 'select.form-select');

    const event = dispatchKey(select, ' ');

    expect(component.open).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('moves the highlight with the arrow keys and wraps', () => {
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const select = query<HTMLSelectElement>(fixture, 'select.form-select');
    const optionComponents = options(fixture);

    component.open = true;
    fixture.detectChanges();

    dispatchKey(select, 'ArrowDown');
    expect(optionComponents.map(option => option.highlighted)).toEqual([true, false, false]);

    dispatchKey(select, 'ArrowDown');
    expect(optionComponents.map(option => option.highlighted)).toEqual([false, true, false]);

    dispatchKey(select, 'ArrowDown');
    dispatchKey(select, 'ArrowDown');
    expect(optionComponents.map(option => option.highlighted)).toEqual([true, false, false]);

    dispatchKey(select, 'ArrowUp');
    expect(optionComponents.map(option => option.highlighted)).toEqual([false, false, true]);
  });

  it('toggles the highlighted option with Enter', () => {
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const select = query<HTMLSelectElement>(fixture, 'select.form-select');
    const valueChange = vi.fn();
    component.valueChange.subscribe(valueChange);

    component.open = true;
    fixture.detectChanges();
    dispatchKey(select, 'ArrowDown');
    dispatchKey(select, 'Enter');

    expect(options(fixture)[0].selected).toBe(true);
    expect(valueChange).toHaveBeenCalledWith(['alpha']);
  });

  it('accumulates type-ahead characters into a prefix match', () => {
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const select = query<HTMLSelectElement>(fixture, 'select.form-select');
    const optionComponents = options(fixture);

    component.open = true;
    fixture.detectChanges();

    dispatchKey(select, 'b');
    expect(optionComponents.map(option => option.highlighted)).toEqual([false, true, false]);

    dispatchKey(select, 'e');
    expect(optionComponents.map(option => option.highlighted)).toEqual([false, true, false]);
  });

  it('falls back to a substring type-ahead match', () => {
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const select = query<HTMLSelectElement>(fixture, 'select.form-select');
    const optionComponents = options(fixture);

    component.open = true;
    fixture.detectChanges();

    dispatchKey(select, 'r');
    expect(optionComponents.map(option => option.highlighted)).toEqual([false, false, true]);
  });

  it('clears the highlight when type-ahead finds no match', () => {
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const select = query<HTMLSelectElement>(fixture, 'select.form-select');
    const optionComponents = options(fixture);

    component.open = true;
    fixture.detectChanges();

    dispatchKey(select, 'z');
    expect(optionComponents.map(option => option.highlighted)).toEqual([false, false, false]);
  });

  it('resets the type-ahead search after one second', () => {
    vi.useFakeTimers();
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const select = query<HTMLSelectElement>(fixture, 'select.form-select');
    const optionComponents = options(fixture);

    component.open = true;
    fixture.detectChanges();

    dispatchKey(select, 'b');
    expect(optionComponents.map(option => option.highlighted)).toEqual([false, true, false]);

    vi.advanceTimersByTime(1000);
    dispatchKey(select, 'a');
    expect(optionComponents.map(option => option.highlighted)).toEqual([true, false, false]);
  });

  it('keeps the dropdown open while focus stays inside the host', () => {
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const select = query<HTMLSelectElement>(fixture, 'select.form-select');
    const content = query<HTMLElement>(fixture, '.select-content');

    component.open = true;
    fixture.detectChanges();

    content.dispatchEvent(new MouseEvent('mouseenter'));
    content.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(component.open).toBe(true);

    content.dispatchEvent(new MouseEvent('mouseleave'));
    select.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(component.open).toBe(false);
  });

  it('positions the dropdown below or above the host', async () => {
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const selectElement = query<HTMLElement>(fixture, 'app-select');
    const content = query<HTMLElement>(fixture, '.select-content');

    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);

    const rect = vi.spyOn(selectElement, 'getBoundingClientRect');

    rect.mockReturnValue({ top: 100, height: 20, bottom: 120 } as DOMRect);
    component.onResize();
    await flushWrite(fixture);

    expect(content.style.maxHeight).toBe('640px');
    expect(content.style.bottom).toBe('');

    rect.mockReturnValue({ top: 700, height: 20, bottom: 720 } as DOMRect);
    component.onResize();
    await flushWrite(fixture);

    expect(content.style.maxHeight).toBe('660px');
    expect(content.style.bottom).toBe('20px');
  });

  it('applies native select changes and emits added and removed values', async () => {
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const selected = vi.fn();
    const deselected = vi.fn();
    const valueChange = vi.fn();
    component.selected.subscribe(selected);
    component.deselected.subscribe(deselected);
    component.valueChange.subscribe(valueChange);

    component.value = ['alpha'];
    await flushWrite(fixture);

    component.onNativeSelectChange(['alpha', 'beta']);
    expect(selected).toHaveBeenCalledWith('beta');
    expect(valueChange).toHaveBeenLastCalledWith(['alpha', 'beta']);
    expect(options(fixture).map(option => option.selected)).toEqual([true, true, false]);

    component.onNativeSelectChange(['beta']);
    expect(deselected).toHaveBeenCalledWith('alpha');
    expect(valueChange).toHaveBeenLastCalledWith(['beta']);
    expect(options(fixture).map(option => option.selected)).toEqual([false, true, false]);
  });

  it('selects a created option when the bound value array is replaced', async () => {
    const fixture = configure(CreateHostComponent);
    fixture.detectChanges();
    const host = fixture.componentInstance as CreateHostComponent;
    const component = selectComponent(fixture);

    component.open = true;
    fixture.detectChanges();
    component.createText = 'Delta';
    component.create();
    fixture.detectChanges();
    await flushWrite(fixture);

    expect(host.created).toEqual(['Delta']);
    expect(fixture.nativeElement.querySelectorAll('app-select-option')).toHaveLength(4);
    expect(options(fixture).map(option => option.selected)).toEqual([false, false, false, true]);
    expect(optionCheckbox(fixture, 3).checked).toBe(true);
    expect(query<HTMLSelectElement>(fixture, 'select.form-select').textContent?.trim()).toBe('Delta');
  });

  it('hides the create row when not creatable', () => {
    const fixture = configure(StaticHostComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.create-row')).toBeNull();
  });

  it('shows the create row when creatable', () => {
    const fixture = configure(CreateHostComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.create-row')).not.toBeNull();
    expect(query<HTMLInputElement>(fixture, '.create-row input').placeholder).toBe('Enter a name...');
  });

  it('emits a trimmed name on Enter, clears the input and keeps the dropdown open', async () => {
    const fixture = configure(CreateHostComponent);
    fixture.detectChanges();
    const host = fixture.componentInstance as CreateHostComponent;
    const component = selectComponent(fixture);
    const input = openCreateField(fixture);

    await enterText(fixture, input, '  Delta  ');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(host.created).toEqual(['Delta']);
    expect(component.createText).toBe('');
    expect(input.value).toBe('');
    expect(component.open).toBe(true);
  });

  it('emits a trimmed name when Add is clicked', async () => {
    const fixture = configure(CreateHostComponent);
    fixture.detectChanges();
    const host = fixture.componentInstance as CreateHostComponent;
    const input = openCreateField(fixture);
    const button = query<HTMLButtonElement>(fixture, '.create-row button');

    await enterText(fixture, input, '  Echo  ');
    expect(button.disabled).toBe(false);
    button.click();
    fixture.detectChanges();

    expect(host.created).toEqual(['Echo']);
  });

  it('does nothing for empty or whitespace input', async () => {
    const fixture = configure(CreateHostComponent);
    fixture.detectChanges();
    const host = fixture.componentInstance as CreateHostComponent;
    const component = selectComponent(fixture);
    const input = openCreateField(fixture);
    const button = query<HTMLButtonElement>(fixture, '.create-row button');

    expect(button.disabled).toBe(true);

    await enterText(fixture, input, '   ');
    expect(button.disabled).toBe(true);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    button.click();
    fixture.detectChanges();

    expect(host.created).toEqual([]);
    expect(component.createText).toBe('   ');
  });

  it('does not drive type-ahead or toggle the highlighted option from the create field', async () => {
    const fixture = configure(CreateHostComponent);
    fixture.detectChanges();
    const host = fixture.componentInstance as CreateHostComponent;
    const select = query<HTMLSelectElement>(fixture, 'select.form-select');
    const optionComponents = options(fixture);
    const input = openCreateField(fixture);

    dispatchKey(select, 'ArrowDown');
    expect(optionComponents.map(option => option.highlighted)).toEqual([true, false, false]);

    await enterText(fixture, input, 'c');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true }));
    expect(optionComponents.map(option => option.highlighted)).toEqual([true, false, false]);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(host.created).toEqual(['c']);
    expect(optionComponents[0].selected).toBe(false);
  });

  it('uses an existing option instead of creating a duplicate', async () => {
    const fixture = configure(CreateHostComponent);
    fixture.detectChanges();
    const host = fixture.componentInstance as CreateHostComponent;
    const input = openCreateField(fixture);

    await enterText(fixture, input, 'Beta');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await flushWrite(fixture);

    expect(host.created).toEqual([]);
    expect(options(fixture).map(option => option.selected)).toEqual([false, true, false]);
    expect(query<HTMLSelectElement>(fixture, 'select.form-select').textContent?.trim()).toBe('Beta');
    expect(input.value).toBe('');
  });

  it('keeps the dropdown open when focus moves inside the create row and closes on outside focus', () => {
    const fixture = configure(CreateHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const input = openCreateField(fixture);
    const button = query<HTMLButtonElement>(fixture, '.create-row button');

    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: button }));
    expect(component.open).toBe(true);

    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    expect(component.open).toBe(false);
  });

  it('closes on Escape from the create field and returns focus to the trigger', () => {
    const fixture = configure(CreateHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    const input = openCreateField(fixture);
    const trigger = query<HTMLSelectElement>(fixture, 'select.form-select');

    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(component.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape from the Add button and returns focus to the trigger', () => {
    const fixture = configure(CreateHostComponent);
    fixture.detectChanges();
    const component = selectComponent(fixture);
    openCreateField(fixture);
    const trigger = query<HTMLSelectElement>(fixture, 'select.form-select');
    const button = query<HTMLButtonElement>(fixture, '.create-row button');

    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(component.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('does not create twice when Enter activates Add', async () => {
    const fixture = configure(CreateHostComponent);
    fixture.detectChanges();
    const host = fixture.componentInstance as CreateHostComponent;
    const input = openCreateField(fixture);
    const button = query<HTMLButtonElement>(fixture, '.create-row button');

    await enterText(fixture, input, 'Foxtrot');
    button.focus();
    // The keydown handler leaves Enter to the button's native click; simulate
    // the click the browser fires after Enter.
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    button.click();
    fixture.detectChanges();

    expect(host.created).toEqual(['Foxtrot']);
  });

  it('creates a differently-cased name instead of reusing an existing option', async () => {
    const fixture = configure(CreateHostComponent);
    fixture.detectChanges();
    const host = fixture.componentInstance as CreateHostComponent;
    const input = openCreateField(fixture);

    await enterText(fixture, input, 'beta');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await flushWrite(fixture);

    expect(host.created).toEqual(['beta']);
    expect(options(fixture).map(option => option.selected)).toEqual([false, false, false, true]);
    expect(optionCheckbox(fixture, 3).checked).toBe(true);
  });

  it('does not create while the select is disabled', () => {
    const fixture = configure(CreateHostComponent);
    fixture.detectChanges();
    const host = fixture.componentInstance as CreateHostComponent;
    const component = selectComponent(fixture);

    component.disabled = true;
    component.createText = 'Golf';
    component.create();

    expect(host.created).toEqual([]);
    expect(component.createText).toBe('Golf');
  });

  it('renders the native mobile select when configured', () => {
    // is-mobile reads navigator.userAgent, so present a phone to exercise the
    // real detection path instead of mocking the module.
    mockIPhoneUserAgent();

    const fixture = configure(StaticHostComponent, true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.select-content')).toBeNull();
    expect(fixture.nativeElement.querySelector('select.hidden-select')).not.toBeNull();
    expect(query<HTMLSelectElement>(fixture, 'select.form-select').textContent?.trim()).toBe('+ Items');

    const hidden = query<HTMLSelectElement>(fixture, 'select.hidden-select');
    const optionElements = Array.from(hidden.querySelectorAll('option'));
    expect(optionElements.map(option => option.textContent?.trim())).toEqual(['Alpha', 'Beta', 'Charlie']);
    expect(selectComponent(fixture).basicOptions?.map(option => option.value)).toEqual(['alpha', 'beta', 'charlie']);
  });

  it('uses the custom dropdown when creatable even with native mobile enabled', () => {
    mockIPhoneUserAgent();

    const fixture = configure(CreateHostComponent, true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.select-content')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('select.hidden-select')).toBeNull();
    expect(fixture.nativeElement.querySelector('.create-row')).not.toBeNull();
  });
});
