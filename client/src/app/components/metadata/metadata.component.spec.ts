import { HttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Media } from '@vimtur/common';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ActorService } from 'app/services/actor.service';
import { AlertService } from 'app/services/alert.service';
import { CollectionService } from 'app/services/collection.service';
import { MediaService } from 'app/services/media.service';
import { PlaylistService } from 'app/services/playlist.service';
import { TagService } from 'app/services/tag.service';
import { UiService } from 'app/services/ui.service';
import { MetadataComponent } from './metadata.component';
import { SelectComponent } from '../select/select.component';

interface Harness {
  fixture: ComponentFixture<MetadataComponent>;
  media: Media;
  http: {
    post: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  alerts: { show: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };
  tagService: TagService;
  actorService: ActorService;
  mediaService: MediaService;
}

async function createHarness(media: Media): Promise<Harness> {
  const http = {
    post: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  const alerts = {
    show: vi.fn(),
    dismiss: vi.fn(),
  };

  http.get.mockImplementation((url: string) => {
    if (url === '/api/tags') {
      return of(['existing-tag']);
    }
    if (url === '/api/actors') {
      return of(['existing-actor']);
    }
    throw new Error(`Unexpected GET ${url}`);
  });
  http.post.mockImplementation((url: string, body: { tag?: string; actor?: string; name?: string }) => {
    if (url === '/api/tags') {
      return of(['existing-tag', body.tag]);
    }
    if (url === '/api/actors') {
      return of(['existing-actor', body.actor]);
    }
    return of(null);
  });

  const tagService = new TagService(http as unknown as HttpClient, alerts as unknown as AlertService);
  const actorService = new ActorService(http as unknown as HttpClient, alerts as unknown as AlertService);
  const collectionService = {
    getMetadata: () => of(undefined),
  };
  const mediaService = new MediaService(
    http as unknown as HttpClient,
    alerts as unknown as AlertService,
    tagService,
    actorService,
    {} as NgbModal,
    collectionService as unknown as CollectionService,
  );
  const playlistService = {
    getPlaylists: () => of([]),
    getCurrentPlaylist: () => of(undefined),
    addMediaToPlaylist: vi.fn(),
    removeMediaFromPlaylist: vi.fn(),
  };

  mediaService.media = media;
  mediaService.setCurrent(media);

  TestBed.configureTestingModule({
    imports: [MetadataComponent],
    providers: [
      { provide: MediaService, useValue: mediaService },
      { provide: TagService, useValue: tagService },
      { provide: ActorService, useValue: actorService },
      { provide: UiService, useValue: {} },
      { provide: PlaylistService, useValue: playlistService },
    ],
  });

  const fixture = TestBed.createComponent(MetadataComponent);
  fixture.detectChanges();
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture.detectChanges();

  return { fixture, media, http, alerts, tagService, actorService, mediaService };
}

function selectFor(fixture: ComponentFixture<unknown>, placeholder: string): SelectComponent {
  const selects = fixture.debugElement.queryAll(By.directive(SelectComponent)).map(debugElement => debugElement.componentInstance as SelectComponent);
  const select = selects.find(candidate => candidate.placeholder === placeholder);
  if (!select) {
    throw new Error(`No select with placeholder ${placeholder}`);
  }
  return select;
}

function selectElementFor(fixture: ComponentFixture<unknown>, select: SelectComponent): HTMLElement {
  const debugElement = fixture.debugElement.queryAll(By.directive(SelectComponent)).find(candidate => candidate.componentInstance === select);
  if (!debugElement) {
    throw new Error('Select element not found');
  }
  return debugElement.nativeElement as HTMLElement;
}

function checkboxFor(element: HTMLElement, text: string): HTMLInputElement {
  for (const option of Array.from(element.querySelectorAll('app-select-option'))) {
    if (option.querySelector('label')?.textContent?.trim() === text) {
      return option.querySelector('input[type="checkbox"]') as HTMLInputElement;
    }
  }
  throw new Error(`No option labelled ${text}`);
}

async function flush(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture.detectChanges();
}

function createMedia(): Media {
  return { hash: 'abc', tags: [], actors: [], playlists: [] } as unknown as Media;
}

describe('MetadataComponent inline creation', () => {
  it('creates and selects a new tag through the media service', async () => {
    const { fixture, media, http } = await createHarness(createMedia());
    const select = selectFor(fixture, '+ Tags');

    select.open = true;
    fixture.detectChanges();
    select.createText = 'new-tag';
    select.create();
    await flush(fixture);

    expect(http.post).toHaveBeenCalledWith('/api/tags', { tag: 'new-tag' }, expect.anything());
    expect(http.post).toHaveBeenCalledWith('/api/images/abc/tags', { name: 'new-tag' }, expect.anything());
    expect(media.tags).toEqual(['new-tag']);
    expect(select.selectedOptions.map(option => option.text)).toEqual(['new-tag']);
    expect(select.text).toBe('new-tag');
    expect(checkboxFor(selectElementFor(fixture, select), 'new-tag').checked).toBe(true);
  });

  it('creates and selects a new actor through the media service', async () => {
    const { fixture, media, http } = await createHarness(createMedia());
    const select = selectFor(fixture, '+ People');

    select.open = true;
    fixture.detectChanges();
    select.createText = 'new-actor';
    select.create();
    await flush(fixture);

    expect(http.post).toHaveBeenCalledWith('/api/actors', { actor: 'new-actor' }, expect.anything());
    expect(http.post).toHaveBeenCalledWith('/api/images/abc/actors', { name: 'new-actor' }, expect.anything());
    expect(media.actors).toEqual(['new-actor']);
    expect(select.selectedOptions.map(option => option.text)).toEqual(['new-actor']);
    expect(select.text).toBe('new-actor');
    expect(checkboxFor(selectElementFor(fixture, select), 'new-actor').checked).toBe(true);
  });

  it('alerts and leaves the selection unchanged when attaching the new tag fails', async () => {
    const { fixture, media, http, alerts } = await createHarness(createMedia());
    http.post.mockImplementation((url: string, body: { tag?: string }) => {
      if (url === '/api/tags') {
        return of(['existing-tag', body.tag]);
      }
      return throwError(() => new Error('attach failed'));
    });
    const select = selectFor(fixture, '+ Tags');

    select.open = true;
    fixture.detectChanges();
    select.createText = 'bad-tag';
    select.create();
    await flush(fixture);

    expect(alerts.show).toHaveBeenCalledWith({ type: 'danger', message: 'Failed to add tag: abc: bad-tag' });
    expect(media.tags).toEqual([]);
    expect(select.selectedOptions).toEqual([]);
    expect(select.text).toBeUndefined();
  });
});

describe('MetadataComponent generated caption', () => {
  it('labels the caption above May contain and clears it through the media service', async () => {
    const { fixture, media, http } = await createHarness({ ...createMedia(), autoCaption: 'a dog on a beach', autoTags: ['tag'] } as unknown as Media);
    // The PATCH response is the cleared media, as the server returns it.
    http.patch.mockReturnValue(of({ ...media, autoCaption: undefined }));

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Caption:');
    // Assert presence first: indexOf is -1 when the caption is missing, and
    // -1 < indexOf('May contain:') would pass vacuously.
    expect(text).toContain('a dog on a beach');
    expect(text.indexOf('a dog on a beach')).toBeLessThan(text.indexOf('May contain:'));

    const button = fixture.debugElement.query(By.css('[data-id="clear-auto-caption"]'));
    expect(button).not.toBeNull();

    (button.nativeElement as HTMLButtonElement).click();
    await flush(fixture);

    // null is the unprocessed state, not the '' "processed, nothing produced" marker.
    expect(http.patch).toHaveBeenCalledWith('/api/images/abc', { autoCaption: null }, expect.anything());
    expect(fixture.nativeElement.textContent).not.toContain('a dog on a beach');
    expect(fixture.debugElement.query(By.css('[data-id="clear-auto-caption"]'))).toBeNull();
  });
});
