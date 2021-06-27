import {
  Component,
  OnInit,
  OnDestroy,
  Input,
  OnChanges,
  SimpleChanges,
  ChangeDetectorRef,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { Subscription, interval } from 'rxjs';
import { ConfigService } from 'app/services/config.service';
import { Configuration, Media } from '@vimtur/common';
import { isMobile } from 'is-mobile';
import { IntersectionService } from 'services/intersection.service';

const SLIDE_INTERVAL = 500;

@Component({
  selector: 'app-preview',
  templateUrl: './preview.component.html',
  styleUrls: ['./preview.component.scss'],
})
export class PreviewComponent implements OnInit, OnDestroy, OnChanges {
  @ViewChild('canvasElement', { static: false }) public canvasElement: any;
  @Input() public media?: Media;
  @Input() public offset?: number;
  @Input() public height?: number;
  @Input() public canvasStyleWidth?: string;
  @Input() public slideshow = false;

  public imageSrc?: string;
  public thumbnailSrc?: string;
  public canvasWidth?: number;
  public canvasHeight?: number;
  public image?: any;
  public thumbnail?: any;
  public imageRequested = false;

  private configService: ConfigService;
  private changeDetector: ChangeDetectorRef;
  private config?: Configuration.Main;
  private subscriptions: Subscription[] = [];
  private index?: number;
  private slideshowSubscription?: Subscription;
  private rendered = false;
  private intersectionService: IntersectionService;
  private ref: ElementRef;

  public constructor(
    configService: ConfigService,
    changeDetector: ChangeDetectorRef,
    intersectionService: IntersectionService,
    ref: ElementRef,
  ) {
    this.configService = configService;
    this.changeDetector = changeDetector;
    this.intersectionService = intersectionService;
    this.ref = ref;
  }

  public ngOnInit() {
    this.subscriptions.push(
      this.configService.getConfiguration().subscribe(config => {
        this.config = config;
      }),
    );

    if (this.height && this.media?.metadata) {
      this.canvasHeight = this.height;
      this.canvasWidth = Math.ceil(
        (this.media.metadata.width / this.media.metadata.height) * this.canvasHeight,
      );
    }

    if (isMobile()) {
      this.subscriptions.push(
        this.intersectionService.intersectionEmitter.subscribe(entries => {
          const found = entries.get(this.ref.nativeElement);
          if (found) {
            if (found.isIntersecting) {
              this.beginSlideshow(false);
            } else {
              this.endSlideshow(false);
            }
          }
        }),
      );
      this.intersectionService.observe(this.ref, true);
    }
  }

  public beginSlideshow(mouse: boolean): void {
    // Only begin the slideshow if there's no offset manually specified.
    if (this.offset !== undefined) {
      return;
    }

    this.imageRequested = true;

    // If it's mouse enter then ignore for mobile.
    if (mouse && isMobile()) {
      return;
    }
    this.endSlideshow(mouse);

    this.slideshowSubscription = interval(SLIDE_INTERVAL).subscribe(() => {
      if (!this.config || !this.media || !this.media.metadata) {
        return;
      }
      // Set to zero if undefined to trigger preview rendering.
      if (this.index === undefined) {
        this.index = 0;
      } else if (this.image) {
        // Only bump the index if the preview has loaded.
        this.index++;
      }

      const offset = this.index * this.config.transcoder.videoPreviewFps;
      if (!this.media.metadata.length || offset > this.media.metadata.length) {
        this.index = 0;
      }
      if (this.image) {
        this.rendered = false;
        this.render();
      }
    });

    this.render();
  }

  public endSlideshow(mouse: boolean) {
    // Don't end the slideshow if it's manually being controlled.
    if (this.offset !== undefined) {
      return;
    }

    if (mouse && isMobile()) {
      return;
    }
    if (this.slideshowSubscription) {
      this.slideshowSubscription.unsubscribe();
      this.slideshowSubscription = undefined;
    }
    this.rendered = false;
    this.index = undefined;
    this.render();
  }

  public ngOnChanges(changes: SimpleChanges) {
    if (changes.media && changes.media.currentValue) {
      const media = changes.media.currentValue;
      this.image = undefined;
      this.thumbnail = undefined;
      this.index = undefined;
      this.rendered = false;
      if (media.metadata) {
        if (media.type === 'video' && media.preview) {
          this.imageSrc = `/cache/previews/${media.hash}.png`;
        }
        this.thumbnailSrc = `/cache/thumbnails/${media.hash}.png`;
      }
    }

    if (changes.offset && this.config) {
      this.imageRequested = true;

      const index = Math.floor(
        (changes.offset.currentValue || 0) / this.config.transcoder.videoPreviewFps,
      );
      if (this.index !== index) {
        this.index = index;
        this.rendered = false;
        this.render();
      }
    }
  }

  public render() {
    if (!this.config || !this.media || !this.media.metadata || !this.canvasElement) {
      console.warn('preview render called with missing data');
      return;
    }

    // If nothing to render, leave early
    if (!this.image && !this.thumbnail) {
      return;
    }

    // Only render if a change has been made
    if (this.rendered) {
      return;
    }
    this.rendered = true;

    this.canvasHeight = this.height || this.config.transcoder.videoPreviewHeight;
    this.canvasWidth = Math.ceil(
      (this.media.metadata.width / this.media.metadata.height) * this.canvasHeight,
    );
    this.changeDetector.detectChanges();

    const canvas = this.canvasElement.nativeElement.getContext('2d');

    // If the thumbnails loaded and either the preview isn't loaded or the slideshow isn't in progress.
    if (this.index === undefined) {
      if (this.thumbnail) {
        canvas.drawImage(
          this.thumbnail,
          0,
          0,
          this.thumbnail.width,
          this.thumbnail.height,
          0,
          0,
          this.canvasWidth,
          this.canvasHeight,
        );
      }
    } else {
      if (this.image) {
        const mediaHeight = this.config.transcoder.videoPreviewHeight;
        const mediaWidth = Math.ceil(
          (this.media.metadata.width / this.media.metadata.height) * mediaHeight,
        );

        const columns = Math.ceil(this.image.naturalWidth / mediaWidth);

        const column = this.index % columns;
        const row = (this.index - column) / columns;

        const offsetX = column * mediaWidth;
        const offsetY = row * mediaHeight;

        canvas.drawImage(
          this.image,
          offsetX,
          offsetY,
          mediaWidth,
          mediaHeight,
          0,
          0,
          this.canvasWidth,
          this.canvasHeight,
        );
      }
    }
  }

  public onImageLoaded(event: any) {
    console.log('Preview loaded', this.imageSrc);
    this.image = event.target;
    this.changeDetector.detectChanges();
    this.rendered = false;
    this.render();
  }

  public onThumbnailLoaded(event: any) {
    console.log('Thumbnail loaded', this.thumbnailSrc);
    this.thumbnail = event.target;
    this.changeDetector.detectChanges();
    this.rendered = false;
    this.render();
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    if (this.slideshowSubscription) {
      this.slideshowSubscription.unsubscribe();
      this.slideshowSubscription = undefined;
    }
    this.subscriptions = [];
    this.intersectionService.unobserve(this.ref);
  }
}
