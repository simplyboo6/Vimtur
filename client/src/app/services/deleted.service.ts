import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { DeletedMedia } from '@vimtur/common';

// The import ignore list as the config page's Deleted Paths tab sees it. The
// list is one row per deleted path, so the tab holds it in memory and filters
// client-side; there is no paging or query support here.
@Injectable({
  providedIn: 'root',
})
export class DeletedService {
  private httpClient: HttpClient;

  public constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  public getDeletedPaths(): Observable<DeletedMedia[]> {
    return this.httpClient.get<DeletedMedia[]>('/api/deleted');
  }

  // Removes every path recorded for the content hash: the server ignores content
  // by hash as well as by path, so a single surviving row would keep the file
  // ignored everywhere (see server/src/routes/deleted.ts).
  public removeDeletedPath(hash: string): Observable<void> {
    return this.httpClient.delete<void>(`/api/deleted/${hash}`);
  }
}
