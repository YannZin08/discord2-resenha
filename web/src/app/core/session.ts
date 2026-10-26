import { Injectable, effect, signal } from '@angular/core';
import { Api } from './api';
import { Gateway } from './gateway';
import { Nav } from './nav';
import { Prefs } from './prefs';
import { sounds } from './sounds';
import { Store } from './store';
import type { Message, User, VoiceState } from './types';
import { APP_NAME, avatarUrl, channelLabel } from './util';
import { Voice } from './voice';

/** Login state, plus app-wide reactions to events (notifications, title badge). */
@Injectable({ providedIn: 'root' })
export class Session {
  readonly status = signal<'checking' | 'out' | 'in'>('checking');
  /** DM call ringing for us: someone joined voice in a DM we are not in. */
  readonly ringing = signal<{ channelId: number; userId: number } | null>(null);
  private ringTimer: ReturnType<typeof setInterval> | null = null;
  private dismissedCalls = new Set<number>();

  constructor(
    private api: Api,
    private store: Store,
    private gateway: Gateway,
    private nav: Nav,
    private voice: Voice,
    private prefs: Prefs,
  ) {
    gateway.onUnauthorized = () => this.signedOut();
    store.on('MESSAGE_CREATE', (m: Message) => this.notify(m));
    store.on('VOICE_STATE_UPDATE', () => this.checkRinging());
    store.on('READY', () => this.checkRinging());

    // Unread count in the tab title, like "(3) Resenha".
    effect(() => {
      let n = 0;
      for (const rs of Object.values(this.store.readStates())) n += rs.mentions;
      document.title = n ? `(${n}) ${APP_NAME}` : APP_NAME;
    });
  }

  async init() {
    try {
      const me = await this.api.get<User>('/auth/me');
      this.store.me.set(me);
      this.status.set('in');
      this.gateway.connect();
    } catch {
      this.status.set('out');
    }
  }

  async login(username: string, password: string) {
    const r = await this.api.post<{ user: User }>('/auth/login', { username, password });
    this.signedIn(r.user);
  }

  async register(username: string, displayName: string, password: string) {
    const r = await this.api.post<{ user: User }>('/auth/register', { username, displayName, password });
    this.signedIn(r.user);
  }

  private signedIn(user: User) {
    this.store.me.set(user);
    this.status.set('in');
    this.gateway.connect();
    if (this.nav.route().name !== 'invite') this.nav.go('/channels/@me', true);
  }

  async logout() {
    this.voice.leave(false);
    this.gateway.disconnect();
    try {
      await this.api.post('/auth/logout');
    } finally {
      this.signedOut();
    }
  }

  private signedOut() {
    this.voice.leave(false);
    this.gateway.disconnect();
    this.store.reset();
    this.status.set('out');
    if (this.nav.route().name !== 'invite') this.nav.go('/login', true);
  }

  private notify(m: Message) {
    const me = this.store.me();
    if (!me || m.authorId === me.id || !this.store.mentionsMe(m)) return;
    if (this.store.presences()[me.id] === 'dnd') return;
    const viewing = document.hasFocus() && this.nav.channelId() === m.channelId;
    if (viewing) return;
    if (this.prefs.get('sounds')) sounds.message();
    if (!this.prefs.get('notifications') || !('Notification' in window) || Notification.permission !== 'granted') return;
    const ch = this.store.channels()[m.channelId];
    const author = this.store.nameIn(m.guildId, m.authorId);
    const where = ch?.guildId != null ? `#${ch.name} (${this.store.guilds()[ch.guildId]?.name ?? ''})` : channelLabel(ch, this.store.users(), me.id);
    const body = m.type === 'call' ? 'Iniciou uma chamada' : m.content.replace(/<@(\d+)>/g, (_, id) => '@' + this.store.nameIn(m.guildId, +id)) || 'Enviou um anexo';
    try {
      const n = new Notification(ch?.type === 'dm' ? author : `${author} em ${where}`, {
        body: body.slice(0, 200),
        icon: avatarUrl(m.author) ?? '/icon.svg',
        tag: String(m.channelId),
      });
      n.onclick = () => {
        window.focus();
        this.nav.openChannel(m.guildId, m.channelId);
        n.close();
      };
    } catch {
      // some browsers only allow notifications from a service worker
    }
  }

  private checkRinging() {
    const me = this.store.me()?.id;
    const all = Object.values(this.store.voiceStates());
    let ring: { channelId: number; userId: number } | null = null;
    const inCall = new Set<number>();
    for (const v of all) if (v.channelId) inCall.add(v.channelId);
    for (const id of [...this.dismissedCalls]) if (!inCall.has(id)) this.dismissedCalls.delete(id);
    for (const v of all as VoiceState[]) {
      if (v.guildId != null || v.channelId == null || v.userId === me) continue;
      if (this.voice.channelId() === v.channelId || this.dismissedCalls.has(v.channelId)) continue;
      if (all.some((x) => x.userId === me && x.channelId === v.channelId)) continue;
      ring = { channelId: v.channelId, userId: v.userId };
      break;
    }
    this.ringing.set(ring);
    if (ring && !this.ringTimer && this.store.presences()[me ?? 0] !== 'dnd') {
      sounds.ring();
      this.ringTimer = setInterval(() => sounds.ring(), 2500);
      setTimeout(() => this.stopRing(), 30_000);
    } else if (!ring) {
      this.stopRing();
    }
  }

  private stopRing() {
    if (this.ringTimer) clearInterval(this.ringTimer);
    this.ringTimer = null;
  }

  dismissCall() {
    const r = this.ringing();
    if (r) this.dismissedCalls.add(r.channelId);
    this.stopRing();
    this.ringing.set(null);
  }

  acceptCall() {
    const r = this.ringing();
    if (!r) return;
    this.stopRing();
    this.ringing.set(null);
    this.nav.openChannel(null, r.channelId);
    void this.voice.join(r.channelId, null);
  }
}
