import { HttpClient } from '@angular/common/http';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Media } from '@vimtur/common';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ActorService } from 'app/services/actor.service';
import { AlertService } from 'app/services/alert.service';
import { CollectionService } from 'app/services/collection.service';
import { MediaService } from 'app/services/media.service';
import { TagService } from 'app/services/tag.service';

function createService(tags?: string[], actors?: string[]) {
  const http = {
    post: vi.fn(),
    patch: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  };
  const alerts = {
    show: vi.fn(),
    dismiss: vi.fn(),
  };
  const tagService = {
    tags,
    addTag: vi.fn(),
  };
  const actorService = {
    actors,
    addActor: vi.fn(),
  };
  const collectionService = {
    getMetadata: () => of(undefined),
  };

  const service = new MediaService(
    http as unknown as HttpClient,
    alerts as unknown as AlertService,
    tagService as unknown as TagService,
    actorService as unknown as ActorService,
    {} as NgbModal,
    collectionService as unknown as CollectionService,
  );

  return { service, http, alerts, tagService, actorService };
}

function createMedia(tags: string[] = [], actors: string[] = []): Media {
  return { hash: 'hash', tags, actors } as unknown as Media;
}

describe('MediaService tags', () => {
  it('creates a missing tag before attaching it', () => {
    const { service, http, tagService } = createService([]);
    const media = createMedia();
    const originalTags = media.tags;
    tagService.addTag.mockReturnValue(of([]));
    http.post.mockReturnValue(of(null));
    service.media = media;

    service.addTag('new-tag');

    expect(tagService.addTag).toHaveBeenCalledWith('new-tag');
    expect(http.post).toHaveBeenCalledWith('/api/images/hash/tags', { name: 'new-tag' }, expect.anything());
    expect(tagService.addTag.mock.invocationCallOrder[0]).toBeLessThan(http.post.mock.invocationCallOrder[0]);
    expect(media.tags).toEqual(['new-tag']);
    // Consumers keyed on the array reference must see a new array.
    expect(media.tags).not.toBe(originalTags);
  });

  it('attaches an existing tag without creating it', () => {
    const { service, http, tagService } = createService(['existing']);
    const media = createMedia();
    http.post.mockReturnValue(of(null));
    service.media = media;

    service.addTag('existing');

    expect(tagService.addTag).not.toHaveBeenCalled();
    expect(http.post).toHaveBeenCalledWith('/api/images/hash/tags', { name: 'existing' }, expect.anything());
    expect(media.tags).toEqual(['existing']);
  });

  it('does not attach when creating the tag fails', () => {
    const { service, http, alerts, tagService } = createService([]);
    const media = createMedia();
    tagService.addTag.mockReturnValue(throwError(() => new Error('create failed')));
    service.media = media;

    service.addTag('new-tag');

    expect(http.post).not.toHaveBeenCalled();
    expect(alerts.show).toHaveBeenCalledWith({ type: 'danger', message: 'Failed to add tag: hash: new-tag' });
    expect(media.tags).toEqual([]);
  });

  it('alerts and leaves the media unchanged when attaching the tag fails', () => {
    const { service, http, alerts, tagService } = createService([]);
    const media = createMedia();
    tagService.addTag.mockReturnValue(of([]));
    http.post.mockReturnValue(throwError(() => new Error('attach failed')));
    service.media = media;

    service.addTag('new-tag');

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(alerts.show).toHaveBeenCalledWith({ type: 'danger', message: 'Failed to add tag: hash: new-tag' });
    expect(media.tags).toEqual([]);
  });

  it('makes no requests for a tag already attached to the media', () => {
    const { service, http, alerts, tagService } = createService(['existing']);
    const media = createMedia(['existing']);
    service.media = media;

    service.addTag('existing');

    expect(tagService.addTag).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
    expect(alerts.show).not.toHaveBeenCalled();
  });

  it('sorts the media tag array when attaching an existing tag', () => {
    const { service, http, tagService } = createService(['alpha', 'beta', 'zeta']);
    const media = createMedia(['zeta', 'beta']);
    const originalTags = media.tags;
    http.post.mockReturnValue(of(null));
    service.media = media;

    service.addTag('alpha');

    expect(tagService.addTag).not.toHaveBeenCalled();
    expect(http.post).toHaveBeenCalledWith('/api/images/hash/tags', { name: 'alpha' }, expect.anything());
    expect(media.tags).toEqual(['alpha', 'beta', 'zeta']);
    expect(media.tags).not.toBe(originalTags);
  });

  it('sorts the media tag array when creating and attaching a missing tag', () => {
    const { service, http, tagService } = createService([]);
    const media = createMedia(['zeta', 'beta']);
    const originalTags = media.tags;
    tagService.addTag.mockReturnValue(of(['alpha']));
    http.post.mockReturnValue(of(null));
    service.media = media;

    service.addTag('alpha');

    expect(tagService.addTag).toHaveBeenCalledWith('alpha');
    expect(http.post).toHaveBeenCalledWith('/api/images/hash/tags', { name: 'alpha' }, expect.anything());
    expect(media.tags).toEqual(['alpha', 'beta', 'zeta']);
    expect(media.tags).not.toBe(originalTags);
  });

  it('replaces the tag array when removing a tag', () => {
    const { service, http } = createService(['existing']);
    const media = createMedia(['existing']);
    const originalTags = media.tags;
    http.delete.mockReturnValue(of(null));
    service.media = media;

    service.removeTag('existing');

    expect(media.tags).toEqual([]);
    expect(media.tags).not.toBe(originalTags);
    expect(http.delete).toHaveBeenCalledWith('/api/images/hash/tags/existing');
  });
});

describe('MediaService actors', () => {
  it('creates a missing actor before attaching it', () => {
    const { service, http, actorService } = createService([], []);
    const media = createMedia();
    const originalActors = media.actors;
    actorService.addActor.mockReturnValue(of([]));
    http.post.mockReturnValue(of(null));
    service.media = media;

    service.addActor('new-actor');

    expect(actorService.addActor).toHaveBeenCalledWith('new-actor');
    expect(http.post).toHaveBeenCalledWith('/api/images/hash/actors', { name: 'new-actor' }, expect.anything());
    expect(actorService.addActor.mock.invocationCallOrder[0]).toBeLessThan(http.post.mock.invocationCallOrder[0]);
    expect(media.actors).toEqual(['new-actor']);
    // Consumers keyed on the array reference must see a new array.
    expect(media.actors).not.toBe(originalActors);
  });

  it('attaches an existing actor without creating it', () => {
    const { service, http, actorService } = createService([], ['existing']);
    const media = createMedia();
    http.post.mockReturnValue(of(null));
    service.media = media;

    service.addActor('existing');

    expect(actorService.addActor).not.toHaveBeenCalled();
    expect(http.post).toHaveBeenCalledWith('/api/images/hash/actors', { name: 'existing' }, expect.anything());
    expect(media.actors).toEqual(['existing']);
  });

  it('does not attach when creating the actor fails', () => {
    const { service, http, alerts, actorService } = createService([], []);
    const media = createMedia();
    actorService.addActor.mockReturnValue(throwError(() => new Error('create failed')));
    service.media = media;

    service.addActor('new-actor');

    expect(http.post).not.toHaveBeenCalled();
    expect(alerts.show).toHaveBeenCalledWith({ type: 'danger', message: 'Failed to add actor: hash: new-actor' });
    expect(media.actors).toEqual([]);
  });

  it('alerts and leaves the media unchanged when attaching the actor fails', () => {
    const { service, http, alerts, actorService } = createService([], []);
    const media = createMedia();
    actorService.addActor.mockReturnValue(of([]));
    http.post.mockReturnValue(throwError(() => new Error('attach failed')));
    service.media = media;

    service.addActor('new-actor');

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(alerts.show).toHaveBeenCalledWith({ type: 'danger', message: 'Failed to add actor: hash: new-actor' });
    expect(media.actors).toEqual([]);
  });

  it('makes no requests for an actor already attached to the media', () => {
    const { service, http, alerts, actorService } = createService([], ['existing']);
    const media = createMedia([], ['existing']);
    service.media = media;

    service.addActor('existing');

    expect(actorService.addActor).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
    expect(alerts.show).not.toHaveBeenCalled();
  });

  it('sorts the media actor array when attaching an existing actor', () => {
    const { service, http, actorService } = createService([], ['alpha', 'beta', 'zeta']);
    const media = createMedia([], ['zeta', 'beta']);
    const originalActors = media.actors;
    http.post.mockReturnValue(of(null));
    service.media = media;

    service.addActor('alpha');

    expect(actorService.addActor).not.toHaveBeenCalled();
    expect(http.post).toHaveBeenCalledWith('/api/images/hash/actors', { name: 'alpha' }, expect.anything());
    expect(media.actors).toEqual(['alpha', 'beta', 'zeta']);
    expect(media.actors).not.toBe(originalActors);
  });

  it('sorts the media actor array when creating and attaching a missing actor', () => {
    const { service, http, actorService } = createService([], []);
    const media = createMedia([], ['zeta', 'beta']);
    const originalActors = media.actors;
    actorService.addActor.mockReturnValue(of(['alpha']));
    http.post.mockReturnValue(of(null));
    service.media = media;

    service.addActor('alpha');

    expect(actorService.addActor).toHaveBeenCalledWith('alpha');
    expect(http.post).toHaveBeenCalledWith('/api/images/hash/actors', { name: 'alpha' }, expect.anything());
    expect(media.actors).toEqual(['alpha', 'beta', 'zeta']);
    expect(media.actors).not.toBe(originalActors);
  });

  it('replaces the actor array when removing an actor', () => {
    const { service, http } = createService([], ['existing']);
    const media = createMedia([], ['existing']);
    const originalActors = media.actors;
    http.delete.mockReturnValue(of(null));
    service.media = media;

    service.removeActor('existing');

    expect(media.actors).toEqual([]);
    expect(media.actors).not.toBe(originalActors);
    expect(http.delete).toHaveBeenCalledWith('/api/images/hash/actors/existing');
  });
});
