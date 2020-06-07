import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { ViewerComponent } from './components/viewer/viewer.component';
import { ConfigComponent } from './components/config/config.component';
import { MetadataComponent } from './components/metadata/metadata.component';
import { SearchComponent } from './components/search/search.component';
import { GalleryComponent } from './components/gallery/gallery.component';
import { InsightsComponent } from './components/insights/insights.component';
import { CloneResolverComponent } from './components/clone-resolver/clone-resolver.component';
import { PlaylistsComponent } from './components/playlists/playlists.component';

const routes: Routes = [
  { path: '', redirectTo: '/gallery', pathMatch: 'full' },
  { path: 'viewer', component: ViewerComponent },
  { path: 'config', component: ConfigComponent },
  { path: 'metadata', component: MetadataComponent },
  { path: 'search', component: SearchComponent },
  { path: 'gallery', component: GalleryComponent },
  { path: 'insights', component: InsightsComponent },
  { path: 'clone-resolver', component: CloneResolverComponent },
  { path: 'playlists', component: PlaylistsComponent },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
