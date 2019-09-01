import { Injectable, EventEmitter } from '@angular/core';
import { Alert } from 'app/shared/types';

@Injectable({
  providedIn: 'root',
})
export class AlertService {
  public readonly alerts: EventEmitter<Alert> = new EventEmitter();
  public readonly dismissals: EventEmitter<Alert> = new EventEmitter();

  public show(alert: Alert) {
    this.alerts.emit(alert);
  }

  public dismiss(alert: Alert) {
    this.dismissals.emit(alert);
  }
}
