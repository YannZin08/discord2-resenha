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

/** Same knobs as Discord's Voice settings. */
export interface MicSettings {
  inputVolume: number; // 0–200 %
  mode: 'vad' | 'ptt';
  autoSensitivity: boolean;
  sensitivity: number; // dB, -100..0
  pttKey: string | null; // KeyboardEvent.code
  pttRelease: number; // ms
  noiseSuppression: 'advanced' | 'standard' | 'none';
  echoCancellation: boolean;
  autoGain: boolean;
}

export const DEFAULT_MIC: MicSettings = {
  inputVolume: 100,
  mode: 'vad',
  autoSensitivity: true,
  sensitivity: -50,
  pttKey: null,
  pttRelease: 20,
  noiseSuppression: 'advanced',
  echoCancellation: true,
  autoGain: true,
};

interface PrefsData {
  notifications: boolean;
  sounds: boolean;
  inputDevice: string;
  outputDevice: string;
  videoDevice: string;
  mute: boolean;
  deaf: boolean;
  userVolumes: Record<number, number>;
  streamVolumes: Record<number, number>;
  compact: boolean;
  recentEmojis: string[];
  collapsed: Record<number, boolean>;
  theme: string;
  /** Accent color over the theme (buttons, mentions); null keeps the theme's own. */
  accent: string | null;
  chatFont: number;
  /** Turns off the click / selection / entrance animations. */
  reduceMotion: boolean;
  stream: StreamSettings;
  mic: MicSettings;
  outputVolume: number; // 0–100 %
  musicVolume: number; // 0–100, the music bot player on this device
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
  streamVolumes: {},
  compact: false,
  recentEmojis: ['👍', '😂', '❤️', '😮', '😢', '🔥', '🎉', '👀'],
  collapsed: {},
  theme: 'dark',
  accent: null,
  chatFont: 16,
  reduceMotion: false,
  stream: MAX_STREAM,
  mic: DEFAULT_MIC,
  outputVolume: 100,
  musicVolume: 50,
};

function load(): PrefsData {
  const saved = store<Partial<PrefsData>>('prefs', {});
  // Nested objects get defaults for fields added after they were saved.
  return { ...DEFAULTS, ...saved, mic: { ...DEFAULT_MIC, ...saved.mic }, stream: { ...MAX_STREAM, ...saved.stream } };
}

/** Per-device preferences, kept in localStorage. */
@Injectable({ providedIn: 'root' })
export class Prefs {
  readonly data = signal<PrefsData>(load());

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
