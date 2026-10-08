import { Injectable, inject } from '@angular/core';
import { SpotifyAuthService } from './spotify-auth.service';

// The playlist properties our interface currently needs.
// Spotify returns more properties, but we don't need to declare them all.
export interface SpotifyPlaylist {
  id: string;
  name: string;
  uri: string;
}

// Spotify returns playlists one page at a time.
// "next" is the URL of the following page, or null for the last page.
interface PlaylistPage {
  items: (SpotifyPlaylist | null)[];
  next: string | null;
}

// The information Spotify returns about a track or episode.
// We only declare the fields we currently need.
interface SpotifyItem {
  name: string;
  uri: string;

  // Optional because Spotify may omit this field.
  is_playable?: boolean;
}

// Each playlist entry wraps its track or episode in an object.
interface PlaylistEntry {
  item?: SpotifyItem | null;

  // Older API responses use "track" instead of "item".
  track?: SpotifyItem | null;
}

// One page of playlist entries.
interface PlaylistItemsPage {
  items: (PlaylistEntry | null)[];
  next: string | null;
}

// One square in our track grid.
export interface SpotifyTrack {
  name: string;
  uri: string | null;
}

// Angular creates one shared instance of this service for the app.
@Injectable({ providedIn: 'root' })
export class SpotifyApiService {
  // Obtain the authentication service so we can use its access token.
  private auth = inject(SpotifyAuthService);

  // Return a Promise because retrieving playlists takes time.
  // The Promise eventually supplies the complete playlist array.
  async getPlaylists(): Promise<SpotifyPlaylist[]> {
    const token = this.auth.accessToken;

    // We cannot request account data until the user has connected.
    if (!token) throw new Error('Connect Spotify first.');

    // Accumulate all pages into this array.
    const playlists: SpotifyPlaylist[] = [];

    // Start by requesting up to 50 playlists from the current account.
    let url: string | null =
      'https://api.spotify.com/v1/me/playlists?limit=50';

    // Continue until Spotify returns no next-page URL.
    while (url) {
      // Make a background HTTP request directly from the browser.
      // The Bearer token proves that the user authorised our app.
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // HTTP errors don't automatically cause fetch() to throw.
      // Check the status ourselves and report failures to the caller.
      if (!response.ok) {
        throw new Error(`Playlist request failed (${response.status})`);
      }

      // Convert the JSON response into a JavaScript object.
      const page: PlaylistPage = await response.json();

      // Ignore any null entries returned by Spotify.
      const validPlaylists = page.items.filter(
        (item): item is SpotifyPlaylist => item !== null,
      );

      // Append this page's playlists to the accumulated array.
      // "..." passes each array element individually to push().
      playlists.push(...validPlaylists);

      // Follow Spotify's next-page URL on the next iteration.
      // If it is null, the loop ends.
      url = page.next;
    }

    return playlists;
  }

  // Retrieve all playlist entries, preserving their original order.
  async getPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
    const token = this.auth.accessToken;

    if (!token) {
      throw new Error('Connect Spotify first.');
    }

    const tracks: SpotifyTrack[] = [];

    //let url: string | null =
    //`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=50`;
    let url: string | null =
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=50&market=from_token`;

    // Keep fetching until Spotify returns no next-page URL.
    while (url) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Track request failed (${response.status})`);
      }

      const page: PlaylistItemsPage = await response.json();

      for (const entry of page.items) {
        const item = entry?.item ?? entry?.track;

        // Omit missing entries and tracks explicitly marked unplayable.
        // An omitted is_playable field does not mean false.
        if (!item || item.is_playable === false) {
          continue;
        }

        tracks.push({
          name: item.name,
          uri: item.uri,
        });
      }

      url = page.next;
    }

    return tracks;
  }

  // Start the playlist track at the chosen position on the active Spotify device.
  async playPlaylistTrack(
    playlistUri: string,
    index: number
  ): Promise<void> {
    const token = this.auth.accessToken;

    if (!token) {
      throw new Error('Connect Spotify first.');
    }

    const response = await fetch(
      'https://api.spotify.com/v1/me/player/play',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // The playlist supplies the context for subsequent tracks.
          context_uri: playlistUri,

          // Positions start at zero, just like our grid's $index.
          offset: { position: index },

          // Start at the beginning of the chosen track.
          position_ms: 0,
        }),
      }
    );

    if (!response.ok) {
      const detail = await response.text();

      throw new Error(
        `Playback request failed (${response.status}): ${detail}`
      );
    }

    // Successful playback requests return no JSON body.
  }

}