import { Component, OnInit, OnDestroy } from '@angular/core';
import { formatPercent } from '@angular/common';
import { ConfigService } from 'services/config.service';
import { TagService } from 'services/tag.service';
import { ActorService } from 'services/actor.service';
import { ConfirmationService } from 'services/confirmation.service';
import { Configuration, Scanner, QueuedTask, ListedTask } from '@vimtur/common';
import { TasksService } from 'app/services/tasks.service';
import { Subscription } from 'rxjs';
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
  public cacheQualities: ListItem<number>[] = [];
  public streamQualities: ListItem<number>[] = [];
  public minQuality: ListItem<number>[] = [];
  public scanResults?: Scanner.Summary;
  public version?: string;

  public addTagModel?: string;
  public deleteTagModel?: string;
  public addActorModel?: string;
  public deleteActorModel?: string;
  public task?: ListedTask;

  // This is awful but the actual type isn't exposed and isn't partial.
  public readonly cacheQualitySettings: any = {
    text: '+ Quality',
    enableCheckAll: false,
    enableSearchFilter: false,
    addNewItemOnFilter: false,
    enableFilterSelectAll: false,
  };

  public readonly streamingQualitySettings: any = {
    text: '+ Quality',
    enableCheckAll: false,
    enableSearchFilter: false,
    addNewItemOnFilter: false,
    enableFilterSelectAll: false,
  };

  public readonly minTranscodeQualitySettings: any = {
    text: 'Minimum Quality',
    singleSelection: true,
  };

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
        this.cacheQualities = this.fromQualitiesToList(config.transcoder.cacheQualities);
        this.streamQualities = this.fromQualitiesToList(config.transcoder.streamQualities);
        this.minQuality = this.fromQualitiesToList([config.transcoder.minQuality]);
      }),
    );

    this.subscriptions.push(
      this.configService.getVersion().subscribe(version => {
        this.version = version;
      }),
    );

    this.subscriptions.push(
      this.tagService.getTags().subscribe(tags => {
        this.tags = tags;
        this.addTagModel = undefined;
        this.deleteTagModel = undefined;
      }),
    );

    this.subscriptions.push(
      this.actorService.getActors().subscribe(actors => {
        this.actors = actors;
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
    if (task.complete) {
      return 'Complete';
    }

    if (!task.running) {
      return task.aborted ? 'Aborted' : 'No';
    }

    if (task.aborted) {
      return 'Aborting';
    }

    if (task.max > 0) {
      return formatPercent(task.current / task.max, 'en');
    }

    return 'Yes';
  }

  public startAction() {
    if (this.task) {
      this.tasksService.startAction(this.task.id);
    }
  }

  public addQuality(field: 'cacheQualities' | 'streamQualities', quality: ListItem<number>) {
    console.log('addQuality', field, quality);
    if (!this.config) {
      return;
    }

    if (!this.config.transcoder[field].includes(quality.id)) {
      this.config.transcoder[field].push(quality.id);
      this[field] = this.fromQualitiesToList(this.config.transcoder[field]);
      this.configService.updateConfiguration({
        transcoder: { [field]: this.config.transcoder[field] },
      });
    }
  }

  public removeQuality(field: 'cacheQualities' | 'streamQualities', quality: ListItem<number>) {
    console.log('removeQuality', field, quality);
    if (!this.config) {
      return;
    }

    const index = this.config.transcoder[field].indexOf(quality.id);
    if (index >= 0) {
      this.config.transcoder[field].splice(index, 1);
      this[field] = this.fromQualitiesToList(this.config.transcoder[field]);
      this.configService.updateConfiguration({
        transcoder: { [field]: this.config.transcoder[field] },
      });
    }
  }

  public fromQualitiesToList(qualities: number[]): ListItem<number>[] {
    return qualities
      .map(quality => ({ id: quality, itemName: `${quality}p` }))
      .sort((a, b) => a.id - b.id);
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
