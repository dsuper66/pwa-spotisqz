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
}