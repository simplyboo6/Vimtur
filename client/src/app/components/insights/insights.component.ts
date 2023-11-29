import { Component, OnInit, OnDestroy } from '@angular/core';
import { InsightsService } from 'services/insights.service';
import { InsightsResponse } from '@vimtur/common';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-insights',
  templateUrl: './insights.component.html',
  styleUrls: ['./insights.component.scss'],
})
export class InsightsComponent implements OnInit, OnDestroy {
  public insights?: InsightsResponse;

  private subscriptions: Subscription[] = [];
  private insightsService: InsightsService;

  public constructor(insightsService: InsightsService) {
    this.insightsService = insightsService;
  }

  public ngOnInit() {
    this.insights = undefined;

    this.subscriptions.push(this.insightsService.getInsights().subscribe(insights => (this.insights = insights)));
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }
}
