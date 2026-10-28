import { Injectable, effect, signal, untracked } from '@angular/core';
import { Gateway } from './gateway';
import { Prefs } from './prefs';
import { Store } from './store';
import type { Sound } from './types';
import { Ui } from './ui';
import { Voice } from './voice';

export function soundUrl(id: number): string {
  return `/api/sounds/${id}`;
}

interface Playing {
  el: HTMLAudioElement;
  soundId: number;
  /** Who played it in the call; null for a preview only we hear. */
  userId: number | null;
  /** The sound's own volume, 0–100. */
  volume: number;
}

/**
 * Soundboard playback. Nothing goes through the call audio: the server tells everyone in the
 * channel which sound to play and each device plays the file itself, like the music bot.
 */
@Injectable({ providedIn: 'root' })
export class Soundboard {
  /** Sounds playing on this device right now (from the call or previews). */
  readonly playing = signal<ReadonlySet<number>>(new Set());
  private active = new Set<Playing>();
  /** When we last asked the server to play something, to show its refusal (if any). */
  private askedAt = 0;

  constructor(
    store: Store,
    private gateway: Gateway,
    private prefs: Prefs,
    private voice: Voice,
    private ui: Ui,
  ) {
    store.on('SOUNDBOARD_PLAY', (d) => {
      if (d.channelId !== this.voice.channelId() || this.voice.deaf()) return;
      this.start(d.soundId, d.volume, d.userId);
    });
    gateway.onOp('error', (msg) => {
      if (Date.now() - this.askedAt > 3000) return;
      this.askedAt = 0;
      this.ui.toast(String(msg.message), 'error');
    });
    // Leaving the call or deafening silences the call's sounds (previews keep going).
    effect(() => {
      if (!this.voice.channelId() || this.voice.deaf()) untracked(() => this.stopAll(true));
    });
    // Volume and output device changes apply to what's already playing.
    effect(() => {
      const d = this.prefs.data();
      void d.soundboardVolume;
      void d.outputVolume;
      void d.outputDevice;
      void d.userVolumes;
      untracked(() => this.active.forEach((p) => this.apply(p)));
    });
  }

  /** Plays a sound for everyone in our call, us included. */
  play(s: Sound) {
    if (!this.voice.channelId()) return this.ui.toast('Entre em uma chamada para usar os efeitos sonoros.', 'error');
    if (this.voice.deaf()) return this.ui.toast('Ative o áudio para usar os efeitos sonoros.', 'error');
    this.askedAt = Date.now();
    this.gateway.send({ op: 'sound', soundId: s.id });
  }

  /** Plays a sound only for us; again while it plays stops it. */
  preview(s: Sound) {
    const cur = [...this.active].find((p) => p.soundId === s.id && p.userId === null);
    if (cur) this.finish(cur);
    else this.start(s.id, s.volume, null);
  }

  /** Stops everything, or with `callOnly` just the sounds that came from the call. */
  stopAll(callOnly = false) {
    for (const p of [...this.active]) if (!callOnly || p.userId !== null) this.finish(p);
  }

  private start(soundId: number, volume: number, userId: number | null) {
    const p: Playing = { el: new Audio(soundUrl(soundId)), soundId, userId, volume };
    this.active.add(p);
    this.apply(p);
    p.el.onended = () => this.finish(p);
    p.el.onerror = () => this.finish(p);
    p.el.play().catch(() => this.finish(p));
    this.sync();
  }

  private finish(p: Playing) {
    if (!this.active.delete(p)) return;
    p.el.pause();
    p.el.removeAttribute('src');
    this.sync();
  }

  private apply(p: Playing) {
    const d = this.prefs.data();
    // Muting someone (their user volume at 0) mutes their sounds too.
    const mutedUser = p.userId !== null && this.voice.userVolume(p.userId) === 0;
    p.el.muted = mutedUser;
    p.el.volume = Math.min(1, (p.volume / 100) * (d.soundboardVolume / 100) * (d.outputVolume / 100));
    const el = p.el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (el.setSinkId && d.outputDevice) el.setSinkId(d.outputDevice === 'default' ? '' : d.outputDevice).catch(() => undefined);
  }

  /** Updates the "playing" set and lights up whoever's sound is playing, like the music bot. */
  private sync() {
    const ids = new Set<number>();
    const users = new Set<number>();
    for (const p of this.active) {
      ids.add(p.soundId);
      if (p.userId !== null) users.add(p.userId);
    }
    for (const uid of this.speakers) if (!users.has(uid)) this.voice.setExternalSpeaking(uid, false);
    for (const uid of users) this.voice.setExternalSpeaking(uid, true);
    this.speakers = users;
    this.playing.set(ids);
  }

  private speakers = new Set<number>();
}
