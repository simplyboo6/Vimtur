import { Component, OnInit, OnDestroy } from '@angular/core';
import { ConfigService } from 'services/config.service';
import { TagService } from 'services/tag.service';
import { ActorService } from 'services/actor.service';
import { ConfirmationService } from 'services/confirmation.service';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { Configuration, Scanner } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';
import { CacheService, AdvancedAction } from 'app/services/cache.service';
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
  private alertService: AlertService;
  private modalService: NgbModal;
  private modalRef?: NgbModalRef;

  private subscriptions: Subscription[] = [];

  public cacheService: CacheService;
  public config?: Configuration.Main;
  public tags?: string[];
  public actors?: string[];
  public scannerStatus?: Scanner.StrippedStatus;
  public cacheQualities: ListItem<number>[] = [];
  public streamQualities: ListItem<number>[] = [];
  public minQuality: ListItem<number>[] = [];

  public addTagModel?: string;
  public deleteTagModel?: string;
  public addActorModel?: string;
  public deleteActorModel?: string;
  public advancedActionModel?: AdvancedAction;

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
    modalService: NgbModal,
    confirmationService: ConfirmationService,
    alertService: AlertService,
    actorService: ActorService,
    cacheService: CacheService,
  ) {
    this.configService = configService;
    this.tagService = tagService;
    this.modalService = modalService;
    this.confirmationService = confirmationService;
    this.alertService = alertService;
    this.actorService = actorService;
    this.cacheService = cacheService;
  }

  public ngOnInit() {
    console.debug('config.component ngOnInit');

    this.subscriptions.push(
      this.configService.getConfiguration().subscribe(config => {
        this.config = config;
        this.cacheQualities = this.fromQualitiesToList(config.transcoder.cacheQualities);
        this.streamQualities = this.fromQualitiesToList(config.transcoder.streamQualities);
        this.minQuality = this.fromQualitiesToList([config.transcoder.minQuality]);
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
      this.cacheService.getStatus().subscribe(status => {
        this.scannerStatus = status;
      }),
    );
  }

  public getProgress(): string {
    if (!this.scannerStatus) {
      return 'Unknown';
    } else if (this.scannerStatus.state === 'IDLE') {
      return 'N/A';
    } else if (this.scannerStatus.progress.max === 0) {
      return 'Unknown';
    } else {
      return `${Math.round(
        (this.scannerStatus.progress.current / this.scannerStatus.progress.max) * 100,
      )}%`;
    }
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }

  public startAction() {
    this.cacheService.startAction(this.advancedActionModel);
  }

  public addQuality(field: 'cacheQualities' | 'streamQualities', quality: ListItem<number>) {
    console.log('addQuality', field, quality);
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
    this.tagService.addTag(this.addTagModel);
  }

  public deleteTag() {
    this.confirmationService
      .confirm(`Are you sure you want to delete '${this.deleteTagModel}'?`)
      .then(result => {
        if (result) {
          console.log('deleteTag', this.deleteTagModel);
          this.tagService.deleteTag(this.deleteTagModel);
        }
      })
      .catch(err => console.warn('Tag deletion confirmation error', err));
  }

  public addActor() {
    console.debug('addActor', this.addActorModel);
    this.actorService.addActor(this.addActorModel);
  }

  public deleteActor() {
    this.confirmationService
      .confirm(`Are you sure you want to delete '${this.deleteActorModel}'?`)
      .then(result => {
        if (result) {
          console.log('deleteActor', this.deleteActorModel);
          this.actorService.deleteActor(this.deleteActorModel);
        }
      })
      .catch(err => console.warn('Actor deletion confirmation error', err));
  }

  public formatQualities(qualities: number[]): string {
    return qualities.map(quality => `${quality}p`).join(', ');
  }

  public updateConfig(field: string, value: string | number | boolean) {
    const root: Configuration.Partial = {};

    // Convert the field.name syntax into a partial configuration object
    let obj: object = root;
    const fields = field.split('.');
    for (let i = 0; i < fields.length - 1; i++) {
      obj[fields[i]] = {};
      obj = obj[fields[i]];
    }
    obj[fields[fields.length - 1]] = value;

    this.configService.updateConfiguration(root);
  }
}
