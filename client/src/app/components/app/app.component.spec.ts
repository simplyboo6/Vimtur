import { ActivatedRoute } from '@angular/router';
import { describe, expect, it, MockInstance, vi } from 'vitest';

import { CollectionService } from 'services/collection.service';
import { ConfigService } from 'services/config.service';
import { GalleryService } from 'services/gallery.service';
import { UiService } from 'services/ui.service';
import { AppComponent } from './app.component';

interface Harness {
  component: AppComponent;
  offset: MockInstance;
  scrollByViewport: MockInstance;
}

function createHarness(url: string): Harness {
  const offset = vi.fn();
  const scrollByViewport = vi.fn();
  const collectionService = { offset };
  const galleryService = { scrollByViewport };
  // getRoute() reads the pre-redirect URL off the router state snapshot.
  const route = { snapshot: { _routerState: { url } } };

  const component = new AppComponent(
    collectionService as unknown as CollectionService,
    galleryService as unknown as GalleryService,
    {} as unknown as ConfigService,
    {} as unknown as UiService,
    route as unknown as ActivatedRoute,
  );

  return { component, offset, scrollByViewport };
}

describe('AppComponent', () => {
  it('scrolls the gallery by a viewport for the gallery arrows', () => {
    const harness = createHarness('/gallery');

    harness.component.keyEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }));
    harness.component.keyEvent(new KeyboardEvent('keyup', { code: 'ArrowRight' }));

    expect(harness.scrollByViewport.mock.calls).toEqual([[-1], [1]]);
    expect(harness.offset).not.toHaveBeenCalled();
  });

  it('steps the collection for the singular route arrows', () => {
    const harness = createHarness('/viewer');

    harness.component.keyEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }));
    harness.component.keyEvent(new KeyboardEvent('keyup', { code: 'ArrowRight' }));

    expect(harness.offset.mock.calls).toEqual([[-1], [1]]);
    expect(harness.scrollByViewport).not.toHaveBeenCalled();
  });
});
