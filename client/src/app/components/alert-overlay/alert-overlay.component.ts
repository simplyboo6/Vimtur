import { Component, OnInit, NgZone } from '@angular/core';
import { Alert } from 'app/shared/types';
import { AlertService } from 'app/services/alert.service';

@Component({
  selector: 'app-alert-overlay',
  templateUrl: './alert-overlay.component.html',
  styleUrls: ['./alert-overlay.component.scss'],
})
export class AlertOverlayComponent implements OnInit {
  private alertService: AlertService;
  private zone: NgZone;
  public alerts: Alert[] = [];

  public constructor(alertService: AlertService, zone: NgZone) {
    this.alertService = alertService;
    this.zone = zone;
  }

  public ngOnInit() {
    this.alertService.alerts.subscribe(res => this.open(res));
    this.alertService.dismissals.subscribe(res => this.close(res));
  }

  public open(alert: Alert) {
    this.alerts.unshift(alert);
    if (alert.autoClose !== undefined) {
      setTimeout(() => this.close(alert), alert.autoClose);
    }
  }

  public close(alert: Alert) {
    this.zone.run(() => {
      const index = this.alerts.indexOf(alert);
      if (index >= 0) {
        this.alerts.splice(index, 1);
      }
    });
  }
}
