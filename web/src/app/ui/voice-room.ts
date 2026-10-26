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
  userId: number;
  kind: 'user' | 'screen';
  stream: MediaStream | null;
  self: boolean;
  mute: boolean;
  deaf: boolean;
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
            (click)="toggleFocus(t.key)"
          >
            @if (t.stream) {
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
            } @else {
              <div class="tile-avatar"><app-avatar [user]="store.users()[t.userId]" [size]="compact() ? 64 : 80" /></div>
            }
            <div class="tile-label">
              @if (t.kind === 'screen') {
                <span class="live-badge">AO VIVO</span>
                @if (quality()[t.key]; as q) {
                  <span class="quality-badge">{{ q }}</span>
                }
              }
              <span>{{ store.nameIn(channel().guildId, t.userId) }}</span>
              @if (t.kind === 'user') {
                @if (t.deaf) {
                  <app-icon name="headsetOff" [size]="14" />
                } @else if (t.mute) {
                  <app-icon name="micOff" [size]="14" />
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
  private ui = inject(Ui);

  readonly connectedHere = computed(() => this.voice.channelId() === this.channel().id);

  readonly tiles = computed<Tile[]>(() => {
    const me = this.store.me()?.id;
    const remote = this.voice.remoteVideo();
    const out: Tile[] = [];
    for (const v of this.store.voiceIn(this.channel().id)) {
      const self = v.userId === me && v.sessionId === this.store.sessionId();
      const cam = self ? this.voice.localCamera() : v.video ? (remote[v.sessionId]?.camera ?? null) : null;
      const screen = self ? this.voice.localScreen() : v.stream ? (remote[v.sessionId]?.screen ?? null) : null;
      out.push({ key: v.sessionId, userId: v.userId, kind: 'user', stream: cam, self, mute: v.mute, deaf: v.deaf });
      if (v.stream) out.push({ key: v.sessionId + ':screen', userId: v.userId, kind: 'screen', stream: screen, self, mute: v.mute, deaf: v.deaf });
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

  toggleFocus(key: string) {
    this.focus.set(this.focus() === key ? null : key);
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
