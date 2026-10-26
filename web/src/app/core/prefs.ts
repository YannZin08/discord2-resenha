import { Injectable, effect, signal } from '@angular/core';
import { save, store } from './util';

export interface StreamSettings {
  /** 'source' = the screen's own resolution, capped at 4K. */
  resolution: 'source' | '1440' | '1080' | '720';
  fps: 15 | 30 | 60;
  /** 'quality' keeps resolution (sharp text, 4K); 'smooth' keeps frame rate (games). */
  priority: 'quality' | 'smooth';
  audio: boolean;
}

export const MAX_STREAM: StreamSettings = { resolution: 'source', fps: 60, priority: 'quality', audio: true };

interface PrefsData {
  notifications: boolean;
  sounds: boolean;
  inputDevice: string;
  outputDevice: string;
  videoDevice: string;
  mute: boolean;
  deaf: boolean;
  userVolumes: Record<number, number>;
  compact: boolean;
  recentEmojis: string[];
  collapsed: Record<number, boolean>;
  theme: string;
  chatFont: number;
  stream: StreamSettings;
}

const DEFAULTS: PrefsData = {
  notifications: true,
  sounds: true,
  inputDevice: 'default',
  outputDevice: 'default',
  videoDevice: 'default',
  mute: false,
  deaf: false,
  userVolumes: {},
  compact: false,
  recentEmojis: ['👍', '😂', '❤️', '😮', '😢', '🔥', '🎉', '👀'],
  collapsed: {},
  theme: 'dark',
  chatFont: 16,
  stream: MAX_STREAM,
};

/** Per-device preferences, kept in localStorage. */
@Injectable({ providedIn: 'root' })
export class Prefs {
  readonly data = signal<PrefsData>({ ...DEFAULTS, ...store<Partial<PrefsData>>('prefs', {}) });

  constructor() {
    effect(() => save('prefs', this.data()));
  }

  get<K extends keyof PrefsData>(k: K): PrefsData[K] {
    return this.data()[k];
  }

  set<K extends keyof PrefsData>(k: K, v: PrefsData[K]) {
    this.data.update((d) => ({ ...d, [k]: v }));
  }

  useEmoji(e: string) {
    this.set('recentEmojis', [e, ...this.get('recentEmojis').filter((x) => x !== e)].slice(0, 24));
  }
}
