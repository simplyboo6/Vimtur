import {
  Component,
  OnInit,
  OnDestroy,
  Input,
  OnChanges,
  SimpleChanges,
  ChangeDetectorRef,
  ViewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { ConfigService } from 'app/services/config.service';
import { Configuration, Media } from '@vimtur/common';

@Component({
  selector: 'app-preview',
  templateUrl: './preview.component.html',
  styleUrls: ['./preview.component.scss'],
})
export class PreviewComponent implements OnInit, OnDestroy, OnChanges {
  @ViewChild('canvasElement', { static: false }) public canvasElement: any;
  @Input() public media?: Media;
  @Input() public offset?: number;

  public imageSrc?: string;
  public canvasWidth?: number;
  public canvasHeight?: number;
  public image?: any;

  private configService: ConfigService;
  private changeDetector: ChangeDetectorRef;
  private config?: Configuration.Main;
  private subscriptions: Subscription[] = [];
  private index = 0;

  public constructor(configService: ConfigService, changeDetector: ChangeDetectorRef) {
    this.configService = configService;
    this.changeDetector = changeDetector;
  }

  public ngOnInit() {
    this.subscriptions.push(
      this.configService.getConfiguration().subscribe(config => {
        this.config = config;
      }),
    );
  }

  public ngOnChanges(changes: SimpleChanges) {
    if (changes.media && changes.media.currentValue) {
      const media = changes.media.currentValue;
      this.image = undefined;
      this.index = 0;
      if (media.metadata && media.type === 'video') {
        this.imageSrc = `/cache/previews/${media.hash}.png`;
      }
    }

    if (changes.offset && this.image && this.config) {
      const index = Math.floor(
        (changes.offset.currentValue || 0) / this.config.transcoder.videoPreviewFps,
      );
      if (this.index !== index) {
        this.index = index;
        this.render();
      }
    }
  }

  public render() {
    if (!this.config || !this.image || !this.media || !this.media.metadata || !this.canvasElement) {
      console.warn('preview render called with missing data');
      return;
    }
    this.canvasHeight = this.config.transcoder.videoPreviewHeight;
    this.canvasWidth = Math.ceil(
      (this.media.metadata.width / this.media.metadata.height) * this.canvasHeight,
    );
    this.changeDetector.detectChanges();

    const offset = this.offset || 0;
    const offsetX = 0;
    const offsetY = this.index * this.config.transcoder.videoPreviewHeight;

    const canvas = this.canvasElement.nativeElement.getContext('2d');
    canvas.drawImage(
      this.image,
      offsetX,
      offsetY,
      this.canvasWidth,
      this.canvasHeight,
      0,
      0,
      this.canvasWidth,
      this.canvasHeight,
    );
  }

  public onImageLoaded(event: any) {
    this.image = event.target;
    this.changeDetector.detectChanges();
    this.render();
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }
}
