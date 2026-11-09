import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AlertService } from 'app/services/alert.service';
import { TagService } from 'app/services/tag.service';

function createService(initialTags: string[]) {
  const http = {
    get: vi.fn(),
    post: vi.fn(),
  };
  http.get.mockReturnValue(of(initialTags));
  const alerts = {
    show: vi.fn(),
    dismiss: vi.fn(),
  };
  const service = new TagService(http as unknown as HttpClient, alerts as unknown as AlertService);
  return { service, http, alerts };
}

describe('TagService', () => {
  it('sorts the initial GET list with the default ordering', () => {
    const { service } = createService(['banana', 'Apple', 'cherry']);

    expect(service.tags).toEqual(['Apple', 'banana', 'cherry']);

    const replayed: string[][] = [];
    service.getTags().subscribe(tags => replayed.push(tags));
    expect(replayed.at(-1)).toBe(service.tags);
  });

  it('sorts the added tag and shares the sorted array between the replay and service.tags', () => {
    const { service, http } = createService([]);
    http.post.mockReturnValue(of(['banana', 'Apple', 'cherry']));

    let emitted: string[] | undefined;
    service.addTag('cherry').subscribe(tags => {
      emitted = tags;
    });

    expect(emitted).toEqual(['Apple', 'banana', 'cherry']);
    expect(service.tags).toEqual(['Apple', 'banana', 'cherry']);
    expect(service.tags).toBe(emitted);

    const replayed: string[][] = [];
    service.getTags().subscribe(tags => replayed.push(tags));
    expect(replayed.at(-1)).toBe(service.tags);
    expect(http.post).toHaveBeenCalledWith('/api/tags', { tag: 'cherry' }, expect.anything());
  });
});
