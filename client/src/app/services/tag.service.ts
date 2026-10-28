import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, ReplaySubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AlertService } from 'app/services/alert.service';

const HTTP_OPTIONS = {
  headers: new HttpHeaders({
    'Content-Type': 'application/json',
  }),
};

@Injectable({
  providedIn: 'root',
})
export class TagService {
  private httpClient: HttpClient;
  private alertService: AlertService;
  private tagReplay: ReplaySubject<string[]> = new ReplaySubject(1);
  public tags?: string[];

  public constructor(httpClient: HttpClient, alertService: AlertService) {
    this.httpClient = httpClient;
    this.alertService = alertService;

    this.httpClient.get<string[]>(`/api/tags`).subscribe(
      res => {
        // res.sort() mutates in place and returns the same array, so the
        // replay subject and this.tags share the sorted instance.
        const sorted = res.sort();
        this.tagReplay.next(sorted);
        this.tags = sorted;
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        this.alertService.show({ type: 'danger', message: 'Failed to fetch tags' });
      },
    );
  }

  public getTags(): ReplaySubject<string[]> {
    return this.tagReplay;
  }

  // Returns the create request so callers can chain follow-up work (e.g.
  // attaching the tag to media) off its completion. Success side effects
  // (alerting and updating the local tag list) happen here; errors are left
  // to the subscriber to handle.
  public addTag(tag: string): Observable<string[]> {
    return this.httpClient.post<string[]>(`/api/tags`, { tag }, HTTP_OPTIONS).pipe(
      tap(res => {
        this.alertService.show({ type: 'info', message: `Added tag '${tag}'`, autoClose: 3000 });
        this.tagReplay.next(res);
        this.tags = res;
      }),
    );
  }

  public deleteTag(tag: string) {
    this.httpClient.delete<string[]>(`/api/tags/${tag}`).subscribe(
      res => {
        this.alertService.show({ type: 'info', message: `Deleted tag '${tag}'`, autoClose: 3000 });
        this.tagReplay.next(res);
        this.tags = res;
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        const message = (err && err.error && err.error.message) || `Failed to delete tag '${tag}'`;
        this.alertService.show({ type: 'warning', message, autoClose: 5000 });
      },
    );
  }
}
