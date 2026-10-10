/// <reference types="spotify-web-playback-sdk" />
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';

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

  // Keep the intermediate playlist grid hidden during restoration.
  restoringDisplay = signal(true);

  // Playlist data and progress messages displayed by the template.
  playlists = signal<SpotifyPlaylist[]>([]);
  playlistStatus = signal('');
  loadingPlaylists = signal(false);

  // Initially empty; populated when we select a playlist.
  tracks = signal<SpotifyTrack[]>([]);

  // null means no track has been selected.
  selectedIndex = signal<number | null>(null);

  // The playlist whose tracks are currently displayed.
  selectedPlaylist = signal<SpotifyPlaylist | null>(null);

  // Playback messages and whether a command is in progress.
  playbackStatus = signal('');
  startingPlayback = signal(false);

  // Separate the current playback position from the clicked selection.
  playingIndex = signal<number | null>(null);
  refreshingPlayback = signal(false);

  // Find the grid element marked #trackGrid in the HTML.
  trackGrid = viewChild<ElementRef<HTMLDivElement>>('trackGrid');

  // Actual space available to the grid, in pixels.
  gridSize = signal({ width: 0, height: 0 });

  // Showing playlists (if false then showing tracks)
  showingPlaylists = computed(() => this.selectedPlaylist() === null);

  // Fit all tracks when possible, but stop tiles becoming too small.
  gridColumns = computed(() => {

    // The same grid displays either playlists or their tracks.
    const count = this.selectedPlaylist() === null
      ? this.playlists().length
      : this.tracks().length;

    const { width, height } = this.gridSize();
    const gap = 2; // Must match the CSS gap.
    const minimumTileSize = 40;

    if (count === 0 || width <= 0 || height <= 0) {
      return 4;
    }

    // Maximum columns we can use while keeping tiles at least 60px wide.
    const maximumColumns = Math.max(
      1,
      Math.min(
        count,
        Math.floor((width + gap) / (minimumTileSize + gap))
      )
    );

    // Try to fit the whole playlist into the available height.
    for (let columns = 1; columns <= maximumColumns; columns++) {
      const squareSize = (width - gap * (columns - 1)) / columns;
      const rows = Math.ceil(count / columns);

      // Include the portrait proportions when checking whether all rows fit.
      const tileHeight = squareSize * 1.25;
      const requiredHeight = rows * tileHeight + gap * (rows - 1);

      if (requiredHeight <= height) {
        return columns;
      }
    }

    // It cannot all fit: keep readable tiles and allow vertical scrolling.
    return maximumColumns;
  });

  // Portrait tiles: height is 1.25 times their width.
  gridTileHeight = computed(() => {
    const gap = 2;
    const columns = this.gridColumns();
    const tileWidth =
      (this.gridSize().width - gap * (columns - 1)) / columns;

    return Math.max(0, tileWidth) * 1.25;
  });

  constructor() {
    // Finish login, then restore the previously displayed playlist.
    void this.restoreDisplay();

    // Check playback every 2 seconds while the app is visible.
    const timer = window.setInterval(() => {
      if (
        this.auth.accessToken &&
        document.visibilityState === 'visible' &&
        !this.startingPlayback()
      ) {
        // refreshPlayback already prevents overlapping refresh requests.
        void this.refreshPlayback();
      }
    }, 2000);

    // Stop the timer when Angular destroys this component.
    inject(DestroyRef).onDestroy(() => {
      window.clearInterval(timer);

      // Close the browser player when this component is destroyed.
      this.browserPlayer?.disconnect();
    });

    // Observe the grid whenever it appears.
    // ResizeObserver also reports changes when the browser is resized.
    effect((onCleanup) => {
      const grid = this.trackGrid()?.nativeElement;

      if (!grid) {
        return;
      }

      const observer = new ResizeObserver(([entry]) => {
        this.gridSize.set({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      });

      observer.observe(grid);

      // Disconnect when the grid disappears or the component is destroyed.
      onCleanup(() => observer.disconnect());
    });
  }

  // Rebuild the display after a page reload.
  async restoreDisplay(): Promise<void> {
    try {
      await this.auth.handleCallback();

      if (!this.auth.accessToken) {
        return;
      }

      // Prepare the browser player while the playlists are loading.
      // Tapping a track will still provide the interaction needed for audio.
      void this.enableBrowserPlayer();

      await this.loadPlaylists();

      const playlistId =
        sessionStorage.getItem('spotify-selected-playlist');

      const playlist = this.playlists().find(
        playlist => playlist.id === playlistId
      );

      if (playlist) {
        await this.selectPlaylist(playlist);
      }

      await this.refreshPlayback();
    } finally {
      // Reveal the correct grid, even if restoration fails.
      this.restoringDisplay.set(false);
    }
  }

  // LOAD PLAYLISTS
  async loadPlaylists(): Promise<void> {
    this.loadingPlaylists.set(true);
    this.playlistStatus.set('Loading playlists…');

    try {
      // Retrieve all pages, then update the displayed list.
      const playlists = await this.api.getPlaylists();

      // Sort alphabetically, ignoring differences in case.
      this.playlists.set(
        [...playlists].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, {
            sensitivity: 'base',
            numeric: true,
          })
        )
      );

      this.playlistStatus.set(`${playlists.length} playlists loaded`);
    } catch (error) {
      // Display the failure rather than leaving the user waiting.
      this.playlistStatus.set(String(error));
    } finally {
      // Allow another attempt after success or failure.
      this.loadingPlaylists.set(false);
    }
  }

  // LOAD TRACKS FOR PLAYLIST
  async selectPlaylist(playlist: SpotifyPlaylist): Promise<void> {
    this.playlistStatus.set(`Loading tracks from ${playlist.name}…`);

    // Clear the previous playback context while loading.
    this.selectedPlaylist.set(null);
    this.playbackStatus.set('');

    // Clear the old grid and its selected square.
    this.tracks.set([]);
    this.selectedIndex.set(null);
    this.playingIndex.set(null);

    try {
      const tracks = await this.api.getPlaylistTracks(playlist.id);

      // Updating the signal causes Angular to redraw the grid.
      this.tracks.set(tracks);

      // Associate the loaded grid with its playlist.
      this.selectedPlaylist.set(playlist);
      // Remember which playlist to reopen after a reload.
      sessionStorage.setItem('spotify-selected-playlist', playlist.id);

      this.playlistStatus.set(
        `${playlist.name}: ${tracks.length} playlist entries loaded`
      );
    } catch (error) {
      this.playlistStatus.set(String(error));
    }
  }

  // Select the tapped track, then play it through our browser player.
  async playTrack(index: number): Promise<void> {
    const track = this.tracks()[index];

    if (!track || this.startingPlayback()) return;

    this.selectedIndex.set(index);

    if (!track.uri) {
      this.browserPlayerStatus.set('This track is unavailable.');
      return;
    }

    if (!this.browserDeviceId()) {
      this.browserPlayerStatus.set('Tap Enable browser player first.');
      return;
    }

    // Prevent overlapping commands from rapid taps.
    this.startingPlayback.set(true);

    try {
      // This reads selectedIndex and plays that exact track URI.
      await this.testBrowserPlayback();
    } finally {
      this.startingPlayback.set(false);
    }
  }

  // Match Spotify's current track to the displayed playlist.
  async refreshPlayback(): Promise<void> {
    if (this.refreshingPlayback()) {
      return;
    }

    this.refreshingPlayback.set(true);

    try {
      const state = await this.api.getPlaybackState();
      const playlist = this.selectedPlaylist();

      // Clear the previous highlight before interpreting the response.
      this.playingIndex.set(null);

      if (!state?.item) {
        this.playbackStatus.set('No current track reported by Spotify.');
        return;
      }

      const item = state.item;

      this.playbackStatus.set(
        `${state.is_playing ? 'Playing' : 'Paused'}: ${item.name}`
      );

      // Only highlight our grid if Spotify is using this playlist.
      if (!playlist || state.context?.uri !== playlist.uri) {
        return;
      }

      // Relinking can substitute another recording's URI.
      const index = this.tracks().findIndex(
        track =>
          track.uri === item.uri ||
          track.uri === item.linked_from?.uri
      );

      if (index >= 0) {
        this.playingIndex.set(index);
      }
    } catch (error) {
      this.playbackStatus.set(String(error));
    } finally {
      this.refreshingPlayback.set(false);
    }
  }

  // Return to the playlist list without stopping Spotify playback.
  showPlaylists(): void {
    // Returning to playlists should also be remembered.
    sessionStorage.removeItem('spotify-selected-playlist');

    this.selectedPlaylist.set(null);
    this.selectedIndex.set(null);
    this.playingIndex.set(null);
    this.tracks.set([]);
  }

  deviceStatus = signal('');
  checkingDevices = signal(false);

  // Report whether Spotify sees the iPhone while it is paused.
  async checkDevices(): Promise<void> {
    this.checkingDevices.set(true);
    this.deviceStatus.set('Checking Spotify devices…');

    try {
      const devices = await this.api.getDevices();

      this.deviceStatus.set(
        devices.length === 0
          ? 'No available Spotify devices.'
          : devices.map(device =>
            `${device.name} (${device.type}): ` +
            `${device.is_active ? 'active' : 'inactive'}` +
            `${device.is_restricted ? ', control restricted' : ''}`
          ).join(' • ')
      );
    } catch (error) {
      this.deviceStatus.set(String(error));
    } finally {
      this.checkingDevices.set(false);
    }
  }

  // Separate status so our playback polling cannot overwrite test errors.
  browserPlayerStatus = signal('');
  browserPlayerLoading = signal(false);
  browserDeviceId = signal<string | null>(null);

  private browserPlayer: Spotify.Player | null = null;

  // Load Spotify's SDK and create a player inside this browser.
  async enableBrowserPlayer(): Promise<void> {
    if (this.browserPlayer || this.browserPlayerLoading()) return;

    if (!this.auth.accessToken) {
      this.browserPlayerStatus.set('Connect Spotify first.');
      return;
    }

    this.browserPlayerLoading.set(true);
    this.browserPlayerStatus.set('Loading browser player…');

    try {
      // Load the SDK once. Spotify calls this function when it is ready.
      if (!window.Spotify) {
        await new Promise<void>((resolve, reject) => {
          window.onSpotifyWebPlaybackSDKReady = () => resolve();

          const script = document.createElement('script');
          script.src = 'https://sdk.scdn.co/spotify-player.js';
          script.onerror = () =>
            reject(new Error('Could not load Spotify’s browser SDK.'));

          document.head.appendChild(script);
        });
      }

      const player = new Spotify.Player({
        name: 'SpotiSqz browser',
        getOAuthToken: callback => {
          // Read the latest token when Spotify requests it.
          callback(this.auth.accessToken ?? '');
        },
        enableMediaSession: true,
      });

      this.browserPlayer = player;

      // This ID belongs to our browser player, not the Spotify iPhone app.
      player.addListener('ready', ({ device_id }) => {
        this.browserDeviceId.set(device_id);
        this.browserPlayerStatus.set('Browser player ready.');
      });

      player.addListener('not_ready', () => {
        this.browserDeviceId.set(null);
        this.browserPlayerStatus.set('Browser player disconnected.');
      });

      // Keep each SDK error visible in the separate test status.
      player.addListener('initialization_error', ({ message }) => {
        this.browserPlayerStatus.set(`Initialization: ${message}`);
      });

      player.addListener('authentication_error', ({ message }) => {
        this.browserPlayerStatus.set(`Authentication: ${message}`);
      });

      player.addListener('account_error', ({ message }) => {
        this.browserPlayerStatus.set(`Account: ${message}`);
      });

      player.addListener('playback_error', ({ message }) => {
        this.browserPlayerStatus.set(`Playback: ${message}`);
      });

      player.addListener('autoplay_failed', () => {
        this.browserPlayerStatus.set(
          'Audio was blocked. Tap Resume browser audio.'
        );
      });

      if (!await player.connect()) {
        this.browserPlayerStatus.set('Browser player could not connect.');
        player.disconnect();
        this.browserPlayer = null;
      }
    } catch (error) {
      this.browserPlayer?.disconnect();
      this.browserPlayer = null;
      this.browserPlayerStatus.set(String(error));
    } finally {
      this.browserPlayerLoading.set(false);
    }
  }

  // Play one track directly through our browser player.
  async testBrowserPlayback(): Promise<void> {
    const player = this.browserPlayer;
    const deviceId = this.browserDeviceId();
    const token = this.auth.accessToken;
    const track = this.tracks()[this.selectedIndex() ?? 0];
    const playlist = this.selectedPlaylist();

    if (!player || !deviceId || !token || !playlist || !track?.uri) {
      this.browserPlayerStatus.set(
        'Enable the browser player and open a playlist first.'
      );
      return;
    }

    try {
      // Invoke this directly from the button click, before any network wait.
      // This supplies the user interaction iOS requires for audio.
      await player.activateElement();

      this.browserPlayerStatus.set(`Starting in browser: ${track.name}…`);

      const response = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },

          // Play the chosen track within its playlist, preserving the queue.          
          body: JSON.stringify({
            // Keep this playlist as the queue for subsequent playback.
            context_uri: playlist.uri,

            // Identify the chosen track by URI.
            // Filtering unavailable tracks can change our grid's numeric positions.
            offset: { uri: track.uri },

            // Start the chosen track at the beginning.
            position_ms: 0,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Browser playback failed (${response.status}): ${await response.text()}`
        );
      }

      this.browserPlayerStatus.set(
        `Playback requested in browser: ${track.name}`
      );
    } catch (error) {
      this.browserPlayerStatus.set(String(error));
    }
  }

  // Explicit resume also gives iOS a direct user interaction.
  async resumeBrowserAudio(): Promise<void> {
    const player = this.browserPlayer;
    if (!player) return;

    try {
      await player.activateElement();
      await player.resume();
      this.browserPlayerStatus.set('Browser resume requested.');
    } catch (error) {
      this.browserPlayerStatus.set(String(error));
    }
  }

  async pauseBrowserAudio(): Promise<void> {
    if (!this.browserPlayer) return;

    try {
      await this.browserPlayer.pause();
      this.browserPlayerStatus.set('Browser pause requested.');
    } catch (error) {
      this.browserPlayerStatus.set(String(error));
    }
  }

  // Move within the browser player's existing playlist queue.
async previousBrowserTrack(): Promise<void> {
  const player = this.browserPlayer;
  if (!player) return;

  try {
    await player.activateElement();
    await player.previousTrack();
  } catch (error) {
    this.browserPlayerStatus.set(String(error));
  }
}

async nextBrowserTrack(): Promise<void> {
  const player = this.browserPlayer;
  if (!player) return;

  try {
    await player.activateElement();
    await player.nextTrack();
  } catch (error) {
    this.browserPlayerStatus.set(String(error));
  }
}

}