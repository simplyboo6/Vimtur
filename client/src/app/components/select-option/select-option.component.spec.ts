import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { SelectOptionComponent } from './select-option.component';

@Component({
  template: `<app-select-option value="alpha"> Alpha </app-select-option>`,
  imports: [SelectOptionComponent],
})
class SingleOptionHostComponent {}

@Component({
  template: `
    <app-select-option value="alpha">Alpha</app-select-option>
    <app-select-option value="beta">Beta</app-select-option>
  `,
  imports: [SelectOptionComponent],
})
class MultipleOptionHostComponent {}

function createSingleOption(): {
  fixture: ComponentFixture<SingleOptionHostComponent>;
  component: SelectOptionComponent;
  element: HTMLElement;
} {
  const fixture = TestBed.createComponent(SingleOptionHostComponent);
  fixture.detectChanges();
  const element = fixture.nativeElement.querySelector('app-select-option') as HTMLElement;
  const component = fixture.debugElement.children[0].componentInstance as SelectOptionComponent;
  return { fixture, component, element };
}

describe('SelectOptionComponent', () => {
  it('gets the trimmed projected text', () => {
    const { component } = createSingleOption();
    expect(component.text).toBe('Alpha');
  });

  it('toggles and emits selectedChange once when the row is clicked', () => {
    const { fixture, component, element } = createSingleOption();
    const selectedChange = vi.fn();
    component.selectedChange.subscribe(selectedChange);

    const row = element.querySelector('.form-check') as HTMLElement;
    row.click();
    fixture.detectChanges();

    expect(component.selected).toBe(true);
    expect(selectedChange).toHaveBeenCalledTimes(1);
    expect(selectedChange).toHaveBeenCalledWith(true);
  });

  it('emits selectedChange once when the checkbox is clicked', async () => {
    const { fixture, component, element } = createSingleOption();
    const selectedChange = vi.fn();
    component.selectedChange.subscribe(selectedChange);

    const checkbox = element.querySelector('input[type="checkbox"]') as HTMLInputElement;
    // jsdom's click() does not reproduce the browser's checkbox activation, so
    // drive the change event Angular's CheckboxControlValueAccessor listens to.
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.selected).toBe(true);
    expect(selectedChange).toHaveBeenCalledTimes(1);
    expect(selectedChange).toHaveBeenCalledWith(true);
  });

  it('updates the UI when setSelected is called without emitting', async () => {
    const { fixture, component, element } = createSingleOption();
    const selectedChange = vi.fn();
    component.selectedChange.subscribe(selectedChange);

    component.setSelected(true);
    await fixture.whenStable();
    fixture.detectChanges();

    const checkbox = element.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(component.selected).toBe(true);
    expect(checkbox.checked).toBe(true);
    expect(selectedChange).not.toHaveBeenCalled();
  });

  it('renders the highlighted and not-highlighted classes', () => {
    const { fixture, component, element } = createSingleOption();
    const row = element.querySelector('.form-check') as HTMLElement;

    expect(row.classList.contains('highlighted')).toBe(false);
    expect(row.classList.contains('not-highlighted')).toBe(false);

    component.setHighlighted(true);
    fixture.detectChanges();
    expect(row.classList.contains('highlighted')).toBe(true);
    expect(row.classList.contains('not-highlighted')).toBe(false);

    component.setHighlighted(false);
    fixture.detectChanges();
    expect(row.classList.contains('highlighted')).toBe(false);
    expect(row.classList.contains('not-highlighted')).toBe(true);
  });

  it('scrolls the option into the nearest view', () => {
    const { component, element } = createSingleOption();
    const scrollIntoView = vi.fn();
    element.scrollIntoView = scrollIntoView;

    component.scroll();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('gives each option a unique uid linked to its label', () => {
    const fixture = TestBed.createComponent(MultipleOptionHostComponent);
    fixture.detectChanges();

    const options = fixture.nativeElement.querySelectorAll('app-select-option') as NodeListOf<HTMLElement>;
    const firstUid = options[0].querySelector('input')?.id;
    const secondUid = options[1].querySelector('input')?.id;

    expect(firstUid).toMatch(/^uid-\d+$/);
    expect(secondUid).toMatch(/^uid-\d+$/);
    expect(firstUid).not.toBe(secondUid);

    for (const option of [options[0], options[1]]) {
      const input = option.querySelector('input') as HTMLInputElement;
      const label = option.querySelector('label') as HTMLLabelElement;
      expect(input.id).toBe(label.htmlFor);
      expect(label.htmlFor).toBe(input.id);
    }
  });
});
