import { Component, Input } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { CollectionService } from 'app/services/collection.service';

@Component({
  selector: 'app-loading',
  templateUrl: './loading.component.html',
  styleUrls: ['./loading.component.scss'],
})
export class LoadingComponent {
  @Input() public title?: string;

  private collectionService: CollectionService;

  public constructor(collectionService: CollectionService) {
    this.collectionService = collectionService;
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
