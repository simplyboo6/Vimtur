import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmationService } from 'app/services/confirmation.service';

// The modal instance the service writes its options onto, then reads the
// checkbox state back from at close time.
interface ModalInstance {
  title?: string;
  negative?: boolean;
  message?: string;
  details?: string[];
  checkboxLabel?: string;
  checkbox?: boolean;
}

interface Deferred {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

function createDeferred(): Deferred {
  let resolve: (value: unknown) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createService(): {
  service: ConfirmationService;
  open: ReturnType<typeof vi.fn>;
  instance: ModalInstance;
  deferred: Deferred;
} {
  const deferred = createDeferred();
  const instance: ModalInstance = {};
  const modalRef = { componentInstance: instance, result: deferred.promise };
  const open = vi.fn(() => modalRef);
  const service = new ConfirmationService({ open } as unknown as NgbModal);
  return { service, open, instance, deferred };
}

describe('ConfirmationService', () => {
  it('copies the title and body options onto the modal instance', () => {
    const { service, open, instance } = createService();

    void service.confirmWith('Remove this entry?', {
      negative: true,
      message: 'The following paths will go:',
      details: ['a.png', 'copy/a.png'],
      checkboxLabel: 'Also delete the source file',
    });

    expect(open).toHaveBeenCalledTimes(1);
    expect(instance.title).toBe('Remove this entry?');
    expect(instance.negative).toBe(true);
    expect(instance.message).toBe('The following paths will go:');
    expect(instance.details).toEqual(['a.png', 'copy/a.png']);
    expect(instance.checkboxLabel).toBe('Also delete the source file');
    // Nothing sets an initial checkbox state, so every dialog opens unchecked.
    expect(instance.checkbox).toBe(false);
  });

  it('returns the checkbox state as it stands when the modal closes', async () => {
    const { service, instance, deferred } = createService();

    const pending = service.confirmWith('Remove this entry?', { checkboxLabel: 'Also delete the source file' });
    // The user ticks the box before pressing Confirm; the result reads the live
    // instance rather than a snapshot from open time.
    instance.checkbox = true;
    deferred.resolve(true);

    await expect(pending).resolves.toEqual({ confirmed: true, checkbox: true });
  });

  it('treats a dismissed modal as an unconfirmed result', async () => {
    const { service, instance, deferred } = createService();

    const pending = service.confirmWith('Remove this entry?');
    instance.checkbox = true;
    deferred.reject(new Error('dismissed'));

    await expect(pending).resolves.toEqual({ confirmed: false, checkbox: true });
  });

  it('resolves the legacy confirm() call to a plain boolean', async () => {
    const confirmed = createService();
    const accepted = confirmed.service.confirm('Remove this entry?', true);
    confirmed.deferred.resolve(true);
    await expect(accepted).resolves.toBe(true);

    const dismissed = createService();
    const rejected = dismissed.service.confirm('Remove this entry?', true);
    dismissed.deferred.reject(new Error('dismissed'));
    await expect(rejected).resolves.toBe(false);
  });
});
