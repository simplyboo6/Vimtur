import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
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
export class ActorService {
  private httpClient: HttpClient;
  private alertService: AlertService;
  private actorReplay: ReplaySubject<string[]> = new ReplaySubject(1);
  public actors?: string[];

  public constructor(httpClient: HttpClient, alertService: AlertService) {
    this.httpClient = httpClient;
    this.alertService = alertService;

    this.httpClient.get<string[]>(`/api/actors`).subscribe(
      res => {
        res.sort();
        this.actorReplay.next(res);
        this.actors = res;
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        this.alertService.show({ type: 'danger', message: 'Failed to fetch actors' });
      },
    );
  }

  public getActors(): ReplaySubject<string[]> {
    return this.actorReplay;
  }

  // Returns the create request so callers can chain follow-up work (e.g.
  // attaching the actor to media) off its completion. Success side effects
  // (alerting and updating the local actor list) happen here; errors are
  // left to the subscriber to handle.
  public addActor(actor: string): Observable<string[]> {
    return this.httpClient.post<string[]>(`/api/actors`, { actor }, HTTP_OPTIONS).pipe(
      tap(res => {
        this.alertService.show({
          type: 'info',
          message: `Added actor '${actor}'`,
          autoClose: 3000,
        });
        this.actorReplay.next(res);
        this.actors = res;
      }),
    );
  }

  public deleteActor(actor: string) {
    this.httpClient.delete<string[]>(`/api/actors/${actor}`).subscribe(
      res => {
        this.alertService.show({
          type: 'info',
          message: `Deleted actor '${actor}'`,
          autoClose: 3000,
        });
        this.actorReplay.next(res);
        this.actors = res;
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        const message = (err && err.error && err.error.message) || `Failed to delete actor '${actor}'`;
        this.alertService.show({ type: 'warning', message, autoClose: 5000 });
      },
    );
  }
}
