import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { TagInputModule } from 'ngx-chips';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { AppRoutingModule } from './app-routing.module';
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
  ],
  imports: [
    NgbModule,
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    ReactiveFormsModule,
    HttpClientModule,
    TagInputModule,
    BrowserAnimationsModule,
  ],
  providers: [],
  bootstrap: [AppComponent],
  entryComponents: [ConfirmationModalComponent, PromptModalComponent],
})
export class AppModule {}
