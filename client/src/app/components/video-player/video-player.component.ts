import { Component, AfterViewInit, OnInit, OnDestroy, OnChanges, ViewChild, SimpleChanges, Input, NgZone, ChangeDetectionStrategy } from '@angular/core';
import { AlertService } from 'services/alert.service';
import { ConfigService } from 'services/config.service';
import { Subscription, timer } from 'rxjs';
import { Media, Configuration } from '@vimtur/common';
import { isMobile } from 'is-mobile';
import Hls, { ErrorData } from 'hls.js';

const PLAYER_CONTROLS_TIMEOUT = 3000;
const DOUBLE_CLICK_TIMEOUT = 500;
// Fatal errors to recover from before rebuilding the player rather than retrying on the same stream.
// hls.js already retries internally before fatal errors reach here.
const MAX_CONSECUTIVE_RECOVERIES = 3;
// Total fatal errors to recover from before giving up entirely so permanently broken sources
// can't endlessly cycle through rebuilds. Only resets when a new media is loaded.
const MAX_TOTAL_RECOVERIES = 10;

interface QualityLevel {
  index: number;
  height: number;
}

interface VideoPlayerState {
  playing?: boolean;
  duration?: number;
  currentTime?: number;
  width?: number;
  height?: number;
  top?: number;
  loading?: boolean;
  switching?: boolean;
  active?: Subscription;
  inControls?: boolean;
  lastClick?: number;
  fullscreen?: boolean;
  navigationTime?: number;
  muted?: boolean;
  volume?: number;
  updatingVolume?: boolean;
  previewTime?: number;
  qualities?: QualityLevel[];
  currentQuality?: number;
  selectedQuality?: QualityLevel;
}

@Component({
  selector: 'app-video-player',
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class VideoPlayerComponent implements AfterViewInit, OnInit, OnDestroy, OnChanges {
  @ViewChild('videoElement', { static: false }) public videoElement: any;
  @ViewChild('videoPlayer', { static: false }) public videoPlayer: any;

  @Input() public media?: Media;
  public videoPlayerState: VideoPlayerState = {
    muted: true,
  };
  public qualitySelectorOpen = false;
  public readonly isMobile = isMobile();

  private configService: ConfigService;
  private alertService: AlertService;
  private subscriptions: Subscription[] = [];
  private hls?: any;
  private config?: Configuration.Main;
  private zone: NgZone;
  private initialised = false;
  private recoveryAttempts = 0;
  private totalRecoveryAttempts = 0;
  private mediaRecoveryAttempted = false;
  private failureAlerted = false;

  public constructor(configService: ConfigService, alertService: AlertService, zone: NgZone) {
    this.configService = configService;
    this.alertService = alertService;
    this.zone = zone;
  }

  public ngOnInit() {
    this.subscriptions.push(
      this.configService.getConfiguration().subscribe(config => {
        this.config = config;
      }),
    );
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];

    if (this.videoPlayerState.active) {
      this.videoPlayerState.active.unsubscribe();
      this.videoPlayerState.active = undefined;
    }

    if (this.videoElement) {
      this.videoElement.nativeElement.pause();
    }
    this.destroyPlayer();
  }

  public ngOnChanges(changes: SimpleChanges) {
    if (!changes.media) {
      return;
    }

    // If not previous value or next value
    let reset = !changes.media.previousValue || !changes.media.currentValue;
    // If current and previous and hashes don't match
    if (changes.media.previousValue && changes.media.currentValue) {
      reset = changes.media.previousValue.hash !== changes.media.currentValue.hash;
    }

    if (reset) {
      if (this.hls) {
        this.initialised = false;
        if (this.videoElement) {
          this.videoElement.nativeElement.pause();
        }
        this.destroyPlayer();
        this.videoPlayerState = {
          width: this.videoPlayerState.width,
          height: this.videoPlayerState.height,
          top: this.videoPlayerState.top,
          inControls: this.videoPlayerState.inControls,
          active: this.videoPlayerState.active,
          selectedQuality: this.videoPlayerState.selectedQuality,
          muted: this.videoPlayerState.muted,
          volume: this.videoPlayerState.volume,
        };
      }

      // Recovery caps and alerts are per media, not per player instance, so resets
      // happen on media change even when nothing else needs tearing down.
      this.totalRecoveryAttempts = 0;
      this.failureAlerted = false;

      if (this.media && this.media.type === 'video') {
        this.playVideo(this.media);
      }
    }
  }

  public onSeeking() {
    // Only has an effect if the segment isn't already loaded.
    if (this.shouldStartAtLowQuality()) {
      if (!this.hls) {
        return;
      }
      console.debug('Seeking - Forcing to level 0');
      this.hls.nextLoadLevel = 0;
    }
  }

  public onPlay() {
    if (this.hls && !this.isAutoplayEnabled()) {
      this.hls.startLoad();
    }
  }

  private isAutoplayEnabled(): boolean {
    return !this.isMobile && Boolean(this.config?.user?.autoplayEnabled);
  }

  private shouldStartAtLowQuality(): boolean {
    const lowQualityKey = this.isMobile ? 'lowQualityOnLoadEnabledForMobile' : 'lowQualityOnLoadEnabled';
    return Boolean(this.config?.user?.[lowQualityKey]);
  }

  public onResized() {
    if (this.videoElement) {
      const update =
        this.videoElement.nativeElement.clientWidth !== this.videoPlayerState.width ||
        this.videoElement.nativeElement.clientHeight !== this.videoPlayerState.height ||
        this.videoElement.nativeElement.offsetTop !== this.videoPlayerState.top;

      if (update) {
        setTimeout(() => {
          this.zone.run(() => {
            this.videoPlayerState.width = this.videoElement.nativeElement.clientWidth;
            this.videoPlayerState.height = this.videoElement.nativeElement.clientHeight;
            this.videoPlayerState.top = this.videoElement.nativeElement.offsetTop;
          });
        }, 0);
      }
    }
  }

  public ngAfterViewInit() {
    if (!this.media || this.media.type !== 'video') {
      return;
    }

    this.onResized();
    if (this.videoElement) {
      this.videoElement.nativeElement.muted = true;
    }

    this.playVideo(this.media);
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

    const rect = (event.currentTarget || event.target).getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const percent = offsetX / (rect.right - rect.left);
    const time = percent * this.videoPlayerState.duration;

    this.videoPlayerState.previewTime = time;

    if (!start && this.videoPlayerState.navigationTime === undefined) {
      return;
    }
    if (start && event.button !== 0) {
      return;
    }

    this.videoPlayerState.navigationTime = time;
  }

  public applyNavigationTime() {
    this.videoPlayerState.previewTime = undefined;

    if (!this.videoElement || this.videoPlayerState.navigationTime === undefined) {
      return;
    }
    const duration = this.videoElement.nativeElement.duration;
    if (this.videoPlayerState.navigationTime < 0) {
      this.videoPlayerState.navigationTime = 0;
    } else if (this.videoPlayerState.navigationTime > duration) {
      this.videoPlayerState.navigationTime = duration;
    }

    if (this.videoPlayerState.navigationTime !== undefined && !isNaN(this.videoPlayerState.navigationTime)) {
      console.debug(`Seeking to ${this.videoPlayerState.navigationTime}`);
      this.videoElement.nativeElement.currentTime = this.videoPlayerState.navigationTime;
    }
    this.videoPlayerState.navigationTime = undefined;
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
        this.videoPlayerState.navigationTime !== undefined ||
        this.qualitySelectorOpen,
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
    if (move && this.isMobile) {
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

  public selectQuality(quality: QualityLevel) {
    this.qualitySelectorOpen = false;

    if (!this.hls) {
      return;
    }

    if (quality.index === -1) {
      console.debug('switching hls stream to auto');
      this.videoPlayerState.currentQuality = -1;
      this.videoPlayerState.selectedQuality = undefined;
      this.hls.currentLevel = quality.index;
      this.videoPlayerState.switching = true;
      return;
    }

    this.videoPlayerState.selectedQuality = quality;

    if (this.hls.levels.length === 0) {
      return;
    }

    const foundIndex = this.hls.levels.findIndex((l: { height: number }) => l.height >= quality.height);
    this.videoPlayerState.currentQuality = foundIndex === undefined ? this.hls.levels.length - 1 : foundIndex;
    console.debug('switching hls stream quality', this.videoPlayerState.currentQuality, this.hls.levels);
    this.hls.currentLevel = this.videoPlayerState.currentQuality;
    this.videoPlayerState.switching = true;
  }

  private playVideo(media: Media) {
    if (!this.videoElement) {
      console.warn('playVideo called before videoElement initialised');
      return;
    }

    if (this.initialised) {
      return;
    } else {
      this.initialised = true;
    }

    const autoPlay = this.isAutoplayEnabled();
    const lowQualityOnSeek = this.shouldStartAtLowQuality();
    console.debug('playing video', media.hash, lowQualityOnSeek, autoPlay);

    this.hls = new Hls({
      autoStartLoad: false,
      capLevelToPlayerSize: true,
      maxBufferHole: 5,
      maxBufferLength: 15,
      startLevel: lowQualityOnSeek ? 0 : -1,
    });

    // Recovery counters belong to a single Hls instance/run of playback.
    this.recoveryAttempts = 0;
    this.mediaRecoveryAttempted = false;

    this.videoElement.nativeElement.volume = this.videoPlayerState.volume || 1;
    this.videoElement.nativeElement.muted = this.videoPlayerState.muted;

    this.hls.on(Hls.Events.MANIFEST_PARSED, (_: unknown, data: { levels: Array<{ height: number }> }) => {
      console.log('Manifest quality levels', data.levels);

      this.zone.run(() => {
        this.videoPlayerState.qualities = data.levels.map((level: { height: number }, index: number) => ({
          height: level.height,
          index,
        }));

        if (this.videoPlayerState.selectedQuality !== undefined) {
          this.selectQuality(this.videoPlayerState.selectedQuality);
        }
      });

      if (autoPlay) {
        this.videoElement.nativeElement.play();
      }
    });

    /*for (const key of Object.keys(Hls.Events)) {
      this.hls.on(Hls.Events[key], (event, data) => {
        if (key !== 'FRAG_LOAD_PROGRESS' && key !== 'BUFFER_APPENDED' && key !== 'BUFFER_APPENDING' && key !== 'STREAM_STATE_TRANSITION') {
          console.log(key, event, data);
        }
      });
    }*/

    // Need this for when switching from a fixed quality to auto.
    this.hls.on(Hls.Events.FRAG_LOADED, () => {
      // Loading is succeeding, so the error recovery counters can be reset.
      this.recoveryAttempts = 0;
      this.mediaRecoveryAttempted = false;
      this.zone.run(() => {
        if (this.hls.currentLevel >= 0) {
          this.videoPlayerState.currentQuality = this.hls.currentLevel;
        }
        this.videoPlayerState.switching = false;
      });
    });

    this.hls.on(Hls.Events.LEVEL_SWITCHED, (_: unknown, data: { level: number }) => {
      console.debug('Switched to quality level', data.level, this.hls.levels[data.level]);
      this.zone.run(() => {
        this.videoPlayerState.currentQuality = data.level;
        this.videoPlayerState.switching = false;
      });
    });

    this.hls.on(Hls.Events.ERROR, (_: unknown, data: ErrorData) => {
      // Non-fatal errors are logged and self-handled by hls.js.
      if (!data.fatal) {
        console.debug('HLS error', data.details, data.type);
        return;
      }

      console.warn('Fatal HLS error', data.details, data.type);
      this.zone.run(() => {
        this.videoPlayerState.loading = false;
        this.videoPlayerState.switching = false;
      });

      // Total count includes errors across rebuilds so permanently broken sources can't loop forever.
      this.totalRecoveryAttempts += 1;
      if (this.totalRecoveryAttempts >= MAX_TOTAL_RECOVERIES) {
        console.error(`Giving up on HLS playback after ${this.totalRecoveryAttempts} fatal errors`);
        this.destroyPlayer();
        if (!this.failureAlerted) {
          this.failureAlerted = true;
          this.alertService.show({ type: 'danger', message: 'Playback failed. Select the media again to restart.' });
        }
        return;
      }

      this.recoveryAttempts += 1;
      if (this.recoveryAttempts >= MAX_CONSECUTIVE_RECOVERIES) {
        console.debug('Rebuilding HLS player after consecutive failures', this.recoveryAttempts);
        this.recoveryAttempts = 0;
        this.resetPlayer();
        return;
      }

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        this.zone.run(() => {
          this.videoPlayerState.loading = true;
        });
        console.debug('HLS network error, restarting load', this.recoveryAttempts);
        this.hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        // hls.js expects the application to recover media errors, only attempt it once per stream.
        if (!this.mediaRecoveryAttempted) {
          this.mediaRecoveryAttempted = true;
          console.debug('HLS media error, attempting media recovery');
          this.hls.recoverMediaError();
        } else {
          this.resetPlayer();
        }
      } else {
        this.resetPlayer();
      }
    });

    this.hls.attachMedia(this.videoElement.nativeElement);

    this.hls.loadSource(`/api/images/${media.hash}/stream/index.m3u8`);
    if (autoPlay) {
      this.hls.startLoad();
    }
  }

  // Destroys the HLS player, leaving the component idle. Recovery counters are reset
  // in playVideo() which is what is used to rebuild it.
  private destroyPlayer() {
    if (this.hls) {
      this.hls.detachMedia();
      this.hls.destroy();
      this.hls = undefined;
    }
  }

  private resetPlayer() {
    if (this.videoElement) {
      this.videoElement.nativeElement.pause();
    }
    this.destroyPlayer();
    this.initialised = false;
    if (this.media && this.media.type === 'video') {
      this.playVideo(this.media);
    }
  }
}
