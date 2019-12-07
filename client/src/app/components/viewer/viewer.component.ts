import { Component, OnInit, OnDestroy } from '@angular/core';
import { UiService } from 'services/ui.service';
import { MediaService } from 'services/media.service';
import { ConfigService } from 'services/config.service';
import { Subscription } from 'rxjs';
import { Media, Configuration } from '@vimtur/common';

declare const Hls;

@Component({
  selector: 'app-viewer',
  templateUrl: './viewer.component.html',
  styleUrls: ['./viewer.component.scss'],
})
export class ViewerComponent implements OnInit, OnDestroy {
  public tagsOpen = false;
  public media?: Media;

  private uiService: UiService;
  private mediaService: MediaService;
  private configService: ConfigService;
  private subscriptions: Subscription[] = [];
  private config?: Configuration.Main;

  public constructor(
    uiService: UiService,
    mediaService: MediaService,
    configService: ConfigService,
  ) {
    this.uiService = uiService;
    this.mediaService = mediaService;
    this.configService = configService;
  }

  public ngOnInit() {
    this.subscriptions.push(
      this.uiService.getTagPanelState().subscribe(state => {
        this.tagsOpen = state;
      }),
    );

    this.subscriptions.push(
      this.mediaService.getMedia().subscribe(media => {
        this.media = media;
      }),
    );

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
  }
}
