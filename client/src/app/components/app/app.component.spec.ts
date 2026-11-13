import { ActivatedRoute } from '@angular/router';
import { describe, expect, it, MockInstance, vi } from 'vitest';

import { CollectionService } from 'services/collection.service';
import { ConfigService } from 'services/config.service';
import { UiService } from 'services/ui.service';
import { AppComponent } from './app.component';

interface Harness {
  component: AppComponent;
  offset: MockInstance;
}

function createHarness(url: string): Harness {
  const offset = vi.fn();
  const collectionService = { offset };
  // getRoute() reads the pre-redirect URL off the router state snapshot.
  const route = { snapshot: { _routerState: { url } } };

  const component = new AppComponent(
    collectionService as unknown as CollectionService,
    {} as unknown as ConfigService,
    {} as unknown as UiService,
    route as unknown as ActivatedRoute,
  );

  return { component, offset };
}

describe('AppComponent', () => {
  it('steps the collection for the singular route arrows', () => {
    const harness = createHarness('/viewer');

    harness.component.keyEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }));
    harness.component.keyEvent(new KeyboardEvent('keyup', { code: 'ArrowRight' }));

    expect(harness.offset.mock.calls).toEqual([[-1], [1]]);
  });

  it('does not use the viewer arrows on the gallery route', () => {
    const harness = createHarness('/gallery');

    harness.component.keyEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }));
    harness.component.keyEvent(new KeyboardEvent('keyup', { code: 'ArrowRight' }));

    expect(harness.offset).not.toHaveBeenCalled();
  });
});
