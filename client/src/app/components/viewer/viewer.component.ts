import {
  Component,
  AfterViewChecked,
  OnInit,
  OnDestroy,
  ViewChild,
  TemplateRef,
  NgZone,
} from '@angular/core';
import { UiService } from 'services/ui.service';
import { MediaService } from 'services/media.service';
import { ConfigService } from 'services/config.service';
import { Subscription, timer } from 'rxjs';
import { Media, Configuration } from '@vimtur/common';
import { isMobile } from 'is-mobile';
import { QualityService } from 'app/services/quality.service';
import { QualityLevel } from 'app/shared/types';

declare const Hls;

const PLAYER_CONTROLS_TIMEOUT = 3000;
const DOUBLE_CLICK_TIMEOUT = 500;

interface VideoPlayerState {
  playing?: boolean;
  duration?: number;
  currentTime?: number;
  width?: number;
  height?: number;
  top?: number;
  loading?: boolean;
  active?: Subscription;
  inControls?: boolean;
  lastClick?: number;
  fullscreen?: boolean;
  navigationTime?: number;
  muted?: boolean;
  volume?: number;
  updatingVolume?: boolean;
}

@Component({
  selector: 'app-viewer',
  templateUrl: './viewer.component.html',
  styleUrls: ['./viewer.component.scss'],
})
export class ViewerComponent implements AfterViewChecked, OnInit, OnDestroy {
  @ViewChild('videoElement', { static: false }) public videoElement: any;
  @ViewChild('videoPlayer', { static: false }) public videoPlayer: any;

  public tagsOpen = false;
  public media?: Media;
  public videoPlayerState: VideoPlayerState = {};

  private uiService: UiService;
  private mediaService: MediaService;
  private configService: ConfigService;
  private qualityService: QualityService;
  private subscriptions: Subscription[] = [];
  private hls?: any;
  private config?: Configuration.Main;
  private videoInitialised = false;
  private currentLevel?: QualityLevel;
  private zone: NgZone;

  public constructor(
    uiService: UiService,
    mediaService: MediaService,
    configService: ConfigService,
    qualityService: QualityService,
    zone: NgZone,
  ) {
    this.uiService = uiService;
    this.mediaService = mediaService;
    this.configService = configService;
    this.qualityService = qualityService;
    this.zone = zone;
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
            this.videoPlayerState = {
              width: this.videoPlayerState.width,
              height: this.videoPlayerState.height,
              top: this.videoPlayerState.top,
              inControls: this.videoPlayerState.inControls,
              active: this.videoPlayerState.active,
            };
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
      this.videoElement.nativeElement.muted = true;

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

    if (this.videoElement) {
      if (this.videoElement.nativeElement.clientWidth !== this.videoPlayerState.width) {
        setTimeout(() => {
          this.zone.run(() => {
            this.videoPlayerState.width = this.videoElement.nativeElement.clientWidth;
          });
        }, 0);
      }

      if (this.videoElement.nativeElement.clientHeight !== this.videoPlayerState.height) {
        setTimeout(() => {
          this.zone.run(() => {
            this.videoPlayerState.height = this.videoElement.nativeElement.clientHeight;
          });
        }, 0);
      }

      if (this.videoElement.nativeElement.offsetTop !== this.videoPlayerState.top) {
        setTimeout(() => {
          this.zone.run(() => {
            this.videoPlayerState.top = this.videoElement.nativeElement.offsetTop;
          });
        }, 0);
      }
    }
  }

  public syncVolume() {
    if (!this.videoElement) {
      return;
    }
    this.videoPlayerState.muted = this.videoElement.nativeElement.muted;
    this.videoPlayerState.volume = this.videoElement.nativeElement.volume;
  }

  public updateNavigationTime(event: any, start = false) {
    if (event.type.startsWith('touch')) {
      event.preventDefault();
      event.clientX = event.changedTouches[0] && event.changedTouches[0].clientX;
      event.button = 0;
    }
    if (!this.videoElement || !this.videoPlayerState.duration) {
      return;
    }
    if (!start && this.videoPlayerState.navigationTime === undefined) {
      return;
    }
    if (start && event.button !== 0) {
      return;
    }

    const rect = (event.currentTarget || event.target).getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const percent = offsetX / (rect.right - rect.left);

    this.videoPlayerState.navigationTime = percent * this.videoPlayerState.duration;
  }

  public applyNavigationTime() {
    if (!this.videoElement || this.videoPlayerState.navigationTime === undefined) {
      return;
    }
    const duration = this.videoElement.nativeElement.duration;
    if (this.videoPlayerState.navigationTime < 0) {
      this.videoPlayerState.navigationTime = 0;
    } else if (this.videoPlayerState.navigationTime > duration) {
      this.videoPlayerState.navigationTime = duration;
    }
    if (isNaN(this.videoPlayerState.navigationTime)) {
      console.warn('navigationTime is NaN');
      this.videoPlayerState.navigationTime = undefined;
    } else {
      console.debug(`Seeking to ${this.videoPlayerState.navigationTime}`);
      this.videoElement.nativeElement.currentTime = this.videoPlayerState.navigationTime;
    }
  }

  public updateVolume(event: any) {
    if (event.type.startsWith('touch')) {
      event.preventDefault();
      event.clientX = event.changedTouches[0] && event.changedTouches[0].clientX;
      event.button = 0;
    }

    if (!this.videoElement || event.button !== 0) {
      return;
    }

    if (event.type === 'mousedown' || event.type === 'touchstart') {
      this.videoPlayerState.updatingVolume = true;
    }

    if (this.videoPlayerState.updatingVolume) {
      const rect = event.currentTarget.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      let volume = offsetX / (rect.right - rect.left);
      if (volume < 0) {
        volume = 0;
      } else if (volume > 1) {
        volume = 1;
      }
      this.videoElement.nativeElement.volume = volume;
    }

    if (event.type === 'mouseup' || event.type === 'mouseleave' || event.type === 'touchend') {
      this.videoPlayerState.updatingVolume = false;
    }
  }

  public areControlsOpen(): boolean {
    return Boolean(
      !this.videoPlayerState.playing ||
        this.videoPlayerState.loading ||
        this.videoPlayerState.inControls ||
        this.videoPlayerState.active ||
        this.videoPlayerState.updatingVolume ||
        this.videoPlayerState.navigationTime !== undefined,
    );
  }

  public toggleFullscreen() {
    if (!this.videoPlayer) {
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      this.videoPlayer.nativeElement.requestFullscreen();
    }
  }

  public isFullscreen(): boolean {
    return !!document.fullscreenElement;
  }

  public updatePlayerActivity(move = false) {
    if (move && isMobile()) {
      return;
    }
    if (this.videoPlayerState.active) {
      this.videoPlayerState.active.unsubscribe();
      this.videoPlayerState.active = undefined;
    }
    this.videoPlayerState.active = timer(PLAYER_CONTROLS_TIMEOUT).subscribe(() => {
      if (this.videoPlayerState.active) {
        this.videoPlayerState.active.unsubscribe();
        this.videoPlayerState.active = undefined;
      }
    });
  }

  public formatTime(value?: number): string {
    value = value || 0;
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const seconds = Math.floor(value % 60);
    const time: string[] = [];

    const pad = (num: number) => {
      return num < 10 ? `0${num}` : `${num}`;
    };

    if (hours > 0) {
      time.push(String(hours));
    }
    time.push(pad(minutes));
    time.push(pad(seconds));
    return time.join(':');
  }

  public toggleVideoPlay() {
    if (!this.videoElement) {
      return;
    }
    if (this.videoPlayerState.playing) {
      this.videoElement.nativeElement.pause();
    } else {
      this.videoElement.nativeElement.play();
    }
  }

  public onVideoOverlayClick() {
    this.toggleVideoPlay();

    const lastClick = this.videoPlayerState.lastClick;
    if (lastClick && Date.now() - lastClick < DOUBLE_CLICK_TIMEOUT) {
      this.toggleFullscreen();
    }
    this.videoPlayerState.lastClick = Date.now();
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

      this.syncVolume();

      this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        console.log('Manifest quality levels', data.levels);
        this.qualityService.qualityLevels.next(
          data.levels.map((el, i) => ({ width: el.width, height: el.height, index: i })),
        );

        // this.videoElement.nativeElement.muted = true;
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
