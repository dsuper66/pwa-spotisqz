import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SpotifyAuthService {
  private clientId = '75adfe1e725a4804817d98c2c340d5af';
  private redirectUri = 'http://127.0.0.1:4200/callback';

  status = signal('Not connected');
  accessToken: string | null = null;

  private randomString(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(value => value.toString(16).padStart(2, '0'))
      .join('');
  }

  async login(): Promise<void> {
    try {
      const verifier = this.randomString();
      const state = this.randomString();

      sessionStorage.setItem('spotify-verifier', verifier);
      sessionStorage.setItem('spotify-state', state);

      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(verifier),
      );

      const challenge = btoa(
        String.fromCharCode(...new Uint8Array(digest)),
      )
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const params = new URLSearchParams({
        client_id: this.clientId,
        response_type: 'code',
        redirect_uri: this.redirectUri,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        state,
        scope: [
          'playlist-read-private',
          'playlist-read-collaborative',
          'user-read-playback-state',
          'user-modify-playback-state',
        ].join(' '),
      });

      window.location.assign(
        `https://accounts.spotify.com/authorize?${params}`,
      );
    } catch (error) {
      this.status.set(`Login failed: ${String(error)}`);
    }
  }

  async handleCallback(): Promise<void> {
    if (window.location.pathname !== '/callback') return;

    this.status.set('Connecting…');

    try {
      const params = new URLSearchParams(window.location.search);
      const expectedState = sessionStorage.getItem('spotify-state');
      const verifier = sessionStorage.getItem('spotify-verifier');

      if (!expectedState || params.get('state') !== expectedState) {
        throw new Error('Login state did not match. Please reconnect.');
      }

      if (params.has('error')) {
        throw new Error(params.get('error')!);
      }

      const code = params.get('code');
      if (!code || !verifier) {
        throw new Error('Missing login details. Please reconnect.');
      }

      const response = await fetch(
        'https://accounts.spotify.com/api/token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: this.clientId,
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.redirectUri,
            code_verifier: verifier,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Token request failed (${response.status})`);
      }

      const tokens = await response.json();
      if (!tokens.access_token) throw new Error('No access token returned.');

      this.accessToken = tokens.access_token;
      this.status.set('Connected to Spotify');
    } catch (error) {
      this.status.set(`Connection failed: ${String(error)}`);
    } finally {
      sessionStorage.removeItem('spotify-verifier');
      sessionStorage.removeItem('spotify-state');
      window.history.replaceState({}, '', '/');
    }
  }
}