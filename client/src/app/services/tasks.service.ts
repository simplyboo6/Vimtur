import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import IO from 'socket.io-client';
import { Injectable } from '@angular/core';
import { ReplaySubject, Observable, of, throwError, forkJoin } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { QueuedTask, ListedTask, Scanner, TaskArgs } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';
import { ConfigService } from './config.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ListModalComponent } from 'app/components/list-modal/list-modal.component';

const HTTP_OPTIONS = {
  headers: new HttpHeaders({
    'Content-Type': 'application/json',
  }),
};

const ROOT_PATH = '/api/tasks';

// Mirrors the SCAN task_state key constants in server/src/tasks/scanner.ts.
// common is declaration-only, so the literals are duplicated here.
const SCAN_TASK_ID = 'SCAN';
const SCAN_NEW_PATHS_KEY = 'new-paths';
const SCAN_MISSING_PATHS_KEY = 'missing-paths';
const SCAN_GENERATED_AT_KEY = 'generated-at';

@Injectable({
  providedIn: 'root',
})
export class TasksService {
  private httpClient: HttpClient;
  private alertService: AlertService;
  private configService: ConfigService;
  private queue: ReplaySubject<QueuedTask[]> = new ReplaySubject(1);
  private tasks: ReplaySubject<ListedTask[]> = new ReplaySubject(1);
  private scanResults: ReplaySubject<Scanner.ScanResults | undefined> = new ReplaySubject(1);
  private socket = IO();
  private modalService: NgbModal;

  private completeTasks?: QueuedTask[];

  public constructor(httpClient: HttpClient, alertService: AlertService, configService: ConfigService, modalService: NgbModal) {
    this.httpClient = httpClient;
    this.alertService = alertService;
    this.configService = configService;
    this.modalService = modalService;

    this.socket.on('connect', () => {
      console.debug('Websocket connected');
      this.reloadScanResults();
    });

    this.socket.on('task-queue', (queue: QueuedTask[]) => {
      console.debug('Task Queue', queue);
      this.completeTasks = queue.filter(task => task.complete);
      this.queue.next(queue);
    });

    this.socket.on('task-start', (data: QueuedTask) => {
      if (this.configService.config && this.configService.config.user.showTaskNotifications) {
        this.alertService.show({
          type: 'info',
          message: `Task started with ID ${data.id}`,
          autoClose: 3000,
        });
      }
    });

    this.socket.on('task-end', (data: QueuedTask) => {
      if (data.error && !data.aborted) {
        this.alertService.show({
          type: 'warning',
          message: `Task failed to complete ${data.id} - ${data.error}`,
        });
      } else if (this.configService.config && this.configService.config.user.showTaskNotifications) {
        this.alertService.show({
          type: 'success',
          message: `Task finished with ID ${data.id}`,
          autoClose: 3000,
        });
      }

      if (!data.error && (data.type === 'SCAN' || data.type === 'DELETE-MISSING' || data.type === 'INDEX')) {
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

  public startAction(id: string, args?: TaskArgs, onSettled?: (err: HttpErrorResponse | undefined) => void) {
    this.httpClient.post<string>(`${ROOT_PATH}/queue/${id}`, args || {}, HTTP_OPTIONS).subscribe(
      res => {
        console.debug('Task started', res);
        onSettled?.(undefined);
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        this.alertService.show({
          type: 'danger',
          message: err.error?.message || `Failed to start task`,
        });
        onSettled?.(err);
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
    const key = type === 'new' ? SCAN_NEW_PATHS_KEY : SCAN_MISSING_PATHS_KEY;
    this.getTaskState<string[]>(SCAN_TASK_ID, key).subscribe(
      res => {
        const modalRef = this.modalService.open(ListModalComponent, {
          centered: true,
          size: 'xl',
        });

        (modalRef.componentInstance as ListModalComponent).title = `${type} files`;
        // getTaskState maps a 404 to undefined; the link only renders while the
        // scan state exists, so fall back to an empty list rather than erroring.
        (modalRef.componentInstance as ListModalComponent).items = res ?? [];
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

  public getScanResults(): Observable<Scanner.ScanResults | undefined> {
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

  // One-shot read of a task definition's persisted state. A 404 means the state
  // has never been stored (e.g. no calibration run yet), which is a normal
  // state rather than an error, so it resolves to undefined without an alert.
  // Every other failure propagates to the caller to report: turning a
  // connectivity problem into "no state stored" would silently hide it.
  // Deliberately not cached: callers refetch at natural refresh points.
  public getTaskState<T>(taskId: string, key: string): Observable<T | undefined> {
    return this.httpClient.get<T>(`${ROOT_PATH}/state/${taskId}/${key}`).pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.status === 404) {
          return of(undefined);
        }
        return throwError(() => err);
      }),
    );
  }

  private reloadScanResults() {
    // The scan state is three separate task_state keys; the composed record is
    // only a client-side view of them. getTaskState maps a 404 to undefined, so
    // one composition error means one alert, not three.
    forkJoin({
      generatedAt: this.getTaskState<number>(SCAN_TASK_ID, SCAN_GENERATED_AT_KEY),
      newPaths: this.getTaskState<string[]>(SCAN_TASK_ID, SCAN_NEW_PATHS_KEY),
      missingPaths: this.getTaskState<string[]>(SCAN_TASK_ID, SCAN_MISSING_PATHS_KEY),
    })
      .pipe(
        map(state => {
          // Any absent or mis-shaped key is "no scan", matching the server's
          // loadScanResults: a partial write must not read as pending work.
          if (
            state.generatedAt === undefined ||
            state.newPaths === undefined ||
            state.missingPaths === undefined ||
            typeof state.generatedAt !== 'number' ||
            !Array.isArray(state.newPaths) ||
            !Array.isArray(state.missingPaths)
          ) {
            return undefined;
          }
          return {
            generatedAt: state.generatedAt,
            newPaths: state.newPaths,
            missingPaths: state.missingPaths,
          };
        }),
      )
      .subscribe(
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
