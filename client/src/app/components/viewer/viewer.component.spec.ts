import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Media } from '@vimtur/common';
import { of, ReplaySubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActorService } from 'app/services/actor.service';
import { ConfigService } from 'app/services/config.service';
import { MediaService } from 'app/services/media.service';
import { PlaylistService } from 'app/services/playlist.service';
import { PromptService } from 'app/services/prompt.service';
import { TagService } from 'app/services/tag.service';
import { UiService } from 'app/services/ui.service';
import { ViewerComponent } from './viewer.component';

function createMedia(hash: string): Media {
  return { hash, path: `/media/${hash}.jpg`, dir: '/media', type: 'still', tags: [], actors: [], hashDate: 0 } as unknown as Media;
}

describe('ViewerComponent', () => {
  let fixture: ComponentFixture<ViewerComponent>;
  let media: ReplaySubject<Media | undefined>;
  let tagsOpen: ReplaySubject<boolean>;
  let config: ReplaySubject<unknown>;
  let mediaService: { getMedia: () => ReplaySubject<Media | undefined>; clearAutoTags: ReturnType<typeof vi.fn>; clearAutoCaption: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    // jsdom has no media playback: the real (hidden) video player calls pause()
    // during teardown and would otherwise print "Not implemented" for each test.
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    media = new ReplaySubject<Media | undefined>(1);
    tagsOpen = new ReplaySubject<boolean>(1);
    config = new ReplaySubject<unknown>(1);
    mediaService = { getMedia: () => media, clearAutoTags: vi.fn(), clearAutoCaption: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ViewerComponent],
      providers: [
        // Only the viewer's own subscriptions need a source; the video player
        // resolves the rest from the root injector.
        { provide: UiService, useValue: { getTagPanelState: () => tagsOpen } },
        { provide: MediaService, useValue: mediaService },
        { provide: ConfigService, useValue: { getConfiguration: () => config } },
        // Opening the tag panel constructs the real component, whose services
        // would otherwise fire GET requests from their constructors.
        { provide: TagService, useValue: { getTags: () => of([]) } },
        { provide: ActorService, useValue: { getActors: () => of([]) } },
        { provide: PlaylistService, useValue: { getCurrentPlaylist: () => of(undefined), getPlaylists: () => of([]) } },
        { provide: PromptService, useValue: {} },
      ],
    });

    fixture = TestBed.createComponent(ViewerComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
  });

  it('fills the panel behind the media with a blurred thumbnail clone', () => {
    media.next(createMedia('abc'));
    fixture.detectChanges();

    const backdrop = fixture.debugElement.query(By.css('.right-panel .media-backdrop'));
    expect(backdrop).not.toBeNull();
    expect(backdrop.nativeElement.getAttribute('src')).toBe('/cache/thumbnails/abc.png');
    // Decorative: it must not be announced or add a second image to the a11y tree.
    expect(backdrop.nativeElement.getAttribute('aria-hidden')).toBe('true');
    expect(backdrop.nativeElement.getAttribute('alt')).toBe('');
  });

  it('renders no backdrop until a media item is selected', () => {
    media.next(undefined);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.media-backdrop'))).toBeNull();
  });

  it('renders the path and auto-tag overlays above the media', () => {
    media.next({ ...createMedia('abc'), autoTags: ['tag'] } as unknown as Media);
    tagsOpen.next(true);
    config.next({ user: { quickTagShowPath: true, quickTagShowAutoTags: true } });
    fixture.detectChanges();

    const overlays = fixture.debugElement.queryAll(By.css('.right-panel .text-overlay'));
    expect(overlays).toHaveLength(2);
    expect(overlays[0].nativeElement.textContent).toContain('/media/abc.jpg');
    expect(overlays[1].nativeElement.textContent).toContain('May contain: tag');
    // The path is the top overlay; only the auto-tags line is pinned to the
    // bottom, which the `.text-overlay` selector alone does not guarantee.
    const bottomOverlays = overlays.filter(overlay => (overlay.nativeElement as HTMLElement).classList.contains('bottom'));
    expect(bottomOverlays).toHaveLength(1);
    expect(bottomOverlays[0]).toBe(overlays[1]);
  });

  it('stacks the caption above the auto-tags in one bottom overlay', () => {
    media.next({ ...createMedia('abc'), autoCaption: 'a dog on a beach', autoTags: ['tag'] } as unknown as Media);
    tagsOpen.next(true);
    config.next({ user: { quickTagShowAutoCaption: true, quickTagShowAutoTags: true } });
    fixture.detectChanges();

    const overlays = fixture.debugElement.queryAll(By.css('.right-panel .text-overlay.bottom'));
    expect(overlays).toHaveLength(1);

    // The stacking is the component's arrangement, not the selector's: the
    // caption line must be the overlay's first child and the auto-tags line the
    // second.
    const lines = (overlays[0].nativeElement as HTMLElement).children;
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toContain('a dog on a beach');
    expect(lines[1].textContent).toContain('May contain: tag');
  });

  it('hides only the caption line when the caption overlay is toggled off', () => {
    media.next({ ...createMedia('abc'), autoCaption: 'a dog on a beach', autoTags: ['tag'] } as unknown as Media);
    tagsOpen.next(true);
    config.next({ user: { quickTagShowAutoCaption: false, quickTagShowAutoTags: true } });
    fixture.detectChanges();

    const overlay = fixture.debugElement.query(By.css('.right-panel .text-overlay.bottom'));
    expect(overlay).not.toBeNull();
    expect(overlay.nativeElement.textContent).not.toContain('a dog on a beach');
    expect(overlay.nativeElement.textContent).toContain('May contain: tag');
  });

  it('clears the generated caption from the overlay ×', () => {
    media.next({ ...createMedia('abc'), autoCaption: 'a dog on a beach' } as unknown as Media);
    tagsOpen.next(true);
    config.next({ user: { quickTagShowAutoCaption: true, quickTagShowAutoTags: true } });
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('.right-panel [data-id="clear-auto-caption"]')).nativeElement as HTMLButtonElement;
    button.click();

    expect(mediaService.clearAutoCaption).toHaveBeenCalledTimes(1);
  });
});
