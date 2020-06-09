import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { Observable, of, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { CollectionService } from 'app/services/collection.service';

@Component({
  selector: 'app-loading',
  templateUrl: './loading.component.html',
  styleUrls: ['./loading.component.scss'],
})
export class LoadingComponent implements OnInit, OnDestroy {
  @Input() public title?: string;
  public collection?: string[];

  private collectionService: CollectionService;
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
