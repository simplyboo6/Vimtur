import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faCircleXmark } from '@fortawesome/free-regular-svg-icons';
import { DeletedMedia } from '@vimtur/common';
import { Subscription } from 'rxjs';
import { AlertService } from 'app/services/alert.service';
import { ConfirmationService } from 'app/services/confirmation.service';
import { DeletedService } from 'app/services/deleted.service';
import { LoadingComponent } from '../loading/loading.component';

// One ignore-list entry, keyed by content hash: the same file can be recorded at
// every path it was seen at (SCAN matches paths while INDEX matches hashes and
// records the path it saw), and removing the entry clears all of them.
interface DeletedPathGroup {
  hash: string;
  paths: string[];
}

@Component({
  selector: 'app-deleted-paths',
  templateUrl: './deleted-paths.component.html',
  styleUrls: ['./deleted-paths.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [FormsModule, FaIconComponent, LoadingComponent],
})
export class DeletedPathsComponent implements OnInit, OnDestroy {
  public readonly faCircleXmark = faCircleXmark;
  private deletedService: DeletedService;
  private alertService: AlertService;
  private confirmationService: ConfirmationService;

  private subscriptions: Subscription[] = [];

  public entries: DeletedMedia[] = [];
  // Grouped and filtered entries, recomputed on load and on filter changes. The
  // template reads it for both the empty-state check and the rows, so caching it
  // keeps the work to once per data change rather than once per change-detection
  // pass.
  public rows: DeletedPathGroup[] = [];
  public loaded = false;
  // True when the last load failed; the template must not claim an empty list.
  public failed = false;
  private hashFilterInternal = '';
  private pathFilterInternal = '';
  // Hashes with a removal awaiting confirmation or response. The guard covers
  // the confirmation dialog as well as the request, and is cleared when the
  // dialog is cancelled or the request settles, so its button cannot fire twice.
  public readonly removing = new Set<string>();

  public get hashFilter(): string {
    return this.hashFilterInternal;
  }

  public set hashFilter(hashFilter: string) {
    this.hashFilterInternal = hashFilter;
    this.refreshRows();
  }

  public get pathFilter(): string {
    return this.pathFilterInternal;
  }

  public set pathFilter(pathFilter: string) {
    this.pathFilterInternal = pathFilter;
    this.refreshRows();
  }

  public constructor(deletedService: DeletedService, alertService: AlertService, confirmationService: ConfirmationService) {
    this.deletedService = deletedService;
    this.alertService = alertService;
    this.confirmationService = confirmationService;
  }

  public ngOnInit(): void {
    this.load();
  }

  public ngOnDestroy(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }

  // Groups by hash and applies the filters. A group is shown when the hash
  // matches exactly or any of its paths contains the path filter, but every path
  // of a shown group is listed: removing the entry clears all of them, so the
  // tab must show what is about to go. Filtering selects entries, not rows.
  private refreshRows(): void {
    const hashFilter = this.hashFilter.trim().toLowerCase();
    const pathFilter = this.pathFilter.trim().toLowerCase();
    const byHash = new Map<string, string[]>();
    for (const entry of this.entries) {
      const paths = byHash.get(entry.hash);
      if (paths) {
        paths.push(entry.path);
      } else {
        byHash.set(entry.hash, [entry.path]);
      }
    }

    this.rows = [...byHash.entries()]
      .filter(([hash, paths]) => {
        const hashMatches = hashFilter === '' || hash.toLowerCase() === hashFilter;
        const pathMatches = pathFilter === '' || paths.some(path => path.toLowerCase().includes(pathFilter));
        return hashMatches && pathMatches;
      })
      .map(([hash, paths]) => ({ hash, paths }));
  }

  public remove(group: DeletedPathGroup): void {
    if (this.removing.has(group.hash)) {
      return;
    }
    // Held from the moment the dialog opens: a fast double-click would otherwise
    // stack two confirmation modals and fire two DELETEs.
    this.removing.add(group.hash);
    this.confirmationService
      .confirmWith('Remove this entry from the ignore list?', {
        negative: true,
        message: `The following ${group.paths.length} path(s) will be allowed to be imported again by the next scan.`,
        details: group.paths,
      })
      .then(result => {
        if (!result.confirmed) {
          this.removing.delete(group.hash);
          return;
        }
        this.subscriptions.push(
          this.deletedService.removeDeletedPath(group.hash).subscribe(
            () => {
              this.removing.delete(group.hash);
              this.load();
            },
            (err: HttpErrorResponse) => {
              this.removing.delete(group.hash);
              console.error(err);
              this.alertService.show({ type: 'danger', message: 'Failed to remove the ignored path' });
            },
          ),
        );
      })
      .catch(err => {
        // confirmWith only rejects if the modal itself failed to open; release the
        // guard so the button does not stay stuck.
        this.removing.delete(group.hash);
        console.warn('Deleted path removal confirmation error', err);
      });
  }

  private load(): void {
    this.subscriptions.push(
      this.deletedService.getDeletedPaths().subscribe(
        entries => {
          this.entries = entries;
          this.failed = false;
          this.loaded = true;
          this.refreshRows();
        },
        (err: HttpErrorResponse) => {
          console.error(err);
          this.failed = true;
          this.loaded = true;
          this.alertService.show({ type: 'danger', message: 'Failed to fetch the deleted paths' });
        },
      ),
    );
  }
}
