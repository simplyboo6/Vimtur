import { HttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Media } from '@vimtur/common';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ActorService } from 'app/services/actor.service';
import { AlertService } from 'app/services/alert.service';
import { CollectionService } from 'app/services/collection.service';
import { ConfigService } from 'app/services/config.service';
import { MediaService } from 'app/services/media.service';
import { PlaylistService } from 'app/services/playlist.service';
import { PromptService } from 'app/services/prompt.service';
import { TagService } from 'app/services/tag.service';
import { TagPanelComponent } from './tag-panel.component';
import { SelectComponent } from '../select/select.component';

async function createHarness(): Promise<{
  fixture: ComponentFixture<TagPanelComponent>;
  media: Media;
  http: { post: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
}> {
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
  http.post.mockImplementation((url: string, body: { actor?: string }) => {
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
  const configService = {
    getConfiguration: () => of({ user: { quickTagShowPeople: true, tagColumnCount: 1 } }),
  };

  const media = { hash: 'abc', tags: [], actors: [], playlists: [] } as unknown as Media;
  mediaService.media = media;
  mediaService.setCurrent(media);

  TestBed.configureTestingModule({
    imports: [TagPanelComponent],
    providers: [
      { provide: ConfigService, useValue: configService },
      { provide: MediaService, useValue: mediaService },
      { provide: TagService, useValue: tagService },
      { provide: ActorService, useValue: actorService },
      { provide: PlaylistService, useValue: playlistService },
      { provide: PromptService, useValue: {} },
    ],
  });

  const fixture = TestBed.createComponent(TagPanelComponent);
  fixture.detectChanges();
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture.detectChanges();

  return { fixture, media, http };
}

describe('TagPanelComponent inline creation', () => {
  it('creates and selects a new actor through the media service', async () => {
    const { fixture, media, http } = await createHarness();
    const select = fixture.debugElement
      .queryAll(By.directive(SelectComponent))
      .map(debugElement => debugElement.componentInstance as SelectComponent)
      .find(candidate => candidate.placeholder === '+ People');
    if (!select) {
      throw new Error('No people select rendered');
    }

    select.open = true;
    fixture.detectChanges();
    select.createText = 'new-actor';
    select.create();
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(http.post).toHaveBeenCalledWith('/api/actors', { actor: 'new-actor' }, expect.anything());
    expect(http.post).toHaveBeenCalledWith('/api/images/abc/actors', { name: 'new-actor' }, expect.anything());
    expect(media.actors).toEqual(['new-actor']);
    expect(select.selectedOptions.map(option => option.text)).toEqual(['new-actor']);
    expect(select.text).toBe('new-actor');
  });
});
