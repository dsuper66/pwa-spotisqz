import { Component, inject, signal } from '@angular/core';
import { SpotifyAuthService } from './spotify-auth.service';
import {
  SpotifyApiService,
  SpotifyPlaylist,
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

  // Sample tracks remain until we implement loading a playlist's tracks.
  tracks = [
    'E-Bow the Letter',
    "What's the Frequency, Kenneth?",
    'Stand',
    'Strange Currencies',
    'Losing My Religion',
    'Nightswimming',
    'Find the River',
    'Everybody Hurts',
    'Driver 8',
    'Orange Crush',
    'Man on the Moon',
    'Perfect Circle',
  ];

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
}