import { Component, Input, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { Observable, of, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { CollectionService } from 'app/services/collection.service';
import { AsyncPipe } from '@angular/common';

@Component({
  selector: 'app-loading',
  templateUrl: './loading.component.html',
  styleUrls: ['./loading.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [AsyncPipe],
})
export class LoadingComponent implements OnInit, OnDestroy {
  @Input() public title?: string;
  public collection?: string[];
  public collectionService: CollectionService;

  private subscriptions: Subscription[] = [];

  public constructor(collectionService: CollectionService) {
    this.collectionService = collectionService;
  }

  public ngOnInit() {
    this.subscriptions.push(
      this.collectionService.getMetadata().subscribe(metadata => {
        this.collection = metadata && metadata.collection;
      }),
    );
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }

  public getTitle(): Observable<string> {
    if (this.title) {
      return of(this.title);
    }

    return this.collectionService.isSearching().pipe(
      map(isSearching => {
        return isSearching ? 'Searching' : 'Loading';
      }),
    );
  }
}
