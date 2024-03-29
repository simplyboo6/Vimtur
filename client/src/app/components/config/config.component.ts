import { Component, OnInit, OnDestroy } from '@angular/core';
import { formatPercent } from '@angular/common';
import { ConfigService } from 'services/config.service';
import { TagService } from 'services/tag.service';
import { ActorService } from 'services/actor.service';
import { ConfirmationService } from 'services/confirmation.service';
import { Configuration, Scanner, QueuedTask, ListedTask, TaskArgs, TaskArgDefinition } from '@vimtur/common';
import { TasksService } from 'app/services/tasks.service';
import { Subscription, timer, combineLatest } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ListItem } from 'app/shared/types';

@Component({
  selector: 'app-config',
  templateUrl: './config.component.html',
  styleUrls: ['./config.component.scss'],
})
export class ConfigComponent implements OnInit, OnDestroy {
  private configService: ConfigService;
  private tagService: TagService;
  private actorService: ActorService;
  private confirmationService: ConfirmationService;

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
  ) {
    this.configService = configService;
    this.tagService = tagService;
    this.confirmationService = confirmationService;
    this.actorService = actorService;
    this.tasksService = tasksService;
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

  public startAction() {
    if (this.task) {
      this.tasksService.startAction(this.task.id, this.task.args ? this.args : undefined);
    }
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
    console.debug('addTag', this.addTagModel);
    if (!this.addTagModel) {
      return;
    }
    this.tagService.addTag(this.addTagModel);
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
    console.debug('addActor', this.addActorModel);
    if (!this.addActorModel) {
      return;
    }
    this.actorService.addActor(this.addActorModel);
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
      obj = (obj[fields[i]] as unknown) as Record<string, unknown>;
    }
    obj[fields[fields.length - 1]] = value;

    this.configService.updateConfiguration((root as unknown) as Configuration.Partial);
  }
}
