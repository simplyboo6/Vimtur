import { Component, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { formatPercent, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ConfigService } from 'services/config.service';
import { TagService } from 'services/tag.service';
import { ActorService } from 'services/actor.service';
import { ConfirmationService } from 'services/confirmation.service';
import { AlertService } from 'services/alert.service';
import { Configuration, Scanner, QueuedTask, ListedTask, TaskArgs, TaskArgDefinition } from '@vimtur/common';
import { TasksService } from 'app/services/tasks.service';
import { Subscription, timer, combineLatest } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ListItem } from 'app/shared/types';
import { FormsModule } from '@angular/forms';
import { SelectComponent } from '../select/select.component';
import { SelectOptionComponent } from '../select-option/select-option.component';
import { LoadingComponent } from '../loading/loading.component';

@Component({
  selector: 'app-config',
  templateUrl: './config.component.html',
  styleUrls: ['./config.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [FormsModule, NgTemplateOutlet, SelectComponent, SelectOptionComponent, LoadingComponent],
})
export class ConfigComponent implements OnInit, OnDestroy {
  private configService: ConfigService;
  private tagService: TagService;
  private actorService: ActorService;
  private confirmationService: ConfirmationService;
  private alertService: AlertService;

  private subscriptions: Subscription[] = [];

  public tasksService: TasksService;
  public config?: Configuration.Main;
  public tags?: string[];
  public actors?: string[];
  public tasks?: ListedTask[];
  public queue?: QueuedTask[];
  public scanResults?: Scanner.Summary;
  public version?: string;

  public addTagModel?: string;
  public deleteTagModel?: string;
  public addActorModel?: string;
  public deleteActorModel?: string;
  public task?: ListedTask;
  public args: TaskArgs = [];

  public readonly qualityList: ListItem<number>[] = [
    { id: 144, itemName: '144p' },
    { id: 240, itemName: '240p' },
    { id: 360, itemName: '360p' },
    { id: 480, itemName: '480p' },
    { id: 720, itemName: '720p' },
    { id: 1080, itemName: '1080p' },
    { id: 1440, itemName: '1440p' },
    { id: 2160, itemName: '4K (2160p)' },
  ];

  public constructor(
    configService: ConfigService,
    tagService: TagService,
    confirmationService: ConfirmationService,
    actorService: ActorService,
    tasksService: TasksService,
    alertService: AlertService,
  ) {
    this.configService = configService;
    this.tagService = tagService;
    this.confirmationService = confirmationService;
    this.actorService = actorService;
    this.tasksService = tasksService;
    this.alertService = alertService;
  }

  public ngOnInit() {
    this.subscriptions.push(
      this.configService.getConfiguration().subscribe(config => {
        this.config = config;
      }),
    );

    this.subscriptions.push(
      this.configService.getVersion().subscribe(version => {
        this.version = version;
      }),
    );

    this.subscriptions.push(
      timer(0)
        .pipe(switchMap(() => combineLatest([this.tagService.getTags(), this.actorService.getActors()])))
        .subscribe(([tags, actors]) => {
          this.tags = tags;
          this.actors = actors;
          this.addTagModel = undefined;
          this.deleteTagModel = undefined;
          this.addActorModel = undefined;
          this.deleteActorModel = undefined;
        }),
    );

    this.subscriptions.push(
      this.tasksService.getTasks().subscribe(tasks => {
        this.tasks = tasks;
      }),
    );

    this.subscriptions.push(
      this.tasksService.getQueue().subscribe(queue => {
        this.queue = queue;
      }),
    );

    this.subscriptions.push(
      this.tasksService.getScanResults().subscribe(scanResults => {
        this.scanResults = scanResults;
      }),
    );
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }

  public formatQueueState(task: QueuedTask): string {
    if (task.aborted) {
      return task.complete ? 'Aborted' : 'Aborting';
    }

    if (task.complete) {
      return 'Complete';
    }

    if (!task.running) {
      return task.aborted ? 'Aborted' : 'No';
    }

    if (task.max > 0) {
      return formatPercent(task.current / task.max, 'en');
    }

    if (task.current) {
      return String(task.current);
    }

    return 'Yes';
  }

  public async startAction() {
    // Captured before the confirmation awaits so a task-selection change
    // under the modal can't start something other than what was confirmed.
    const task = this.task;
    if (!task) {
      return;
    }
    // Select values can require that the user accepts a confirmation message
    // (e.g. 'allow-all' on DELETE-MISSING makes the task delete files beyond
    // the server-side safety limit), so check the selected values generically.
    const definitions = task.args ?? [];
    for (let i = 0; i < definitions.length; i++) {
      const definition = definitions[i];
      const selectedId = this.args[i];
      if (!definition || definition.type !== 'select' || selectedId === undefined) {
        continue;
      }
      const selected = definition.values.find(value => value.id === selectedId);
      if (selected?.confirm) {
        const confirmed = await this.confirmationService.confirm(selected.confirm);
        if (!confirmed) {
          return;
        }
      }
    }
    this.tasksService.startAction(task.id, task.args ? this.args : undefined);
  }

  public updateArgs(): void {
    this.args = [];
    if (this.task?.args) {
      this.args = this.task.args.map(arg => {
        if (arg.type === 'select') {
          return arg.values[0].id;
        }
        return undefined;
      });
    }
  }

  public getArgValues(arg: TaskArgDefinition): Array<{ id: string; name: string }> | undefined {
    if (arg.type !== 'select') {
      return undefined;
    }
    return arg.values;
  }

  public addQuality(field: 'cacheQualities' | 'streamQualities', quality: number) {
    console.log('addQuality', field, quality);
    if (!this.config) {
      return;
    }

    if (!this.config.transcoder[field].includes(quality)) {
      this.config.transcoder[field].push(quality);
      this.configService.updateConfiguration({
        transcoder: { [field]: this.config.transcoder[field] },
      });
    }
  }

  public removeQuality(field: 'cacheQualities' | 'streamQualities', quality: number) {
    console.log('removeQuality', field, quality);
    if (!this.config) {
      return;
    }

    const index = this.config.transcoder[field].indexOf(quality);
    if (index >= 0) {
      this.config.transcoder[field].splice(index, 1);
      this.configService.updateConfiguration({
        transcoder: { [field]: this.config.transcoder[field] },
      });
    }
  }

  public fromQualitiesToList(qualities: number[]): ListItem<number>[] {
    return qualities.map(quality => ({ id: quality, itemName: `${quality}p` })).sort((a, b) => a.id - b.id);
  }

  public addTag() {
    const tag = this.addTagModel;
    console.debug('addTag', tag);
    if (!tag) {
      return;
    }
    this.tagService.addTag(tag).subscribe(
      () => undefined,
      (err: HttpErrorResponse) => {
        console.error(err);
        const message = (err && err.error && err.error.message) || `Failed to add tag '${tag}'`;
        this.alertService.show({ type: 'warning', message, autoClose: 5000 });
      },
    );
  }

  public deleteTag() {
    const tag = this.deleteTagModel;
    if (!tag) {
      return;
    }
    this.confirmationService
      .confirm(`Are you sure you want to delete '${tag}'?`)
      .then(result => {
        if (result) {
          console.log('deleteTag', tag);
          this.tagService.deleteTag(tag);
        }
      })
      .catch(err => console.warn('Tag deletion confirmation error', err));
  }

  public addActor() {
    const actor = this.addActorModel;
    console.debug('addActor', actor);
    if (!actor) {
      return;
    }
    this.actorService.addActor(actor).subscribe(
      () => undefined,
      (err: HttpErrorResponse) => {
        console.error(err);
        const message = (err && err.error && err.error.message) || `Failed to add actor '${actor}'`;
        this.alertService.show({ type: 'warning', message, autoClose: 5000 });
      },
    );
  }

  public deleteActor() {
    const actor = this.deleteActorModel;
    if (!actor) {
      return;
    }
    this.confirmationService
      .confirm(`Are you sure you want to delete '${actor}'?`)
      .then(result => {
        if (result) {
          console.log('deleteActor', actor);
          this.actorService.deleteActor(actor);
        }
      })
      .catch(err => console.warn('Actor deletion confirmation error', err));
  }

  public formatQualities(qualities: number[]): string {
    return qualities.map(quality => `${quality}p`).join(', ');
  }

  public updateConfig(field: string, value: string | number | boolean) {
    const root: Record<string, unknown> = {};

    // Convert the field.name syntax into a partial configuration object
    let obj: Record<string, unknown> = root;
    const fields = field.split('.');
    for (let i = 0; i < fields.length - 1; i++) {
      obj[fields[i]] = {};
      obj = obj[fields[i]] as unknown as Record<string, unknown>;
    }
    obj[fields[fields.length - 1]] = value;

    this.configService.updateConfiguration(root as unknown as Configuration.Partial);
  }
}
