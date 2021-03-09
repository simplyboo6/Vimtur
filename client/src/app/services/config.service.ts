import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, ReplaySubject } from 'rxjs';
import { Configuration } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';

const HTTP_OPTIONS = {
  headers: new HttpHeaders({
    'Content-Type': 'application/json',
  }),
};

@Injectable({
  providedIn: 'root',
})
export class ConfigService {
  private httpClient: HttpClient;
  private alertService: AlertService;
  private configReplay: ReplaySubject<Configuration.Main> = new ReplaySubject(1);

  public config?: Configuration.Main;

  public constructor(httpClient: HttpClient, alertService: AlertService) {
    this.httpClient = httpClient;
    this.alertService = alertService;
    this.httpClient.get<Configuration.Main>('/api/config').subscribe(
      res => {
        this.configReplay.next(res);
        this.config = res;
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        this.alertService.show({ type: 'danger', message: 'Failed to fetch configuration' });
      },
    );
  }

  public getVersion(): Observable<string> {
    // As json because of incorrect typings.
    return this.httpClient.get<string>('/api/version', { responseType: 'text' as 'json' });
  }

  public getConfiguration(): ReplaySubject<Configuration.Main> {
    return this.configReplay;
  }

  public updateConfiguration(config: Configuration.Partial) {
    this.httpClient.post<Configuration.Main>('/api/config', config, HTTP_OPTIONS).subscribe(
      res => {
        this.configReplay.next(res);
        this.config = res;
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        this.alertService.show({ type: 'danger', message: 'Failed to save configuration' });
      },
    );
  }
}
