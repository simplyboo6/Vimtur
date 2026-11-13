import { HttpClient } from '@angular/common/http';
import { DeletedMedia } from '@vimtur/common';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DeletedService } from 'app/services/deleted.service';

function createService(entries: DeletedMedia[] = []) {
  const http = {
    get: vi.fn(() => of(entries)),
    delete: vi.fn(() => of(undefined)),
  };
  const service = new DeletedService(http as unknown as HttpClient);
  return { service, http };
}

describe('DeletedService', () => {
  it('reads the whole ignore list from /api/deleted', () => {
    const entries: DeletedMedia[] = [
      { hash: 'hash-a', path: 'a.png' },
      { hash: 'hash-a', path: 'copy/a.png' },
    ];
    const { service, http } = createService(entries);

    let emitted: DeletedMedia[] | undefined;
    service.getDeletedPaths().subscribe(rows => {
      emitted = rows;
    });

    expect(http.get).toHaveBeenCalledWith('/api/deleted');
    expect(emitted).toBe(entries);
  });

  it('removes an ignored entry by content hash', () => {
    const { service, http } = createService();

    service.removeDeletedPath('hash-a').subscribe();

    expect(http.delete).toHaveBeenCalledWith('/api/deleted/hash-a');
  });
});
