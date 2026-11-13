import { BreakpointObserver } from '@angular/cdk/layout';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { of, ReplaySubject, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { AlertService } from 'services/alert.service';
import { CollectionService } from 'services/collection.service';
import { GalleryService } from 'services/gallery.service';
import { MediaService } from 'services/media.service';
import { PromptService } from 'services/prompt.service';
import { UiService } from 'services/ui.service';
import { NavbarComponent } from './navbar.component';

interface Harness {
  fixture: ComponentFixture<NavbarComponent>;
  host: HTMLElement;
  position: ReplaySubject<{ startIndex: number; endIndex: number; total: number } | undefined>;
  alerts: MockInstance;
  goto: MockInstance;
  offset: MockInstance;
  prompt: MockInstance;
  seekToIndex: MockInstance;
  scrollByViewport: MockInstance;
}

function emitRoute(router: Router, url: string): void {
  // The component reads NavigationEnd events; the stubbed history is enough.
  (router.events as unknown as Subject<Event>).next(new NavigationEnd(1, url, url) as unknown as Event);
}

function createHarness(): Harness {
  const position = new ReplaySubject<{ startIndex: number; endIndex: number; total: number } | undefined>(1);
  const alerts = vi.fn();
  const goto = vi.fn();
  const offset = vi.fn();
  const prompt = vi.fn();
  const seekToIndex = vi.fn();
  const scrollByViewport = vi.fn();

  TestBed.configureTestingModule({
    imports: [NavbarComponent],
    providers: [
      provideRouter([]),
      { provide: AlertService, useValue: { show: alerts } },
      { provide: CollectionService, useValue: { goto, offset, shuffle: vi.fn(), deleteCurrent: vi.fn(), search: vi.fn() } },
      { provide: GalleryService, useValue: { position, seekToIndex, scrollByViewport } },
      { provide: MediaService, useValue: { media: undefined } },
      { provide: PromptService, useValue: { prompt } },
      {
        provide: UiService,
        useValue: {
          searchModel: of({ dir: { like: undefined } }),
          offsetDirectory: vi.fn(),
          createSearchModel: vi.fn(),
          createSearch: vi.fn(),
          setTagPanelState: vi.fn(),
        },
      },
      { provide: BreakpointObserver, useValue: { observe: () => of({ matches: false, breakpoints: {} }) } },
    ],
  });

  const fixture = TestBed.createComponent(NavbarComponent);
  const host = fixture.nativeElement as HTMLElement;
  fixture.detectChanges();

  return { fixture, host, position, alerts, goto, offset, prompt, seekToIndex, scrollByViewport };
}

function click(host: HTMLElement, title: string): void {
  const button = host.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  expect(button).not.toBeNull();
  button?.click();
}

describe('NavbarComponent', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the visible gallery range on the gallery route', () => {
    const harness = createHarness();
    harness.position.next({ startIndex: 40, endIndex: 80, total: 50000 });

    emitRoute(TestBed.inject(Router), '/gallery');
    harness.fixture.detectChanges();

    expect(harness.host.querySelector('.range-indicator')?.textContent).toContain('41-80 of 50,000');
  });

  it('hides the range indicator outside the gallery route', () => {
    const harness = createHarness();
    harness.position.next({ startIndex: 40, endIndex: 80, total: 50000 });

    emitRoute(TestBed.inject(Router), '/viewer');
    harness.fixture.detectChanges();

    expect(harness.host.querySelector('.range-indicator')).toBeNull();
  });

  it('scrolls the gallery by a viewport for the gallery arrows', () => {
    const harness = createHarness();
    emitRoute(TestBed.inject(Router), '/gallery');
    harness.fixture.detectChanges();

    click(harness.host, 'Previous');
    click(harness.host, 'Next');

    expect(harness.scrollByViewport.mock.calls).toEqual([[-1], [1]]);
    expect(harness.offset).not.toHaveBeenCalled();
  });

  it('seeks the gallery only when the prompted goto succeeds', async () => {
    const harness = createHarness();
    emitRoute(TestBed.inject(Router), '/gallery');
    harness.fixture.detectChanges();
    harness.prompt.mockResolvedValue('42');
    harness.goto.mockReturnValue(true);

    click(harness.host, 'Goto');
    expect(harness.goto).toHaveBeenCalledWith('42');

    // The prompt resolves on the next microtask.
    await Promise.resolve();
    expect(harness.seekToIndex).toHaveBeenCalledWith(41);

    harness.seekToIndex.mockClear();
    harness.goto.mockReturnValue(false);
    click(harness.host, 'Goto');
    await Promise.resolve();
    expect(harness.seekToIndex).not.toHaveBeenCalled();
  });

  it('warns instead of goto-ing for a hash or a zero on the gallery', async () => {
    const harness = createHarness();
    emitRoute(TestBed.inject(Router), '/gallery');
    harness.fixture.detectChanges();

    for (const input of ['abc123', '0']) {
      harness.prompt.mockResolvedValue(input);
      click(harness.host, 'Goto');
      await Promise.resolve();
    }

    expect(harness.alerts).toHaveBeenCalledTimes(2);
    expect(harness.alerts).toHaveBeenCalledWith({
      type: 'warning',
      message: 'Goto on the gallery takes a 1-based item number',
      autoClose: 3000,
    });
    expect(harness.goto).not.toHaveBeenCalled();
    expect(harness.seekToIndex).not.toHaveBeenCalled();
  });
});
