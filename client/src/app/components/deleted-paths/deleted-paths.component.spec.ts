import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DeletedMedia } from '@vimtur/common';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AlertService } from 'app/services/alert.service';
import { ConfirmationService, ConfirmationResult } from 'app/services/confirmation.service';
import { DeletedService } from 'app/services/deleted.service';

import { DeletedPathsComponent } from './deleted-paths.component';

interface Harness {
  fixture: ComponentFixture<DeletedPathsComponent>;
  component: DeletedPathsComponent;
  element: HTMLElement;
  deleted: { getDeletedPaths: ReturnType<typeof vi.fn>; removeDeletedPath: ReturnType<typeof vi.fn> };
  confirmWith: ReturnType<typeof vi.fn>;
  alerts: { show: ReturnType<typeof vi.fn> };
}

const ENTRIES: DeletedMedia[] = [
  { hash: 'aaa', path: 'dir/a.png' },
  { hash: 'aaa', path: 'copy/a.png' },
  { hash: 'bbb', path: 'b.png' },
];

function createHarness(entries: DeletedMedia[] = ENTRIES, load: () => Observable<DeletedMedia[]> = () => of(entries)): Harness {
  const deleted = {
    getDeletedPaths: vi.fn(load),
    removeDeletedPath: vi.fn(() => of(undefined)),
  };
  const confirmWith = vi.fn((): Promise<ConfirmationResult> => Promise.resolve({ confirmed: true, checkbox: false }));
  const alerts = { show: vi.fn() };

  TestBed.configureTestingModule({
    imports: [DeletedPathsComponent],
    providers: [
      { provide: DeletedService, useValue: deleted },
      { provide: AlertService, useValue: alerts },
      { provide: ConfirmationService, useValue: { confirmWith } },
    ],
  });

  const fixture = TestBed.createComponent(DeletedPathsComponent);
  fixture.detectChanges();
  return {
    fixture,
    component: fixture.componentInstance,
    element: fixture.nativeElement as HTMLElement,
    deleted,
    confirmWith,
    alerts,
  };
}

function pathRows(element: HTMLElement): string[] {
  return Array.from(element.querySelectorAll('.deleted-path')).map(row => row.textContent?.trim() ?? '');
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(promiseResolve => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe('DeletedPathsComponent', () => {
  it('reports an empty ignore list', () => {
    const { element } = createHarness([]);

    expect(element.textContent).toContain('No ignored paths.');
  });

  it('reports a failed fetch instead of claiming the list is empty', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const harness = createHarness([], () => throwError(() => new Error('nope')));
    harness.fixture.detectChanges();

    expect(harness.alerts.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Failed to fetch the deleted paths' }));
    expect(harness.element.textContent).toContain('Failed to load ignored paths.');
    expect(harness.element.textContent).not.toContain('No ignored paths.');
    consoleError.mockRestore();
  });

  it('groups paths by content hash', () => {
    const { element, component } = createHarness();

    const groups = component.rows;
    expect(groups.map(group => group.hash)).toEqual(['aaa', 'bbb']);
    expect(groups[0].paths).toEqual(['dir/a.png', 'copy/a.png']);
    expect(pathRows(element)).toEqual(['dir/a.png', 'copy/a.png', 'b.png']);
  });

  it('filters by an exact hash, ignoring case', () => {
    const { component } = createHarness();

    component.hashFilter = 'AAA';
    expect(component.rows.map(group => group.hash)).toEqual(['aaa']);

    // A prefix or a fragment is not the hash.
    component.hashFilter = 'aa';
    expect(component.rows).toEqual([]);

    component.hashFilter = 'bbb';
    expect(component.rows.map(group => group.hash)).toEqual(['bbb']);
  });

  it('filters by a partial, case-insensitive path and keeps the group whole', () => {
    const { component } = createHarness();

    component.pathFilter = 'COPY/A';
    const groups = component.rows;
    expect(groups).toHaveLength(1);
    // The sibling path shares the entry's fate, so it is still listed.
    expect(groups[0].paths).toEqual(['dir/a.png', 'copy/a.png']);
  });

  it('combines both filters', () => {
    const { component } = createHarness();

    component.hashFilter = 'bbb';
    component.pathFilter = 'a.png';
    expect(component.rows).toEqual([]);

    component.hashFilter = 'aaa';
    expect(component.rows.map(group => group.hash)).toEqual(['aaa']);
  });

  it('reports a filter that matches nothing', () => {
    const { fixture, component, element } = createHarness();

    component.hashFilter = 'missing';
    fixture.detectChanges();

    expect(element.textContent).toContain('No entries match the filter.');
    expect(pathRows(element)).toEqual([]);
  });

  it('asks before removing and shows every path for the hash', async () => {
    const harness = createHarness();
    const confirmation = createDeferred<ConfirmationResult>();
    harness.confirmWith.mockReturnValue(confirmation.promise);

    harness.component.remove(harness.component.rows[0]);
    // The guard is held while the dialog is open, so a second click cannot stack
    // another modal or fire a second DELETE.
    expect(harness.component.removing.has('aaa')).toBe(true);
    harness.fixture.detectChanges();
    const buttons = Array.from(harness.element.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons[0].disabled).toBe(true);

    confirmation.resolve({ confirmed: true, checkbox: false });
    await Promise.resolve();

    expect(harness.confirmWith).toHaveBeenCalledWith(
      'Remove this entry from the ignore list?',
      expect.objectContaining({ details: ['dir/a.png', 'copy/a.png'], negative: true }),
    );
    expect(harness.deleted.removeDeletedPath).toHaveBeenCalledWith('aaa');
    expect(harness.component.removing.has('aaa')).toBe(false);
    // The list is re-read so sibling rows for that hash disappear with it.
    expect(harness.deleted.getDeletedPaths).toHaveBeenCalledTimes(2);
  });

  it('leaves the list alone when the removal is cancelled', async () => {
    const harness = createHarness();
    harness.confirmWith.mockResolvedValue({ confirmed: false, checkbox: false });

    harness.component.remove(harness.component.rows[0]);
    await Promise.resolve();

    expect(harness.deleted.removeDeletedPath).not.toHaveBeenCalled();
    expect(harness.deleted.getDeletedPaths).toHaveBeenCalledTimes(1);
    // The guard is released so the entry can be retried.
    expect(harness.component.removing.has('aaa')).toBe(false);
  });

  it('releases the in-flight guard when the confirmation itself fails', async () => {
    const harness = createHarness();
    harness.confirmWith.mockRejectedValue(new Error('no modal'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    harness.component.remove(harness.component.rows[0]);
    // The rejection has to cross both links of the component's then/catch chain,
    // so one microtask tick is not enough to reach the guard release.
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.component.removing.has('aaa')).toBe(false);
    expect(harness.deleted.removeDeletedPath).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('clears the in-flight guard and alerts when the removal fails', async () => {
    const harness = createHarness();
    harness.deleted.removeDeletedPath.mockReturnValue(throwError(() => new Error('nope')));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    harness.component.remove(harness.component.rows[0]);
    await Promise.resolve();

    expect(harness.component.removing.has('aaa')).toBe(false);
    expect(harness.alerts.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Failed to remove the ignored path' }));
    consoleError.mockRestore();
  });

  it('disables the remove button while a request is in flight', () => {
    const harness = createHarness();

    harness.component.removing.add('aaa');
    harness.fixture.detectChanges();

    const buttons = Array.from(harness.element.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.map(button => button.disabled)).toEqual([true, false]);
  });
});
