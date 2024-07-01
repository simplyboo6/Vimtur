import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ReplaySubject } from 'rxjs';
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
        this.tagReplay.next(res.sort()), (this.tags = res);
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

  public addTag(tag: string) {
    this.httpClient.post<string[]>(`/api/tags`, { tag }, HTTP_OPTIONS).subscribe(
      res => {
        this.alertService.show({ type: 'info', message: `Added tag '${tag}'`, autoClose: 3000 });
        this.tagReplay.next(res);
        this.tags = res;
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        const message = (err && err.error && err.error.message) || `Failed to add tag '${tag}'`;
        this.alertService.show({ type: 'warning', message, autoClose: 5000 });
      },
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
