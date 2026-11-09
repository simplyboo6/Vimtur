import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ActorService } from 'app/services/actor.service';
import { AlertService } from 'app/services/alert.service';

function createService(initialActors: string[]) {
  const http = {
    get: vi.fn(),
    post: vi.fn(),
  };
  http.get.mockReturnValue(of(initialActors));
  const alerts = {
    show: vi.fn(),
    dismiss: vi.fn(),
  };
  const service = new ActorService(http as unknown as HttpClient, alerts as unknown as AlertService);
  return { service, http, alerts };
}

describe('ActorService', () => {
  it('sorts the initial GET list with the default ordering', () => {
    const { service } = createService(['banana', 'Apple', 'cherry']);

    expect(service.actors).toEqual(['Apple', 'banana', 'cherry']);

    const replayed: string[][] = [];
    service.getActors().subscribe(actors => replayed.push(actors));
    expect(replayed.at(-1)).toBe(service.actors);
  });

  it('sorts the added actor and shares the sorted array between the replay and service.actors', () => {
    const { service, http } = createService([]);
    http.post.mockReturnValue(of(['banana', 'Apple', 'cherry']));

    let emitted: string[] | undefined;
    service.addActor('cherry').subscribe(actors => {
      emitted = actors;
    });

    expect(emitted).toEqual(['Apple', 'banana', 'cherry']);
    expect(service.actors).toEqual(['Apple', 'banana', 'cherry']);
    expect(service.actors).toBe(emitted);

    const replayed: string[][] = [];
    service.getActors().subscribe(actors => replayed.push(actors));
    expect(replayed.at(-1)).toBe(service.actors);
    expect(http.post).toHaveBeenCalledWith('/api/actors', { actor: 'cherry' }, expect.anything());
  });
});
