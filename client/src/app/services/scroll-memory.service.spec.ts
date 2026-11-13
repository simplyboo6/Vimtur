import { describe, expect, it } from 'vitest';

import { ScrollMemoryService } from 'app/services/scroll-memory.service';

describe('ScrollMemoryService', () => {
  it('returns undefined for a route that was never remembered', () => {
    const service = new ScrollMemoryService();

    expect(service.recall('/gallery')).toBeUndefined();
  });

  it('remembers positions per route', () => {
    const service = new ScrollMemoryService();

    service.remember('/gallery', 1200);
    service.remember('/viewer', 40);

    expect(service.recall('/gallery')).toBe(1200);
    expect(service.recall('/viewer')).toBe(40);
    expect(service.recall('/metadata')).toBeUndefined();
  });

  it('overwrites the position for the same route', () => {
    const service = new ScrollMemoryService();

    service.remember('/gallery', 1200);
    service.remember('/gallery', 350);

    expect(service.recall('/gallery')).toBe(350);
  });

  it('forgets only the named route', () => {
    const service = new ScrollMemoryService();

    service.remember('/gallery', 1200);
    service.remember('/viewer', 40);
    service.forget('/gallery');

    expect(service.recall('/gallery')).toBeUndefined();
    expect(service.recall('/viewer')).toBe(40);
  });
});
