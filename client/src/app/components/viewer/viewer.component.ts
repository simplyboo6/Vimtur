import { Component, OnInit, OnDestroy } from '@angular/core';
import { UiService } from 'services/ui.service';
import { MediaService } from 'services/media.service';
import { ConfigService } from 'services/config.service';
import { Subscription } from 'rxjs';
import { Media, Configuration } from '@vimtur/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { isMobile } from 'is-mobile';

@Component({
  selector: 'app-viewer',
  templateUrl: './viewer.component.html',
  styleUrls: ['./viewer.component.scss'],
})
export class ViewerComponent implements OnInit, OnDestroy {
  public tagsOpen = false;
  public media?: Media;
  public config?: Configuration.Main;
  public maxWidthObservable: Observable<string>;

  private uiService: UiService;
  private mediaService: MediaService;
  private configService: ConfigService;
  private subscriptions: Subscription[] = [];

  public constructor(
    uiService: UiService,
    mediaService: MediaService,
    configService: ConfigService,
  ) {
    this.uiService = uiService;
    this.mediaService = mediaService;
    this.configService = configService;

    this.maxWidthObservable = this.configService.getConfiguration().pipe(
      map(config => {
        if (config.user.scaleToScreenWidthOnMobile && isMobile()) {
          return `?maxWidth=${window.innerWidth}`;
        } else {
          return '';
        }
      }),
    );
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
