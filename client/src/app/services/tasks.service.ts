import { HttpClient, HttpResponse, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import * as IO from 'socket.io-client';
import { Injectable } from '@angular/core';
import { ReplaySubject, Observable } from 'rxjs';
import { QueuedTask, ListedTask, Scanner } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';
import { ConfigService } from './config.service';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { ListModalComponent } from 'app/components/list-modal/list-modal.component';

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
  private scanResults: ReplaySubject<Scanner.Summary> = new ReplaySubject(1);
  private socket = IO();
  private modalService: NgbModal;

  private completeTasks?: QueuedTask[];

  public constructor(
    httpClient: HttpClient,
    alertService: AlertService,
    configService: ConfigService,
    modalService: NgbModal,
  ) {
    this.httpClient = httpClient;
    this.alertService = alertService;
    this.configService = configService;
    this.modalService = modalService;

    this.socket.on('connect', () => {
      console.debug('Websocket connected');
      this.reloadScanResults();
    });

    this.socket.on('task-queue', queue => {
      console.debug('Task Queue', queue);
      this.completeTasks = queue.filter(task => task.complete);
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
      if (data.error && !data.aborted) {
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

      if (
        !data.error &&
        (data.type === 'SCAN' || data.type === 'DELETE-MISSING' || data.type === 'INDEX')
      ) {
        this.reloadScanResults();
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

    this.reloadScanResults();
  }

  public clearComplete() {
    if (!this.completeTasks) {
      return;
    }

    for (const task of this.completeTasks) {
      this.cancelAction(task.id);
    }
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

  public showScannerFileList(type: 'new' | 'missing'): void {
    this.httpClient.get<string[]>(`${ROOT_PATH}/SCAN/results/${type}`).subscribe(
      res => {
        console.log('type', res);
        const modalRef = this.modalService.open(ListModalComponent, {
          centered: true,
          size: 'xl',
        });

        (modalRef.componentInstance as ListModalComponent).title = `${type} files`;
        (modalRef.componentInstance as ListModalComponent).items = res;
        (modalRef.componentInstance as ListModalComponent).modal = modalRef;
        modalRef.result.catch(() => {
          // Ignore the error. Thrown on cancel/deny
        });
      },
      (err: HttpErrorResponse) => {
        console.warn(err);
        this.alertService.show({
          type: 'warning',
          message: `Failed to fetch list of ${type} files`,
        });
      },
    );
  }

  public getScanResults(): Observable<Scanner.Summary> {
    return this.scanResults;
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

  private reloadScanResults() {
    this.httpClient.get<Scanner.Summary>(`${ROOT_PATH}/SCAN/results`).subscribe(
      res => {
        this.scanResults.next(res);
      },
      (err: HttpErrorResponse) => {
        console.warn(err);
        this.alertService.show({
          type: 'warning',
          message: `Failed to fetch scan results`,
        });
      },
    );
  }
}
