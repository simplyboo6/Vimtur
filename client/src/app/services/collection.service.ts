import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, ReplaySubject, BehaviorSubject } from 'rxjs';
import { SubsetConstraints } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';
import { ConfirmationService } from 'app/services/confirmation.service';
import { PromptService } from 'app/services/prompt.service';
import { ConfigService } from './config.service';
import { PRNG } from 'app/shared/prng';
import { moveItemInArray } from '@angular/cdk/drag-drop';

const HTTP_OPTIONS = {
  headers: new HttpHeaders({
    'Content-Type': 'application/json',
  }),
};

export interface ClientSearchOptions {
  shuffle?: boolean;
  shuffleSeed?: number;
  preserve?: boolean;
  // If true only search if not initialised
  init?: boolean;
  noRedirect?: boolean;
}

export interface CollectionMetadata {
  index: number;
  collection: string[];
  constraints?: SubsetConstraints;
  order?: boolean;
  removed?: string[];
}

@Injectable({
  providedIn: 'root',
})
export class CollectionService {
  private httpClient: HttpClient;
  private alertService: AlertService;
  private searching = new BehaviorSubject<boolean>(false);
  private collection?: string[];
  private constraints?: SubsetConstraints;
  private index = 0;
  private confirmationService: ConfirmationService;
  private promptService: PromptService;
  private router: Router;
  private configService: ConfigService;
  private metadata = new ReplaySubject<CollectionMetadata | undefined>(1);
  private shuffled = false;

  public constructor(
    httpClient: HttpClient,
    alertService: AlertService,
    confirmationService: ConfirmationService,
    promptService: PromptService,
    configService: ConfigService,
    router: Router,
  ) {
    this.httpClient = httpClient;
    this.alertService = alertService;
    this.confirmationService = confirmationService;
    this.promptService = promptService;
    this.configService = configService;
    this.router = router;
  }

  public isSearching(): Observable<boolean> {
    return this.searching;
  }

  public setSearching(searching: boolean): void {
    this.searching.next(searching);
  }

  public shuffle() {
    if (!this.collection) {
      return;
    }
    this.index = 0;
    // Copy it so it's definitely picked up as changed by the gallery.
    this.collection = this.shuffleArray(this.collection).slice(0);
    this.shuffled = true;
    this.update();
  }

  public getMetadata(): Observable<CollectionMetadata | undefined> {
    return this.metadata;
  }

  public goto(location?: string | boolean, page?: boolean) {
    if (!this.configService.config) {
      console.warn('Cannot goto() before config is loaded');
      return;
    }
    if (!this.collection) {
      console.warn('Cannot goto() before collection loaded');
      return;
    }

    const pageSize = this.configService.config.user.galleryImageCount;

    if (typeof location === 'boolean' || location === undefined) {
      this.promptService
        .prompt('Goto')
        .then(result => {
          if (result) {
            this.goto(result, location as boolean);
          }
        })
        .catch(err => console.error('prompt error', err));
      return;
    }

    if (isNaN(Number(location))) {
      const index = this.collection.indexOf(location);
      if (index >= 0) {
        this.index = index;
        this.update();
      } else {
        this.alertService.show({
          type: 'warning',
          message: 'Could not find hash in set',
          autoClose: 3000,
        });
      }
    } else {
      // From 1-x to 0-x
      let index = Number(location) - 1;
      // If pageSize > 0 then map to a page.
      if (page && pageSize) {
        index = index * pageSize;
      }
      if (index < 0 || index >= this.collection.length) {
        this.alertService.show({
          type: 'warning',
          message: 'Index is not within the collection',
          autoClose: 3000,
        });
      } else {
        this.index = index;
        this.update();
      }
    }
  }

  public deleteCurrent() {
    const collection = this.collection;
    const index = this.index;
    if (!collection || index === undefined) {
      return;
    }
    this.confirmationService
      .confirm(`Are you sure you want to delete the current media?`, true)
      .then(result => {
        if (result) {
          const hash = collection[index];
          console.debug(`Deleting ${hash}`);
          this.httpClient.delete(`/api/images/${hash}`, { responseType: 'text' }).subscribe(
            () => {
              this.removeFromSet([hash]);
              this.update(this.constraints);
            },
            (err: HttpErrorResponse) => {
              console.error(err);
              this.alertService.show({ type: 'danger', message: 'Failed to delete media' });
            },
          );
        }
      })
      .catch(err => console.error('Modal error', err));
  }

  public removeFromSet(hashes: string[]) {
    if (!this.collection || this.index === undefined) {
      return;
    }

    const anyRemoved = this.collection.find(hash => hashes.includes(hash));
    if (!anyRemoved) {
      console.log('None to remove', hashes);
      return;
    }
    console.log('Removing', hashes);

    const currentHash = this.collection[this.index];

    // Replace the collection otherwise gallery doesnt update.
    this.collection = this.collection.filter(hash => !hashes.includes(hash));

    const newIndex = this.collection.indexOf(currentHash);
    if (newIndex >= 0) {
      this.index = newIndex;
    }

    if (this.index >= this.collection.length) {
      this.index = 0;
    }

    this.metadata.next({
      index: this.index,
      collection: this.collection,
      removed: hashes,
    });
  }

  public isShuffled(): boolean {
    return this.shuffled;
  }

  public updateOrder(previousIndex: number, currentIndex: number): void {
    if (!this.collection) {
      return;
    }

    moveItemInArray(this.collection, previousIndex, currentIndex);
    this.collection = [...this.collection];
    if (this.index === previousIndex) {
      this.index = currentIndex;
    }
    this.metadata.next({
      index: this.index,
      collection: this.collection,
      order: true,
    });
  }

  public subset(constraints: SubsetConstraints): Observable<string[]> {
    return this.httpClient.post<string[]>(`/api/images/subset`, constraints, HTTP_OPTIONS);
  }

  public search(constraints: SubsetConstraints, options?: ClientSearchOptions) {
    if (options && options.init && this.collection) {
      return;
    }

    // Avoid weird artifacts when the gallery subscribes (so it doesn't get the old collection).
    this.index = 0;
    this.collection = undefined;
    this.searching.next(true);
    this.update();

    this.subset(constraints).subscribe(
      res => {
        this.searching.next(false);
        if (res.length === 0) {
          if (options && options.init) {
            this.alertService.show({
              type: 'info',
              message:
                `No media found. Please click 'Start Auto-Import' to begin. ` +
                `After some media is indexed click the 'Search' tab and then the 'Search' button. ` +
                `Click modals to dismiss them.`,
            });
            this.router.navigate(['/config']);
          } else {
            this.alertService.show({
              type: 'info',
              message: 'No search results found',
              autoClose: 5000,
            });
          }
          return;
        }

        const collection = options && options.shuffle ? this.shuffleArray(res, options && options.shuffleSeed) : res;
        this.shuffled = Boolean(options && options.shuffle);
        this.index = options && options.preserve ? this.getNewIndex(collection) : 0;
        this.collection = collection;
        this.constraints = constraints;

        console.log('search result', constraints, {
          index: this.index,
          size: this.collection.length,
        });

        this.update(constraints);

        if (!options || (options && !options.init && !options.noRedirect)) {
          this.router.navigate([constraints.hasClones ? '/clone-resolver' : '/gallery']);
        }
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        this.searching.next(false);
        this.alertService.show({ type: 'danger', message: 'Failed to complete search' });
      },
    );
  }

  public offset(offset: number) {
    if (!this.collection) {
      console.warn('Cannot offset while collection not set');
      return;
    }
    this.index += offset;
    if (this.index < 0) {
      this.index = this.collection.length - 1;
    } else if (this.index >= this.collection.length) {
      this.index = 0;
    }
    this.update();
  }

  private update(constraints?: SubsetConstraints) {
    if (!this.collection) {
      console.warn('Cannot update metadata while collection not set');
      return;
    }
    this.metadata.next({
      index: this.index,
      collection: this.collection,
      constraints,
    });
  }

  private getNewIndex(collection: string[]): number {
    if (!this.collection) {
      return 0;
    }
    const current = this.collection[this.index];
    if (!current) {
      return 0;
    }
    const index = collection.indexOf(current);
    if (index < 0) {
      return 0;
    }
    return index;
  }

  private shuffleArray(array: string[], seed?: number): string[] {
    if (seed === undefined) {
      seed = Math.random();
    }
    const prng = new PRNG(seed);
    let temporaryValue = '';
    let randomIndex = array.length;
    let currentIndex = array.length;

    // While there remain elements to shuffle...
    while (0 !== currentIndex) {
      // Pick a remaining element...
      randomIndex = Math.floor(prng.nextFloat() * currentIndex);
      currentIndex -= 1;

      // And swap it with the current element.
      temporaryValue = array[currentIndex];
      array[currentIndex] = array[randomIndex];
      array[randomIndex] = temporaryValue;
    }

    return array;
  }
}
