import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { SelectComponent } from './select.component';
import { SelectOptionComponent } from '../select-option/select-option.component';

@Component({
  template: `<app-select placeholder="+ Items"><app-select-option value="alpha">Alpha</app-select-option></app-select>`,
  imports: [SelectComponent, SelectOptionComponent],
})
class SelectHostComponent {}

describe('SelectComponent', () => {
  it('renders the placeholder', () => {
    const fixture = TestBed.createComponent(SelectHostComponent);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select.form-select') as HTMLSelectElement;
    expect(select.textContent?.trim()).toBe('+ Items');
  });
});
