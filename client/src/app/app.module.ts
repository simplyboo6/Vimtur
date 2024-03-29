import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { RouteReuseStrategy } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';

import { AppRoutingModule } from './app-routing.module';
import { ReuseStrategy } from './reuse-strategy';
import { AppComponent } from './components/app/app.component';
import { NavbarComponent } from './components/navbar/navbar.component';
import { TagPanelComponent } from './components/tag-panel/tag-panel.component';
import { ConfirmationModalComponent } from './components/confirmation-modal/confirmation-modal.component';
import { PromptModalComponent } from './components/prompt-modal/prompt-modal.component';
import { ViewerComponent } from './components/viewer/viewer.component';
import { ConfigComponent } from './components/config/config.component';
import { AlertOverlayComponent } from './components/alert-overlay/alert-overlay.component';
import { MetadataComponent } from './components/metadata/metadata.component';
import { SearchComponent } from './components/search/search.component';
import { GalleryComponent } from './components/gallery/gallery.component';
import { InsightsComponent } from './components/insights/insights.component';
import { PreviewComponent } from './components/preview/preview.component';
import { VideoPlayerComponent } from './components/video-player/video-player.component';
import { CloneResolverComponent } from './components/clone-resolver/clone-resolver.component';
import { ConfirmBulkUpdateComponent } from './components/confirm-bulk-update/confirm-bulk-update.component';
import { ListModalComponent } from './components/list-modal/list-modal.component';
import { LoadingComponent } from './components/loading/loading.component';
import { PlaylistComponent } from './components/playlist/playlist.component';
import { PlaylistsComponent } from './components/playlists/playlists.component';
import { ActionsComponent } from './components/actions/actions.component';
import { LazyComponent } from './components/lazy/lazy.component';
import { ResizedDirective } from './shared/resized.directive';
import { FormatArrayPipe } from './shared/format-array.pipe';
import { SelectOptionComponent } from './components/select-option/select-option.component';
import { SelectComponent } from './components/select/select.component';

@NgModule({
  declarations: [
    AppComponent,
    NavbarComponent,
    TagPanelComponent,
    ConfirmationModalComponent,
    PromptModalComponent,
    ViewerComponent,
    ConfigComponent,
    AlertOverlayComponent,
    MetadataComponent,
    SearchComponent,
    GalleryComponent,
    InsightsComponent,
    PreviewComponent,
    VideoPlayerComponent,
    CloneResolverComponent,
    ConfirmBulkUpdateComponent,
    ListModalComponent,
    LoadingComponent,
    PlaylistComponent,
    PlaylistsComponent,
    ActionsComponent,
    LazyComponent,
    ResizedDirective,
    FormatArrayPipe,
    SelectOptionComponent,
    SelectComponent,
  ],
  imports: [
    NgbModule,
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    ReactiveFormsModule,
    HttpClientModule,
    BrowserAnimationsModule,
    DragDropModule,
    FontAwesomeModule,
  ],
  providers: [
    {
      provide: RouteReuseStrategy,
      useClass: ReuseStrategy,
    },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
