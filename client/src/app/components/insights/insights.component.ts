import { Component, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { InsightsService } from 'services/insights.service';
import { InsightsResponse } from '@vimtur/common';
import { Subscription } from 'rxjs';
import { NgbNav, NgbNavItem, NgbNavItemRole, NgbNavLink, NgbNavLinkBase, NgbNavContent, NgbNavOutlet } from '@ng-bootstrap/ng-bootstrap/nav';
import { LoadingComponent } from '../loading/loading.component';

@Component({
  selector: 'app-insights',
  templateUrl: './insights.component.html',
  styleUrls: ['./insights.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [NgbNav, NgbNavItem, NgbNavItemRole, NgbNavLink, NgbNavLinkBase, NgbNavContent, NgbNavOutlet, LoadingComponent],
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
