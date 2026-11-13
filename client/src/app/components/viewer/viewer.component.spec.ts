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

  beforeEach(() => {
    // jsdom has no media playback: the real (hidden) video player calls pause()
    // during teardown and would otherwise print "Not implemented" for each test.
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    media = new ReplaySubject<Media | undefined>(1);
    tagsOpen = new ReplaySubject<boolean>(1);
    config = new ReplaySubject<unknown>(1);

    TestBed.configureTestingModule({
      imports: [ViewerComponent],
      providers: [
        // Only the viewer's own subscriptions need a source; the video player
        // resolves the rest from the root injector.
        { provide: UiService, useValue: { getTagPanelState: () => tagsOpen } },
        { provide: MediaService, useValue: { getMedia: () => media, clearAutoTags: vi.fn() } },
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
    expect(overlays[1].nativeElement.classList).toContain('bottom');
  });
});
