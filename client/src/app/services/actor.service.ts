import { HttpClient, HttpResponse, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ReplaySubject } from 'rxjs';
import { Media } from '@vimtur/common';
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

  public addActor(actor: string) {
    this.httpClient.post<string[]>(`/api/actors`, { actor }, HTTP_OPTIONS).subscribe(
      res => {
        this.alertService.show({
          type: 'info',
          message: `Added actor '${actor}'`,
          autoClose: 3000,
        });
        this.actorReplay.next(res);
        this.actors = res;
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        const message = (err && err.error && err.error.message) || `Failed to add actor '${actor}'`;
        this.alertService.show({ type: 'warning', message, autoClose: 5000 });
      },
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
        const message =
          (err && err.error && err.error.message) || `Failed to delete actor '${actor}'`;
        this.alertService.show({ type: 'warning', message, autoClose: 5000 });
      },
    );
  }
}
