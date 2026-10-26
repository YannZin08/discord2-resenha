import { Component, ElementRef, OnDestroy, computed, effect, inject, untracked, viewChild } from '@angular/core';
import { Api } from '../core/api';
import { Prefs } from '../core/prefs';
import { Store } from '../core/store';
import type { MusicState } from '../core/types';
import { Voice } from '../core/voice';

// Minimal typing for the YouTube IFrame Player API.
interface YtPlayer {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
}
interface YtNamespace {
  Player: new (el: HTMLElement, opts: unknown) => YtPlayer;
}
declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApi: Promise<YtNamespace> | null = null;
function loadYouTube(): Promise<YtNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  ytApi ??= new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return ytApi;
}

const ENDED = 0;
const PLAYING = 1;

/**
 * The music bot's audio. Everyone in the bot's voice channel plays the same YouTube video,
 * hidden, in sync with the server clock — so the music doesn't depend on the call connection.
 * The volume is the bot's "Volume do usuário" and the bot lights up as speaking while it plays.
 */
@Component({
  selector: 'app-music-player',
  // No visible player: the music plays as the bot's audio. The YouTube iframe stays
  // rendered (behind the app) because browsers stop media in iframes that are removed.
  template: `
    @if (state()) {
      <div class="music-host" aria-hidden="true"><div #host></div></div>
    }
  `,
})
export class MusicPlayer implements OnDestroy {
  readonly store = inject(Store);
  readonly prefs = inject(Prefs);
  private voice = inject(Voice);
  private api = inject(Api);
  private host = viewChild<ElementRef<HTMLElement>>('host');
  private player: YtPlayer | null = null;
  private playerReady = false;
  private loadedVideo: string | null = null;
  private reportedIndex = -1;
  private syncTimer = setInterval(() => this.sync(), 4000);

  /** Music in the voice channel you're connected to. */
  readonly state = computed<MusicState | null>(() => {
    const channel = this.voice.channelId();
    const gid = this.voice.guildId();
    if (!channel || gid == null) return null;
    const m = this.store.music()[gid];
    return m?.track && m.voiceChannelId === channel ? m : null;
  });

  /** The music bot's user id, from its voice state in this server. */
  readonly botId = computed<number | null>(() => {
    const gid = this.voice.guildId();
    if (gid == null) return null;
    return this.store.voiceStates()[`bot:music:${gid}`]?.userId ?? null;
  });

  constructor() {
    effect(() => {
      const m = this.state();
      const host = this.host();
      untracked(() => void this.apply(m, host?.nativeElement ?? null));
    });
    effect(() => {
      const vol = this.prefs.data().userVolumes[this.botId() ?? 0] ?? 100;
      const deaf = this.voice.deaf();
      untracked(() => this.applyVolume(vol, deaf));
    });
  }

  ngOnDestroy() {
    clearInterval(this.syncTimer);
    this.voice.setExternalSpeaking(this.botId(), false);
    this.player?.destroy();
  }

  /** Where the track should be right now, in seconds (negative = not started yet). */
  private expected(m: MusicState): number {
    const pos = m.position ?? 0;
    return m.paused ? pos : pos + (Date.now() - (m.receivedAt ?? Date.now())) / 1000;
  }

  private async apply(m: MusicState | null, host: HTMLElement | null) {
    if (!m?.track) {
      this.voice.clearExternalSpeaking();
      this.player?.destroy();
      this.player = null;
      this.playerReady = false;
      this.loadedVideo = null;
      return;
    }
    if (!this.player) {
      if (!host) return;
      const YT = await loadYouTube();
      if (this.player || !this.state()) return;
      this.loadedVideo = m.track.videoId;
      this.player = new YT.Player(host, {
        width: '100%',
        height: '100%',
        videoId: m.track.videoId,
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, start: Math.max(0, Math.floor(this.expected(m))) },
        events: {
          onReady: () => {
            this.playerReady = true;
            this.applyVolume(this.voice.userVolume(this.botId() ?? 0), this.voice.deaf());
            this.sync();
          },
          onStateChange: (e: { data: number }) => {
            this.voice.setExternalSpeaking(this.botId(), e.data === PLAYING);
            if (e.data === ENDED) this.report('ended');
          },
          onError: () => this.report('error'),
        },
      });
      return;
    }
    if (!this.playerReady) return;
    if (this.loadedVideo !== m.track.videoId) {
      this.loadedVideo = m.track.videoId;
      this.player.loadVideoById({ videoId: m.track.videoId, startSeconds: Math.max(0, this.expected(m)) });
    }
    this.sync();
  }

  /** Corrects drift and play/pause against the server state. */
  private sync() {
    const m = this.state();
    if (!m?.track || !this.player || !this.playerReady) return;
    const target = this.expected(m);
    if (m.paused) {
      this.player.pauseVideo();
      if (Math.abs(this.player.getCurrentTime() - target) > 1) this.player.seekTo(Math.max(0, target), true);
      return;
    }
    if (target < 0) {
      this.player.pauseVideo();
      setTimeout(() => this.sync(), -target * 1000);
      return;
    }
    if (Math.abs(this.player.getCurrentTime() - target) > 2) this.player.seekTo(target, true);
    if (this.player.getPlayerState() !== 1) this.player.playVideo();
  }

  private applyVolume(vol: number, deaf: boolean) {
    if (!this.player || !this.playerReady) return;
    this.player.setVolume(vol);
    if (deaf || vol === 0) this.player.mute();
    else this.player.unMute();
  }

  private report(action: 'ended' | 'error') {
    const m = this.state();
    if (!m || m.index == null || this.reportedIndex === m.index) return;
    this.reportedIndex = m.index;
    this.api.post(`/guilds/${m.guildId}/music`, { action, index: m.index }).catch(() => undefined);
  }
}
