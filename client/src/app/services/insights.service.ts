import { HttpClient, HttpResponse, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ReplaySubject } from 'rxjs';
import { InsightsResponse } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';

@Injectable({
  providedIn: 'root',
})
export class InsightsService {
  private httpClient: HttpClient;
  private alertService: AlertService;
  private insightsReplay: ReplaySubject<InsightsResponse> = new ReplaySubject(1);

  public constructor(httpClient: HttpClient, alertService: AlertService) {
    this.httpClient = httpClient;
    this.alertService = alertService;

    this.httpClient.get<InsightsResponse>(`/api/insights`).subscribe(
      res => this.insightsReplay.next(res),
      (err: HttpErrorResponse) => {
        console.error(err);
        this.alertService.show({ type: 'danger', message: 'Failed to fetch insights' });
      },
    );
  }

  public getInsights(): ReplaySubject<InsightsResponse> {
    return this.insightsReplay;
  }
}
