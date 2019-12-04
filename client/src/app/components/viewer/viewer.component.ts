import {
  Component,
  AfterViewChecked,
  OnInit,
  OnDestroy,
  ViewChild,
  TemplateRef,
} from '@angular/core';
import { UiService } from 'services/ui.service';
import { MediaService } from 'services/media.service';
import { ConfigService } from 'services/config.service';
import { Subscription } from 'rxjs';
import { Media, Configuration } from '@vimtur/common';
import { isMobile } from 'is-mobile';
import { QualityService } from 'app/services/quality.service';
import { QualityLevel } from 'app/shared/types';

declare const Hls;

@Component({
  selector: 'app-viewer',
  templateUrl: './viewer.component.html',
  styleUrls: ['./viewer.component.scss'],
})
export class ViewerComponent implements AfterViewChecked, OnInit, OnDestroy {
  @ViewChild('videoElement', { static: false }) public videoElement: any;

  public tagsOpen = false;
  public media?: Media;

  private uiService: UiService;
  private mediaService: MediaService;
  private configService: ConfigService;
  private qualityService: QualityService;
  private subscriptions: Subscription[] = [];
  private hls?: any;
  private config?: Configuration.Main;
  private videoInitialised = false;
  private currentLevel?: QualityLevel;

  public constructor(
    uiService: UiService,
    mediaService: MediaService,
    configService: ConfigService,
    qualityService: QualityService,
  ) {
    this.uiService = uiService;
    this.mediaService = mediaService;
    this.configService = configService;
    this.qualityService = qualityService;
  }

  public ngOnInit() {
    this.subscriptions.push(
      this.uiService.getTagPanelState().subscribe(state => {
        this.tagsOpen = state;
      }),
    );

    this.subscriptions.push(
      this.mediaService.getMedia().subscribe(media => {
        if (!this.media || this.media.hash !== media.hash) {
          if (this.hls) {
            if (this.videoElement) {
              this.videoElement.nativeElement.pause();
            }
            this.hls.detachMedia();
            this.hls.destroy();
            this.hls = undefined;
          }

          if (media && media.type === 'video') {
            this.playVideo(media);
          }
        }

        this.media = media;
      }),
    );

    this.subscriptions.push(
      this.configService.getConfiguration().subscribe(config => {
        this.config = config;
      }),
    );

    this.subscriptions.push(
      this.qualityService.setLevel.subscribe(level => {
        this.currentLevel = level;
        this.updateLevel();
      }),
    );
  }

  public ngAfterViewChecked() {
    if (this.videoElement && !this.videoInitialised) {
      this.videoElement.nativeElement.addEventListener('seeking', () => {
        const lowQualityOnSeek =
          this.config &&
          (isMobile()
            ? this.config.user.lowQualityOnLoadEnabledForMobile
            : this.config.user.lowQualityOnLoadEnabled);

        // Only has an effect if the segment isn't already loaded.
        if (lowQualityOnSeek) {
          console.debug('Seeking - Forcing to level 0');
          this.hls.nextLoadLevel = 0;
        }
      });

      this.videoElement.nativeElement.addEventListener('play', () => {
        if (this.hls) {
          const autoPlay = !isMobile() && this.config && this.config.user.autoplayEnabled;
          if (!autoPlay) {
            this.hls.startLoad();
          }
        }
      });
      this.videoInitialised = true;
      // If a piece of media has been loaded before the video element existed, then start it here.
      if (this.media && this.media.type === 'video') {
        this.playVideo(this.media);
      }
    }
  }

  private updateLevel() {
    if (this.hls && this.currentLevel) {
      const levels = this.hls.levels;
      if (this.currentLevel.width !== undefined && this.currentLevel.height !== undefined) {
        const level = levels.findIndex(
          l => l.width === this.currentLevel.width && l.height === this.currentLevel.height,
        );
        if (level >= 0 && this.hls.currentLevel !== level) {
          console.debug('Setting quality level', this.currentLevel);
          this.hls.currentLevel = level;
        }
      } else if (this.currentLevel.index === -1) {
        console.debug('Setting quality level to auto');
        this.hls.currentLevel = -1;
      }
    }
  }

  private playVideo(media: Media) {
    if (this.videoElement) {
      const autoPlay = !isMobile() && this.config && this.config.user.autoplayEnabled;
      const lowQualityOnSeek =
        this.config &&
        (isMobile()
          ? this.config.user.lowQualityOnLoadEnabledForMobile
          : this.config.user.lowQualityOnLoadEnabled);
      console.debug('playing video', media.hash, lowQualityOnSeek, autoPlay);

      this.hls = new Hls({
        autoStartLoad: false,
        capLevelToPlayerSize: true,
        maxSeekHole: 5,
        maxBufferHole: 5,
        maxBufferLength: 60,
        startLevel: lowQualityOnSeek ? 0 : -1,
      });

      this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        console.log('Manifest quality levels', data.levels);
        this.qualityService.qualityLevels.next(
          data.levels.map((el, i) => ({ width: el.width, height: el.height, index: i })),
        );

        this.videoElement.nativeElement.muted = true;
        if (autoPlay) {
          this.videoElement.nativeElement.play();
        }
        this.updateLevel();
      });

      this.hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
        console.log('Switched to quality level', data.level, this.hls.levels[data.level]);
        this.qualityService.currentLevel.next({
          ...this.hls.levels[data.level],
          index: data.level,
        });
      });

      this.hls.attachMedia(this.videoElement.nativeElement);

      this.hls.loadSource(`/api/images/${media.hash}/stream/index.m3u8`);
      if (autoPlay) {
        this.hls.startLoad();
      }
    } else {
      console.warn('playVideo called before videoElement initialised');
    }
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];

    if (this.videoElement) {
      this.videoElement.nativeElement.pause();
    }
    if (this.hls) {
      this.hls.detachMedia();
      this.hls = undefined;
    }
  }
}
