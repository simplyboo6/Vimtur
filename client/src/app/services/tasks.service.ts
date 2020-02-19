import { HttpClient, HttpResponse, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import * as IO from 'socket.io-client';
import { Injectable } from '@angular/core';
import { ReplaySubject, Observable } from 'rxjs';
import { QueuedTask, ListedTask } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';
import { ConfigService } from './config.service';

const HTTP_OPTIONS = {
  headers: new HttpHeaders({
    'Content-Type': 'application/json',
  }),
};

const ROOT_PATH = '/api/tasks';

@Injectable({
  providedIn: 'root',
})
export class TasksService {
  private httpClient: HttpClient;
  private alertService: AlertService;
  private configService: ConfigService;
  private queue: ReplaySubject<QueuedTask[]> = new ReplaySubject(1);
  private tasks: ReplaySubject<ListedTask[]> = new ReplaySubject(1);
  private socket = IO();

  public constructor(
    httpClient: HttpClient,
    alertService: AlertService,
    configService: ConfigService,
  ) {
    this.httpClient = httpClient;
    this.alertService = alertService;
    this.configService = configService;

    this.socket.on('task-queue', queue => {
      this.queue.next(queue);
    });

    this.socket.on('task-start', data => {
      if (this.configService.config && this.configService.config.user.showTaskNotifications) {
        this.alertService.show({
          type: 'info',
          message: `Task started with ID ${data.id}`,
          autoClose: 3000,
        });
      }
    });

    this.socket.on('task-end', data => {
      if (data.error) {
        this.alertService.show({
          type: 'warning',
          message: `Task failed to complete ${data.id} - ${data.error}`,
        });
      } else if (
        this.configService.config &&
        this.configService.config.user.showTaskNotifications
      ) {
        this.alertService.show({
          type: 'success',
          message: `Task finished with ID ${data.id}`,
          autoClose: 3000,
        });
      }
    });

    this.httpClient.get<QueuedTask[]>(`${ROOT_PATH}/queue`).subscribe(
      res => {
        this.queue.next(res);
      },
      (err: HttpErrorResponse) => {
        console.warn(err);
        this.alertService.show({
          type: 'warning',
          message: `Failed to fetch task queue`,
        });
      },
    );

    this.httpClient.get<ListedTask[]>(`${ROOT_PATH}`).subscribe(
      res => {
        this.tasks.next(res);
      },
      (err: HttpErrorResponse) => {
        console.warn(err);
        this.alertService.show({
          type: 'warning',
          message: `Failed to fetch task list`,
        });
      },
    );
  }

  public startAction(id: string) {
    this.httpClient.post<string>(`${ROOT_PATH}/queue/${id}`, {}, HTTP_OPTIONS).subscribe(
      res => {
        console.debug('Task started', res);
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        this.alertService.show({
          type: 'danger',
          message: `Failed to start task`,
        });
      },
    );
  }

  public cancelAction(id: string) {
    this.httpClient.delete(`${ROOT_PATH}/queue/${id}`).subscribe(
      () => {
        console.debug('Task deleted', id);
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        this.alertService.show({
          type: 'danger',
          message: `Failed to cancel task`,
        });
      },
    );
  }

  public getTasks(): Observable<ListedTask[]> {
    return this.tasks;
  }

  public startImport() {
    this.startAction('AUTO-IMPORT');
  }

  public getQueue(): Observable<QueuedTask[]> {
    return this.queue;
  }
}
