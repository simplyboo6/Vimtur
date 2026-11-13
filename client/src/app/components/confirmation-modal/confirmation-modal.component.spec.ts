import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { ConfirmationModalComponent } from './confirmation-modal.component';

function createModal(): ComponentFixture<ConfirmationModalComponent> {
  const fixture = TestBed.createComponent(ConfirmationModalComponent);
  fixture.componentInstance.title = 'Are you sure?';
  return fixture;
}

function buttonWithText(host: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find(candidate => candidate.textContent?.trim() === label);
  if (!button) {
    throw new Error(`Confirmation modal has no "${label}" button`);
  }
  return button;
}

describe('ConfirmationModalComponent', () => {
  it('renders no body for a footer-only dialog', () => {
    const fixture = createModal();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.modal-body')).toBeNull();
  });

  it('renders no body for an empty details list', () => {
    const fixture = createModal();
    fixture.componentInstance.details = [];
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.modal-body')).toBeNull();
  });

  it('renders the message and detail list when supplied', () => {
    const fixture = createModal();
    fixture.componentInstance.message = 'These paths will go:';
    fixture.componentInstance.details = ['a.png', 'copy/a.png'];
    fixture.detectChanges();

    const body = fixture.nativeElement.querySelector('.modal-body') as HTMLElement;
    expect(body.textContent).toContain('These paths will go:');
    const items = Array.from(body.querySelectorAll('.detail-item')).map(item => item.textContent?.trim());
    expect(items).toEqual(['a.png', 'copy/a.png']);
  });

  it('defaults the optional checkbox to unchecked and labels it', () => {
    const fixture = createModal();
    fixture.componentInstance.checkboxLabel = 'Also delete the source file from disk';
    fixture.detectChanges();

    const checkbox = fixture.nativeElement.querySelector(`#${fixture.componentInstance.checkboxId}`) as HTMLInputElement;
    const label = fixture.nativeElement.querySelector(`label[for="${checkbox.id}"]`) as HTMLLabelElement;
    expect(checkbox.checked).toBe(false);
    expect(fixture.componentInstance.checkbox).toBe(false);
    expect(label.textContent?.trim()).toBe('Also delete the source file from disk');
  });

  it('toggles the checkbox state the service reads back at close time', async () => {
    const fixture = createModal();
    fixture.componentInstance.checkboxLabel = 'Also delete the source file from disk';
    fixture.detectChanges();

    const checkbox = fixture.nativeElement.querySelector(`#${fixture.componentInstance.checkboxId}`) as HTMLInputElement;
    // jsdom's click() does not reproduce the browser's checkbox activation, so
    // drive the change event Angular's CheckboxControlValueAccessor listens to.
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();

    expect(fixture.componentInstance.checkbox).toBe(true);
  });

  it('marks Confirm as the autofocus target and leaves Cancel unmarked', () => {
    const fixture = createModal();
    fixture.detectChanges();

    // ng-bootstrap focuses the first [ngbAutofocus] element when the dialog opens,
    // so this attribute is what makes Enter confirm the dialog.
    const host = fixture.nativeElement as HTMLElement;
    expect(buttonWithText(host, 'Confirm').hasAttribute('ngbAutofocus')).toBe(true);
    expect(buttonWithText(host, 'Cancel').hasAttribute('ngbAutofocus')).toBe(false);
  });
});
