import { Component, inject, signal } from '@angular/core';
import { SpotifyAuthService } from './spotify-auth.service';

import {
  SpotifyApiService,
  SpotifyPlaylist,
  SpotifyTrack,
} from './spotify-api.service';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  // Obtain the shared authentication and Spotify API services.
  auth = inject(SpotifyAuthService);
  api = inject(SpotifyApiService);

  // Playlist data and progress messages displayed by the template.
  playlists = signal<SpotifyPlaylist[]>([]);
  playlistStatus = signal('');
  loadingPlaylists = signal(false);

  // Initially empty; populated when we select a playlist.
  tracks = signal<SpotifyTrack[]>([]);

  // null means no track has been selected.
  selectedIndex = signal<number | null>(null);

  constructor() {
    // If Spotify has returned us to /callback, complete the login.
    void this.auth.handleCallback();
  }

  // Called by the Load playlists button in app.html.
  async loadPlaylists(): Promise<void> {
    this.loadingPlaylists.set(true);
    this.playlistStatus.set('Loading playlists…');

    try {
      // Retrieve all pages, then update the displayed list.
      const playlists = await this.api.getPlaylists();
      this.playlists.set(playlists);
      this.playlistStatus.set(`${playlists.length} playlists loaded`);
    } catch (error) {
      // Display the failure rather than leaving the user waiting.
      this.playlistStatus.set(String(error));
    } finally {
      // Allow another attempt after success or failure.
      this.loadingPlaylists.set(false);
    }
  }

  // Load the chosen playlist and display its tracks.
  async selectPlaylist(playlist: SpotifyPlaylist): Promise<void> {
    this.playlistStatus.set(`Loading tracks from ${playlist.name}…`);

    // Clear the old grid and its selected square.
    this.tracks.set([]);
    this.selectedIndex.set(null);

    try {
      const tracks = await this.api.getPlaylistTracks(playlist.id);

      // Updating the signal causes Angular to redraw the grid.
      this.tracks.set(tracks);

      this.playlistStatus.set(
        `${playlist.name}: ${tracks.length} playlist entries loaded`
      );
    } catch (error) {
      this.playlistStatus.set(String(error));
    }
  }

}