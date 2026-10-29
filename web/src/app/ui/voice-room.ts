import { Component, computed, inject, input, signal } from '@angular/core';
import { Store } from '../core/store';
import type { Channel } from '../core/types';
import { Ui } from '../core/ui';
import { Voice } from '../core/voice';
import { channelLabel } from '../core/util';
import { toggleStream } from './modals/go-live';
import { Avatar, Icon, SrcObject } from './shared';
import { Tip } from './tooltip';

interface Tile {
  key: string;
  sessionId: string;
  userId: number;
  kind: 'user' | 'screen';
  stream: MediaStream | null;
  self: boolean;
  mute: boolean;
  deaf: boolean;
  serverMute: boolean;
  serverDeaf: boolean;
  /** Screen tiles: whether we watch this stream, and who does. */
  watching: boolean;
  viewers: number[];
}

/** Grid of call participants, with camera / screen tiles and call controls. */
@Component({
  selector: 'app-voice-stage',
  imports: [Avatar, Icon, Tip, SrcObject],
  template: `
    <div class="stage" [class.compact]="compact()" [class.has-focus]="!!focusedTile()">
      <div class="stage-grid" [attr.data-count]="tiles().length">
        @for (t of tiles(); track t.key) {
          <div
            class="tile"
            [class.speaking]="t.kind === 'user' && voice.speaking().has(t.userId)"
            [class.video]="!!t.stream"
            [class.focused]="focus() === t.key"
            [class.hidden-by-focus]="!!focusedTile() && focus() !== t.key"
            (click)="tileClick(t)"
          >
            @if (t.kind === 'screen' && !t.self && !t.watching) {
              <div class="stream-invite">
                <app-avatar [user]="store.users()[t.userId]" [size]="compact() ? 48 : 64" />
                <span class="live-badge">AO VIVO</span>
                <button class="btn btn-brand" (click)="watch($event, t)">Assistir transmissão</button>
              </div>
            } @else if (t.stream) {
              <video
                [appSrcObject]="t.stream"
                autoplay
                playsinline
                [muted]="true"
                [class.mirror]="t.self && t.kind === 'user'"
                (resize)="onResize(t.key, $event)"
                (loadedmetadata)="onResize(t.key, $event)"
              ></video>
              <button class="tile-fs" appTip="Tela cheia" (click)="fullscreen($event)"><app-icon name="fullscreen" [size]="18" /></button>
              @if (t.kind === 'screen' && !t.self) {
                <div class="tile-volume" (click)="$event.stopPropagation()">
                  <button [appTip]="voice.streamVolume(t.userId) ? 'Silenciar transmissão' : 'Ativar som da transmissão'" (click)="toggleStreamMute(t.userId)">
                    <app-icon [name]="voice.streamVolume(t.userId) ? 'speaker' : 'speakerOff'" [size]="18" />
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    [value]="voice.streamVolume(t.userId)"
                    (input)="voice.setStreamVolume(t.userId, +$any($event.target).value)"
                    aria-label="Volume da transmissão"
                  />
                  <span>{{ voice.streamVolume(t.userId) }}%</span>
                </div>
              }
            } @else if (t.kind === 'screen') {
              <div class="stream-invite">
                <app-avatar [user]="store.users()[t.userId]" [size]="compact() ? 48 : 64" />
                <span>Conectando à transmissão...</span>
              </div>
            } @else {
              <div class="tile-avatar"><app-avatar [user]="store.users()[t.userId]" [size]="compact() ? 64 : 80" /></div>
            }
            @if (t.kind === 'screen' && t.watching) {
              <button class="tile-leave-stream" (click)="stopWatching($event)">Sair da transmissão</button>
            }
            <div class="tile-label">
              @if (t.kind === 'screen') {
                <span class="live-badge">AO VIVO</span>
                @if (t.stream && quality()[t.key]; as q) {
                  <span class="quality-badge">{{ q }}</span>
                }
                @if (t.viewers.length) {
                  <span class="stream-viewers" [appTip]="viewerNames(t)"><app-icon name="eye" [size]="14" />{{ t.viewers.length }}</span>
                }
              }
              <span>{{ store.nameIn(channel().guildId, t.userId) }}</span>
              @if (t.kind === 'user') {
                @if (t.mute || t.deaf || t.serverMute || t.serverDeaf) {
                  <app-icon [class.red]="t.serverMute || t.serverDeaf" name="micOff" [size]="14" />
                }
                @if (t.deaf || t.serverDeaf) {
                  <app-icon [class.red]="t.serverDeaf" name="headsetOff" [size]="14" />
                }
              }
            </div>
          </div>
        }
      </div>

      <div class="stage-controls">
        @if (connectedHere()) {
          <button class="round-btn" [class.off]="!voice.localCamera()" [appTip]="voice.localCamera() ? 'Desligar câmera' : 'Ligar câmera'" (click)="voice.toggleCamera()">
            <app-icon [name]="voice.localCamera() ? 'video' : 'videoOff'" />
          </button>
          <button class="round-btn" [class.on]="!!voice.localScreen()" [appTip]="voice.localScreen() ? 'Parar transmissão' : 'Transmitir tela'" (click)="stream()">
            <app-icon name="screen" />
          </button>
          <button class="round-btn" [class.on]="!!ui.soundboard()" appTip="Efeitos sonoros" (click)="ui.toggleSoundboard($any($event.currentTarget))">
            <app-icon name="soundboard" />
          </button>
          <button class="round-btn" [class.off]="voice.mute() || voice.deaf()" [appTip]="voice.mute() || voice.deaf() ? 'Ativar microfone' : 'Silenciar'" (click)="voice.toggleMute()">
            <app-icon [name]="voice.mute() || voice.deaf() ? 'micOff' : 'mic'" />
          </button>
          <button class="round-btn" [class.off]="voice.deaf()" [appTip]="voice.deaf() ? 'Ativar áudio' : 'Ensurdecer'" (click)="voice.toggleDeaf()">
            <app-icon [name]="voice.deaf() ? 'headsetOff' : 'headset'" />
          </button>
          <button class="round-btn danger" appTip="Desconectar" (click)="voice.leave()"><app-icon name="hangup" /></button>
        } @else {
          <button class="btn btn-success" (click)="join()">{{ channel().guildId == null ? 'Entrar na chamada' : 'Entrar no canal de voz' }}</button>
        }
      </div>
    </div>
  `,
})
export class VoiceStage {
  readonly channel = input.required<Channel>();
  readonly compact = input(false);
  readonly store = inject(Store);
  readonly voice = inject(Voice);
  readonly focus = signal<string | null>(null);
  /** Resolution actually being received for each stream tile, e.g. "4K". */
  readonly quality = signal<Record<string, string>>({});
  readonly ui = inject(Ui);

  readonly connectedHere = computed(() => this.voice.channelId() === this.channel().id);

  readonly tiles = computed<Tile[]>(() => {
    const me = this.store.me()?.id;
    const remote = this.voice.remoteVideo();
    const watching = this.voice.watching();
    const inCall = this.store.voiceIn(this.channel().id);
    const out: Tile[] = [];
    for (const v of inCall) {
      const self = v.userId === me && v.sessionId === this.store.sessionId();
      const cam = self ? this.voice.localCamera() : v.video ? (remote[v.sessionId]?.camera ?? null) : null;
      const base = { sessionId: v.sessionId, userId: v.userId, self, mute: v.mute, deaf: v.deaf, serverMute: !!v.serverMute, serverDeaf: !!v.serverDeaf, watching: false, viewers: [] as number[] };
      out.push({ ...base, key: v.sessionId, kind: 'user', stream: cam });
      if (!v.stream) continue;
      const watched = !self && watching === v.sessionId;
      const screen = self ? this.voice.localScreen() : watched ? (remote[v.sessionId]?.screen ?? null) : null;
      const viewers = inCall.filter((x) => x.watching === v.sessionId).map((x) => x.userId);
      out.push({ ...base, key: v.sessionId + ':screen', kind: 'screen', stream: screen, watching: watched, viewers });
    }
    return out;
  });

  readonly focusedTile = computed(() => this.tiles().find((t) => t.key === this.focus()) ?? null);

  stream() {
    toggleStream(this.ui, this.voice);
  }

  onResize(key: string, e: Event) {
    const v = e.target as HTMLVideoElement;
    // Classify by the long side so ultrawide screens still read as 4K / 1440p.
    const w = Math.max(v.videoWidth, v.videoHeight);
    if (!w) return;
    const label = w >= 3800 ? '4K' : w >= 2500 ? '1440p' : w >= 1900 ? '1080p' : w >= 1260 ? '720p' : `${Math.min(v.videoWidth, v.videoHeight)}p`;
    if (this.quality()[key] !== label) this.quality.update((q) => ({ ...q, [key]: label }));
  }

  /** Volume before muting a stream, to restore it when unmuting. */
  private lastStreamVolume = new Map<number, number>();

  toggleStreamMute(userId: number) {
    const cur = this.voice.streamVolume(userId);
    if (cur > 0) {
      this.lastStreamVolume.set(userId, cur);
      this.voice.setStreamVolume(userId, 0);
    } else {
      this.voice.setStreamVolume(userId, this.lastStreamVolume.get(userId) || 100);
    }
  }

  tileClick(t: Tile) {
    if (t.kind === 'screen' && !t.self && !t.watching) void this.startWatching(t);
    else this.focus.set(this.focus() === t.key ? null : t.key);
  }

  watch(e: MouseEvent, t: Tile) {
    e.stopPropagation();
    void this.startWatching(t);
  }

  /** Like Discord, the stream you start watching fills the stage. */
  private async startWatching(t: Tile) {
    await this.voice.watchStream(t.sessionId);
    if (this.voice.watching() === t.sessionId) this.focus.set(t.key);
  }

  stopWatching(e: MouseEvent) {
    e.stopPropagation();
    this.voice.stopWatching();
  }

  viewerNames(t: Tile): string {
    const gid = this.channel().guildId;
    return 'Assistindo: ' + t.viewers.map((u) => this.store.nameIn(gid, u)).join(', ');
  }

  fullscreen(e: MouseEvent) {
    e.stopPropagation();
    const tile = (e.currentTarget as HTMLElement).closest('.tile');
    void tile?.requestFullscreen?.();
  }

  join() {
    const c = this.channel();
    void this.voice.join(c.id, c.guildId);
  }
}

@Component({
  selector: 'app-voice-room',
  imports: [VoiceStage, Icon],
  template: `
    <section class="voice-room">
      <header class="chat-header">
        <button class="icon-btn mobile-only" (click)="ui.mobileNav.set(true)"><app-icon name="menu" /></button>
        <app-icon class="chat-hash" name="speaker" />
        <h1 class="chat-title">{{ title() }}</h1>
      </header>
      @if (store.voiceIn(channel().id).length || voice.channelId() === channel().id) {
        <app-voice-stage [channel]="channel()" />
      } @else {
        <div class="voice-empty">
          <app-icon name="speaker" [size]="64" />
          <h2>{{ title() }}</h2>
          <p>Ninguém está aqui ainda. Entre e chame a galera!</p>
          <button class="btn btn-success" (click)="voice.join(channel().id, channel().guildId)">Entrar no canal de voz</button>
        </div>
      }
    </section>
  `,
  host: { class: 'chat-host' },
})
export class VoiceRoom {
  readonly channel = input.required<Channel>();
  readonly store = inject(Store);
  readonly voice = inject(Voice);
  readonly ui = inject(Ui);
  readonly title = computed(() => channelLabel(this.channel(), this.store.users(), this.store.me()?.id));
}
