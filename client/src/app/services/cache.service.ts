import { HttpClient, HttpResponse, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import * as IO from 'socket.io-client';
import { Injectable } from '@angular/core';
import { ReplaySubject } from 'rxjs';
import { Scanner } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';

const HTTP_OPTIONS = {
  headers: new HttpHeaders({
    'Content-Type': 'application/json',
  }),
};

export interface AdvancedAction {
  name: string;
  endpoint: string;
}

const ADVANCED_ACTION_LIST: AdvancedAction[] = [
  {
    name: 'Scan for new files',
    endpoint: 'scan',
  },
  {
    name: 'Index/Import new files',
    endpoint: 'index',
  },
  {
    name: 'Generate missing thumbnails',
    endpoint: 'thumbnails',
  },
  {
    name: 'Verify existing thumbnails',
    endpoint: 'verify-thumbnails',
  },
  {
    name: 'Generate video keyframe lookups (if enabled)',
    endpoint: 'keyframes',
  },
  {
    name: 'Cache videos (if enabled)',
    endpoint: 'cache',
  },
  {
    name: 'Generate perceptual hashses',
    endpoint: 'phash',
  },
  {
    name: 'Generate clone map',
    endpoint: 'clone-map',
  },
];

@Injectable({
  providedIn: 'root',
})
export class CacheService {
  private httpClient: HttpClient;
  private alertService: AlertService;
  private status: ReplaySubject<Scanner.StrippedStatus> = new ReplaySubject(1);
  private socket = IO();

  public constructor(httpClient: HttpClient, alertService: AlertService) {
    this.httpClient = httpClient;
    this.alertService = alertService;

    this.socket.on('scanStatus', status => {
      this.status.next(status);
    });

    this.httpClient.get<Scanner.StrippedStatus>(`/api/scanner/status`).subscribe(
      res => {
        this.status.next(res);
      },
      (err: HttpErrorResponse) => {
        console.warn(err);
        this.alertService.show({
          type: 'warning',
          message: `Failed to fetch initial scanner status`,
        });
      },
    );
  }

  public startAction(action: AdvancedAction) {
    this.httpClient
      .post<Scanner.StrippedStatus>(`/api/scanner/${action.endpoint}`, {}, HTTP_OPTIONS)
      .subscribe(
        res => {
          this.status.next(res);
        },
        (err: HttpErrorResponse) => {
          console.error(err);
          this.alertService.show({
            type: 'danger',
            message: `Failed to perform action: ${action.name}`,
          });
        },
      );
  }

  public getActions(): AdvancedAction[] {
    return ADVANCED_ACTION_LIST;
  }

  public startImport() {
    this.startAction({
      name: 'Full import',
      endpoint: 'import',
    });
  }

  public getStatus(): ReplaySubject<Scanner.StrippedStatus> {
    return this.status;
  }
}
