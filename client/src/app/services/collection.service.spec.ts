import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { SubsetConstraints } from '@vimtur/common';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AlertService } from 'app/services/alert.service';
import { CollectionMetadata, CollectionService } from 'app/services/collection.service';
import { ConfirmationResult, ConfirmationService } from 'app/services/confirmation.service';
import { ConfigService } from 'app/services/config.service';
import { PromptService } from 'app/services/prompt.service';

interface Harness {
  service: CollectionService;
  metadata: Array<CollectionMetadata | undefined>;
  alerts: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  httpDelete: ReturnType<typeof vi.fn>;
  confirmWith: ReturnType<typeof vi.fn>;
}

function createHarness(collection = ['a', 'b', 'c']): Harness {
  const httpClient = { post: vi.fn(() => of(collection)), delete: vi.fn(() => of('')) };
  const alerts = vi.fn();
  const prompt = vi.fn();
  const confirmWith = vi.fn((): Promise<ConfirmationResult> => Promise.resolve({ confirmed: true, checkbox: false }));
  const service = new CollectionService(
    httpClient as unknown as HttpClient,
    { show: alerts } as unknown as AlertService,
    { confirmWith } as unknown as ConfirmationService,
    { prompt } as unknown as PromptService,
    { config: { user: {} } } as unknown as ConfigService,
    { navigate: vi.fn() } as unknown as Router,
  );

  const metadata: Array<CollectionMetadata | undefined> = [];
  service.getMetadata().subscribe(value => metadata.push(value));
  service.search({} as SubsetConstraints, { noRedirect: true });

  return { service, metadata, alerts, prompt, httpDelete: httpClient.delete, confirmWith };
}

function message(alerts: ReturnType<typeof vi.fn>): unknown {
  return (alerts.mock.calls.at(-1)?.[0] as { message?: string } | undefined)?.message;
}

describe('CollectionService.deleteCurrent', () => {
  const flush = async (): Promise<void> => {
    // Confirm resolves, then the delete subscription runs.
    await Promise.resolve();
    await Promise.resolve();
  };

  it('keeps the source file unless the checkbox was ticked', async () => {
    const harness = createHarness();

    harness.service.deleteCurrent();
    await flush();

    expect(harness.confirmWith).toHaveBeenCalledWith(
      'Are you sure you want to delete the current media?',
      expect.objectContaining({
        negative: true,
        checkboxLabel: 'Also delete the source file from disk (cannot be undone)',
      }),
    );
    expect(harness.httpDelete).toHaveBeenCalledWith('/api/images/a', {
      params: { deleteFile: 'false' },
      responseType: 'text',
    });
  });

  it('deletes the source file when the checkbox was ticked', async () => {
    const harness = createHarness();
    harness.confirmWith.mockResolvedValue({ confirmed: true, checkbox: true });

    harness.service.deleteCurrent();
    await flush();

    expect(harness.httpDelete).toHaveBeenCalledWith('/api/images/a', {
      params: { deleteFile: 'true' },
      responseType: 'text',
    });
  });

  it('does nothing when the deletion is cancelled', async () => {
    const harness = createHarness();
    harness.confirmWith.mockResolvedValue({ confirmed: false, checkbox: true });

    harness.service.deleteCurrent();
    await flush();

    expect(harness.httpDelete).not.toHaveBeenCalled();
  });
});

describe('CollectionService.goto', () => {
  it('treats numeric input as a 1-based item index', () => {
    const harness = createHarness();

    expect(harness.service.goto('2')).toBe(true);

    expect(harness.metadata.at(-1)?.index).toBe(1);
  });

  it('gotoes a hash within the collection', () => {
    const harness = createHarness();

    expect(harness.service.goto('c')).toBe(true);

    expect(harness.metadata.at(-1)?.index).toBe(2);
  });

  it('rejects an out-of-range index with a warning', () => {
    const harness = createHarness();

    expect(harness.service.goto('0')).toBe(false);
    expect(message(harness.alerts)).toBe('Index is not within the collection');

    expect(harness.service.goto('4')).toBe(false);
    expect(message(harness.alerts)).toBe('Index is not within the collection');
  });

  it('rejects an unknown hash with a warning', () => {
    const harness = createHarness();

    expect(harness.service.goto('missing')).toBe(false);
    expect(message(harness.alerts)).toBe('Could not find hash in set');
  });

  it('prompts when no location is given and reports no result', async () => {
    const harness = createHarness();
    harness.prompt.mockResolvedValue('2');

    expect(harness.service.goto()).toBe(false);
    expect(harness.prompt).toHaveBeenCalledWith('Goto');

    // The prompted goto resolves on the next microtask and applies the index.
    await Promise.resolve();
    expect(harness.metadata.at(-1)?.index).toBe(1);
  });
});
