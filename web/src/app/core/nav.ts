import { Injectable, computed, signal } from '@angular/core';
import { save, store } from './util';

export type Route =
  | { name: 'login' }
  | { name: 'register' }
  | { name: 'invite'; code: string }
  | { name: 'app'; guildId: '@me' | number; channelId: number | null };

function currentPath(): string {
  try {
    return decodeURIComponent(location.pathname);
  } catch {
    return location.pathname;
  }
}

function parse(path: string): Route {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'login') return { name: 'login' };
  if (parts[0] === 'register') return { name: 'register' };
  if (parts[0] === 'invite' && parts[1]) return { name: 'invite', code: parts[1] };
  if (parts[0] === 'channels') {
    const guildId = parts[1] && parts[1] !== '@me' && Number(parts[1]) ? Number(parts[1]) : '@me';
    const channelId = parts[2] && Number(parts[2]) ? Number(parts[2]) : null;
    return { name: 'app', guildId, channelId };
  }
  return { name: 'app', guildId: '@me', channelId: null };
}

/** Minimal URL routing: /channels/@me, /channels/:guild/:channel, /invite/:code. */
@Injectable({ providedIn: 'root' })
export class Nav {
  readonly path = signal(currentPath());
  readonly route = computed(() => parse(this.path()));
  readonly guildId = computed(() => {
    const r = this.route();
    return r.name === 'app' && r.guildId !== '@me' ? r.guildId : null;
  });
  readonly channelId = computed(() => {
    const r = this.route();
    return r.name === 'app' ? r.channelId : null;
  });
  /** Message to scroll to and highlight once the channel shows it. */
  readonly jumpTo = signal<{ channelId: number; messageId: number } | null>(null);

  private lastChannels = store<Record<string, number>>('lastChannels', {});

  constructor() {
    window.addEventListener('popstate', () => this.path.set(currentPath()));
  }

  go(path: string, replace = false) {
    if (path === currentPath()) return;
    if (replace) history.replaceState(null, '', path);
    else history.pushState(null, '', path);
    this.path.set(path);
  }

  openChannel(guildId: number | null, channelId: number) {
    const g = guildId ?? '@me';
    this.lastChannels[String(g)] = channelId;
    save('lastChannels', this.lastChannels);
    this.go(`/channels/${g}/${channelId}`);
  }

  lastChannel(guildId: number | '@me'): number | undefined {
    return this.lastChannels[String(guildId)];
  }

  home() {
    this.go('/channels/@me');
  }

  jump(guildId: number | null, channelId: number, messageId: number) {
    this.openChannel(guildId, channelId);
    this.jumpTo.set({ channelId, messageId });
  }
}
