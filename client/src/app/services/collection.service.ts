import { HttpClient, HttpResponse, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, ReplaySubject } from 'rxjs';
import { SubsetConstraints } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';
import { ConfirmationService } from 'app/services/confirmation.service';
import { PromptService } from 'app/services/prompt.service';
import { PRNG } from 'app/shared/prng';
import { Alert } from 'app/shared/types';

const HTTP_OPTIONS = {
  headers: new HttpHeaders({
    'Content-Type': 'application/json',
  }),
};

// TODO Configurable? Arbitrary for now.
const KEYWORD_SEARCH_LIMIT = 1200;

export interface CollectionMetadata {
  index: number;
  collection: string[];
}

export interface ClientSearchOptions {
  shuffle?: boolean;
  shuffleSeed?: number;
  preserve?: boolean;
  // If true only search if not initialised
  init?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class CollectionService {
  private httpClient: HttpClient;
  private alertService: AlertService;
  private metadata: ReplaySubject<CollectionMetadata> = new ReplaySubject(1);
  private collection?: string[];
  private index = 0;
  private confirmationService: ConfirmationService;
  private promptService: PromptService;
  private router: Router;

  public constructor(
    httpClient: HttpClient,
    alertService: AlertService,
    confirmationService: ConfirmationService,
    promptService: PromptService,
    router: Router,
  ) {
    this.httpClient = httpClient;
    this.alertService = alertService;
    this.confirmationService = confirmationService;
    this.promptService = promptService;
    this.router = router;
  }

  public getMetadata(): ReplaySubject<CollectionMetadata> {
    return this.metadata;
  }

  public shuffle() {
    this.index = 0;
    // Copy it so it's definitely picked up as changed by the gallery.
    this.collection = this.shuffleArray(this.collection).slice(0);
    this.update();
  }

  public goto(location?: string) {
    if (!location) {
      this.promptService
        .prompt('Goto')
        .then(result => {
          if (result) {
            this.goto(result);
          }
        })
        .catch(err => console.error('prompt error', err));
      return;
    }

    if (isNaN(Number(location))) {
      const index = this.collection.indexOf(location);
      if (index >= 0) {
        this.index = index;
        this.router.navigate(['/viewer']);
        this.update();
      } else {
        this.alertService.show({
          type: 'warning',
          message: 'Could not find hash in set',
          autoClose: 3000,
        });
      }
    } else {
      const index = Number(location);
      if (index < 0 || index >= this.collection.length) {
        this.alertService.show({
          type: 'warning',
          message: 'Index is not within the collection',
          autoClose: 3000,
        });
      } else {
        this.index = index;
        this.router.navigate(['/viewer']);
        this.update();
      }
    }
  }

  public deleteCurrent() {
    if (!this.collection || this.index === undefined) {
      return;
    }
    this.confirmationService
      .confirm(`Are you sure you want to delete the current media?`)
      .then(result => {
        if (result) {
          const hash = this.collection[this.index];
          console.debug(`Deleting ${hash}`);
          this.httpClient.delete(`/api/images/${hash}`, { responseType: 'text' }).subscribe(
            () => {
              this.collection.splice(this.index, 1);
              if (this.index >= this.collection.length) {
                this.index = 0;
              }
              this.update();
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

  public search(constraints: SubsetConstraints, options?: ClientSearchOptions) {
    if (options && options.init && this.collection) {
      return;
    }

    const loadingAlert: Alert = { type: 'info', message: 'Searching...', autoClose: 5000 };
    this.alertService.show(loadingAlert);

    // Avoid weird artifacts when the gallery subscribes (so it doesn't get the old collection).
    this.index = 0;
    this.collection = undefined;
    this.update();

    if (constraints.keywordSearch && !constraints.limit) {
      constraints.limit = KEYWORD_SEARCH_LIMIT;
    }

    this.httpClient.post<string[]>(`/api/images/subset`, constraints, HTTP_OPTIONS).subscribe(
      res => {
        if (res.length === 0) {
          this.alertService.dismiss(loadingAlert);
          if (options && options.init) {
            this.alertService.show({
              type: 'info',
              message:
                `No media found. Please click 'Start Auto-Import' to begin.` +
                `After some media is indexed click the 'Search' tab and then the 'Search' button.`,
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

        const collection =
          options && options.shuffle ? this.shuffleArray(res, options && options.shuffleSeed) : res;
        this.index = options && options.preserve ? this.getNewIndex(collection) : 0;
        this.collection = collection;

        console.log('search result', constraints, {
          index: this.index,
          size: this.collection.length,
        });
        this.update();
        this.alertService.dismiss(loadingAlert);
        // TODO Make this configurable
        if (!options || (options && !options.init)) {
          this.router.navigate(['/gallery']);
        }
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        this.alertService.show({ type: 'danger', message: 'Failed to complete search' });
      },
    );
  }

  public offset(offset: number) {
    this.index += offset;
    if (this.index < 0) {
      this.index = this.collection.length - 1;
    } else if (this.index >= this.collection.length) {
      this.index = 0;
    }
    this.update();
  }

  private update() {
    this.metadata.next({
      index: this.index,
      collection: this.collection,
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
