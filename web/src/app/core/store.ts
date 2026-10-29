import { Injectable, WritableSignal, computed, signal } from '@angular/core';
import { Api } from './api';
import type {
  Channel,
  Guild,
  Activity,
  CustomEmoji,
  GuildPayload,
  Member,
  Message,
  MusicState,
  ReadState,
  Ready,
  RelType,
  Role,
  Sound,
  Status,
  User,
  VoiceState,
} from './types';
import { displayName, roleColor, save, store as load } from './util';

export interface MessageList {
  messages: Message[];
  loaded: boolean;
  loading: boolean;
  hasMore: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (d: any) => void;

/** All client state, kept current by gateway events. */
@Injectable({ providedIn: 'root' })
export class Store {
  readonly ready = signal(false);
  readonly me = signal<User | null>(null);
  readonly sessionId = signal<string | null>(null);
  readonly users = signal<Record<number, User>>({});
  readonly guilds = signal<Record<number, Guild>>({});
  readonly guildOrder = signal<number[]>(load<number[]>('guildOrder', []));
  readonly channels = signal<Record<number, Channel>>({});
  readonly members = signal<Record<number, Record<number, Member>>>({});
  readonly roles = signal<Record<number, Role[]>>({});
  readonly presences = signal<Record<number, Status>>({});
  readonly relationships = signal<Record<number, RelType>>({});
  readonly readStates = signal<Record<number, ReadState>>({});
  readonly voiceStates = signal<Record<string, VoiceState>>({});
  readonly typing = signal<Record<number, Record<number, number>>>({});
  readonly pinsVersion = signal<Record<number, number>>({});
  /** Music bot state per guild. */
  readonly music = signal<Record<number, MusicState>>({});
  /** Ticks every 30 s, so game activity from the detector disappears once it expires. */
  readonly now = signal(Date.now());

  private lists = new Map<number, WritableSignal<MessageList>>();
  private listeners = new Map<string, Set<Listener>>();
  private typingTimer: ReturnType<typeof setInterval> | null = null;

  readonly guildList = computed(() => {
    const all = this.guilds();
    const order = this.guildOrder().filter((id) => all[id]);
    for (const id of Object.keys(all).map(Number)) if (!order.includes(id)) order.push(id);
    return order.map((id) => all[id]);
  });

  readonly privateChannels = computed(() =>
    Object.values(this.channels())
      .filter((c) => c.guildId == null)
      .sort((a, b) => (b.lastMessageId ?? b.id) - (a.lastMessageId ?? a.id)),
  );

  /** My own emojis (not tied to a server). */
  readonly myEmojis = signal<CustomEmoji[]>([]);

  /** My own soundboard sounds (not tied to a server). */
  readonly mySounds = signal<Sound[]>([]);
  /** Nox, the built-in music bot. */
  readonly musicBotId = signal<number | null>(null);

  /** Every custom emoji I can use anywhere: mine (guildId null), then each server's in order. */
  readonly customEmojis = computed<(CustomEmoji & { guildId: number | null })[]>(() => [
    ...this.myEmojis().map((e) => ({ ...e, guildId: null })),
    ...this.guildList().flatMap((g) => (g.emojis ?? []).map((e) => ({ ...e, guildId: g.id }))),
  ]);

  readonly myVoice = computed(() => {
    const sid = this.sessionId();
    return sid ? (this.voiceStates()[sid] ?? null) : null;
  });

  constructor(private api: Api) {
    setInterval(() => this.now.set(Date.now()), 30_000);
  }

  // ------------------------------------------------------------------ events

  on(t: string, fn: Listener): () => void {
    const set = this.listeners.get(t) ?? new Set();
    set.add(fn);
    this.listeners.set(t, set);
    return () => set.delete(fn);
  }

  private emit(t: string, d: unknown) {
    for (const fn of this.listeners.get(t) ?? []) {
      try {
        fn(d);
      } catch (e) {
        console.error(e);
      }
    }
  }

  reset() {
    this.ready.set(false);
    this.me.set(null);
    this.sessionId.set(null);
    this.users.set({});
    this.guilds.set({});
    this.channels.set({});
    this.members.set({});
    this.roles.set({});
    this.presences.set({});
    this.relationships.set({});
    this.readStates.set({});
    this.voiceStates.set({});
    this.typing.set({});
    this.lists.clear();
  }

  loadReady(r: Ready) {
    const users: Record<number, User> = {};
    for (const u of r.users) users[u.id] = u;
    users[r.user.id] = r.user;
    this.me.set(r.user);
    this.sessionId.set(r.sessionId);
    this.users.set(users);
    const guilds: Record<number, Guild> = {};
    const channels: Record<number, Channel> = {};
    const members: Record<number, Record<number, Member>> = {};
    const roles: Record<number, Role[]> = {};
    for (const g of r.guilds) {
      const { channels: chs, roles: rs, members: ms, ...guild } = g;
      guilds[g.id] = guild;
      for (const c of chs) channels[c.id] = c;
      roles[g.id] = [...rs].sort((a, b) => b.position - a.position);
      members[g.id] = Object.fromEntries(ms.map((m) => [m.userId, m]));
    }
    for (const c of r.privateChannels) channels[c.id] = c;
    this.guilds.set(guilds);
    this.channels.set(channels);
    this.members.set(members);
    this.roles.set(roles);
    this.presences.set({ ...r.presences });
    this.relationships.set(Object.fromEntries(r.relationships.map((x) => [x.userId, x.type])));
    this.readStates.set(Object.fromEntries(r.readStates.map((x) => [x.channelId, x])));
    this.voiceStates.set(Object.fromEntries(r.voiceStates.map((v) => [v.sessionId, v])));
    this.music.set(Object.fromEntries((r.music ?? []).map((m) => [m.guildId, { ...m, receivedAt: Date.now() }])));
    this.myEmojis.set(r.myEmojis ?? []);
    this.mySounds.set(r.mySounds ?? []);
    this.musicBotId.set(r.musicBotId ?? null);
    // History may have moved on while we were disconnected.
    for (const [id, list] of this.lists) {
      if (!channels[id]) this.lists.delete(id);
      else list.set({ messages: [], loaded: false, loading: false, hasMore: true });
    }
    this.ready.set(true);
    this.emit('READY', r);
  }

  private mergeUsers(list: (User | null | undefined)[], overwrite = true) {
    const fresh = list.filter((u): u is User => !!u);
    if (!fresh.length) return;
    this.users.update((all) => {
      const next = { ...all };
      for (const u of fresh) if (overwrite || !next[u.id]) next[u.id] = { ...next[u.id], ...u };
      return next;
    });
  }

  private applyGuild(g: GuildPayload) {
    const { channels: chs, roles: rs, members: ms, ...guild } = g;
    this.guilds.update((all) => ({ ...all, [g.id]: guild }));
    this.channels.update((all) => {
      const next = { ...all };
      for (const c of chs) next[c.id] = c;
      return next;
    });
    this.roles.update((all) => ({ ...all, [g.id]: [...rs].sort((a, b) => b.position - a.position) }));
    this.members.update((all) => ({ ...all, [g.id]: Object.fromEntries(ms.map((m) => [m.userId, m])) }));
    if (!this.guildOrder().includes(g.id)) this.setGuildOrder([...this.guildOrder(), g.id]);
  }

  setGuildOrder(order: number[]) {
    this.guildOrder.set(order);
    save('guildOrder', order);
  }

  private removeGuild(id: number) {
    this.guilds.update((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
    this.channels.update((all) => Object.fromEntries(Object.entries(all).filter(([, c]) => c.guildId !== id)));
    this.members.update((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
    this.voiceStates.update((all) => Object.fromEntries(Object.entries(all).filter(([, v]) => v.guildId !== id)));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch(t: string, d: any) {
    switch (t) {
      case 'GUILD_CREATE':
        this.mergeUsers(d.users);
        this.presences.update((p) => ({ ...p, ...d.presences }));
        this.applyGuild(d.guild);
        this.voiceStates.update((all) => {
          const next = { ...all };
          for (const v of d.voiceStates as VoiceState[]) next[v.sessionId] = v;
          return next;
        });
        if (d.music) this.setMusic(d.music);
        break;
      case 'MUSIC_STATE':
        this.setMusic(d);
        break;
      case 'GUILD_UPDATE':
        this.guilds.update((all) => (all[d.id] ? { ...all, [d.id]: { ...all[d.id], ...d } } : all));
        break;
      case 'USER_EMOJIS_UPDATE':
        this.myEmojis.set(d.emojis);
        break;
      case 'GUILD_EMOJIS_UPDATE':
        this.guilds.update((all) => (all[d.guildId] ? { ...all, [d.guildId]: { ...all[d.guildId], emojis: d.emojis } } : all));
        break;
      case 'USER_SOUNDS_UPDATE':
        this.mySounds.set(d.sounds);
        break;
      case 'GUILD_SOUNDS_UPDATE':
        this.guilds.update((all) => (all[d.guildId] ? { ...all, [d.guildId]: { ...all[d.guildId], sounds: d.sounds } } : all));
        break;
      case 'GUILD_DELETE':
        this.removeGuild(d.id);
        break;
      case 'GUILD_MEMBER_ADD':
        this.mergeUsers([d.user]);
        this.presences.update((p) => ({ ...p, [d.user.id]: d.status }));
        this.setMember(d.member);
        break;
      case 'GUILD_MEMBER_UPDATE':
        this.setMember(d);
        break;
      case 'GUILD_MEMBER_REMOVE':
        this.members.update((all) => {
          if (!all[d.guildId]) return all;
          const g = { ...all[d.guildId] };
          delete g[d.userId];
          return { ...all, [d.guildId]: g };
        });
        break;
      case 'GUILD_ROLE_CREATE':
      case 'GUILD_ROLE_UPDATE':
        this.roles.update((all) => {
          const list = (all[d.guildId] ?? []).filter((r) => r.id !== d.id);
          list.push(d);
          return { ...all, [d.guildId]: list.sort((a, b) => b.position - a.position) };
        });
        break;
      case 'GUILD_ROLE_DELETE':
        this.roles.update((all) => ({ ...all, [d.guildId]: (all[d.guildId] ?? []).filter((r) => r.id !== d.roleId) }));
        this.members.update((all) => {
          const g = all[d.guildId];
          if (!g) return all;
          const next: Record<number, Member> = {};
          for (const [k, m] of Object.entries(g)) next[+k] = m.roles.includes(d.roleId) ? { ...m, roles: m.roles.filter((r) => r !== d.roleId) } : m;
          return { ...all, [d.guildId]: next };
        });
        break;
      case 'CHANNEL_CREATE':
      case 'CHANNEL_UPDATE':
        if (d.users) this.mergeUsers(d.users);
        if (d.presences) this.presences.update((p) => ({ ...p, ...d.presences, [this.me()!.id]: p[this.me()!.id] }));
        this.channels.update((all) => ({ ...all, [d.channel.id]: d.channel }));
        break;
      case 'CHANNEL_DELETE':
        this.channels.update((all) => {
          const next = { ...all };
          delete next[d.id];
          return next;
        });
        this.lists.delete(d.id);
        break;
      case 'MESSAGE_CREATE':
        this.onMessageCreate(d);
        break;
      case 'MESSAGE_UPDATE':
        this.mergeUsers([d.author], false);
        this.patchMessage(d.channelId, d.id, () => d);
        break;
      case 'MESSAGE_DELETE':
        this.removeMessage(d.channelId, d.id);
        this.channels.update((all) => (all[d.channelId] ? { ...all, [d.channelId]: { ...all[d.channelId], lastMessageId: d.lastMessageId } } : all));
        break;
      case 'REACTION_ADD':
      case 'REACTION_REMOVE':
        this.patchMessage(d.channelId, d.messageId, (m) => {
          const reactions = m.reactions.map((r) => ({ ...r, users: [...r.users] }));
          let r = reactions.find((x) => x.emoji === d.emoji);
          if (t === 'REACTION_ADD') {
            if (!r) reactions.push((r = { emoji: d.emoji, users: [] }));
            if (!r.users.includes(d.userId)) r.users.push(d.userId);
          } else if (r) {
            r.users = r.users.filter((u) => u !== d.userId);
          }
          return { ...m, reactions: reactions.filter((x) => x.users.length) };
        });
        break;
      case 'TYPING_START':
        this.typing.update((all) => ({ ...all, [d.channelId]: { ...all[d.channelId], [d.userId]: Date.now() + 9000 } }));
        this.ensureTypingTimer();
        break;
      case 'PRESENCE_UPDATE':
        this.presences.update((p) => ({ ...p, [d.userId]: d.status }));
        break;
      case 'USER_UPDATE':
        this.mergeUsers([d]);
        if (d.id === this.me()?.id) this.me.update((m) => ({ ...m!, ...d }));
        break;
      case 'RELATIONSHIP_ADD':
        this.mergeUsers([d.user]);
        if (d.type === 'friend') this.presences.update((p) => ({ ...p, [d.userId]: d.status }));
        this.relationships.update((r) => ({ ...r, [d.userId]: d.type }));
        break;
      case 'RELATIONSHIP_REMOVE':
        this.relationships.update((r) => {
          const next = { ...r };
          delete next[d.userId];
          return next;
        });
        break;
      case 'VOICE_STATE_UPDATE':
        this.voiceStates.update((all) => {
          const next = { ...all };
          if (d.channelId == null) delete next[d.sessionId];
          else next[d.sessionId] = d;
          return next;
        });
        break;
      case 'READ_STATE_UPDATE':
        this.readStates.update((all) => {
          const next = { ...all };
          for (const s of d as ReadState[]) next[s.channelId] = s;
          return next;
        });
        break;
      case 'CHANNEL_PINS_UPDATE':
        this.pinsVersion.update((v) => ({ ...v, [d.channelId]: (v[d.channelId] ?? 0) + 1 }));
        break;
    }
    this.emit(t, d);
  }

  private setMusic(m: MusicState) {
    this.music.update((all) => {
      const next = { ...all };
      if (m.track) next[m.guildId] = { ...m, receivedAt: Date.now() };
      else delete next[m.guildId];
      return next;
    });
  }

  private setMember(m: Member) {
    this.members.update((all) => ({ ...all, [m.guildId]: { ...all[m.guildId], [m.userId]: m } }));
  }

  private ensureTypingTimer() {
    if (this.typingTimer) return;
    this.typingTimer = setInterval(() => {
      const now = Date.now();
      let any = false;
      let changed = false;
      const next: Record<number, Record<number, number>> = {};
      for (const [cid, users] of Object.entries(this.typing())) {
        const keep = Object.fromEntries(Object.entries(users).filter(([, exp]) => exp > now));
        if (Object.keys(keep).length !== Object.keys(users).length) changed = true;
        if (Object.keys(keep).length) {
          next[+cid] = keep;
          any = true;
        }
      }
      if (changed) this.typing.set(next);
      if (!any && this.typingTimer) {
        clearInterval(this.typingTimer);
        this.typingTimer = null;
      }
    }, 1000);
  }

  private onMessageCreate(m: Message) {
    this.mergeUsers([m.author], false);
    const me = this.me();
    this.channels.update((all) =>
      all[m.channelId] && (all[m.channelId].lastMessageId ?? 0) < m.id ? { ...all, [m.channelId]: { ...all[m.channelId], lastMessageId: m.id } } : all,
    );
    if (this.typing()[m.channelId]?.[m.authorId]) {
      this.typing.update((all) => {
        const users = { ...all[m.channelId] };
        delete users[m.authorId];
        return { ...all, [m.channelId]: users };
      });
    }
    if (me && m.authorId === me.id) {
      this.readStates.update((all) => ({ ...all, [m.channelId]: { channelId: m.channelId, lastReadId: m.id, mentions: 0 } }));
    } else if (me && this.mentionsMe(m)) {
      this.readStates.update((all) => {
        const rs = all[m.channelId] ?? { channelId: m.channelId, lastReadId: 0, mentions: 0 };
        return { ...all, [m.channelId]: { ...rs, mentions: rs.mentions + 1 } };
      });
    }
    const list = this.lists.get(m.channelId);
    if (!list || !list().loaded) return;
    list.update((l) => {
      if (l.messages.some((x) => x.id === m.id)) return l;
      const msgs = [...l.messages];
      const pendingIdx = m.nonce ? msgs.findIndex((x) => x.pending && x.nonce === m.nonce) : -1;
      if (pendingIdx >= 0) {
        msgs.splice(pendingIdx, 1);
      }
      // keep confirmed messages sorted, pending ones stay at the end
      let i = msgs.length;
      while (i > 0 && (msgs[i - 1].pending || msgs[i - 1].id > m.id)) i--;
      msgs.splice(i, 0, { ...m, pending: false });
      return { ...l, messages: msgs };
    });
  }

  mentionsMe(m: Message): boolean {
    const me = this.me();
    if (!me || m.authorId === me.id) return false;
    const c = this.channels()[m.channelId];
    if (c && c.guildId == null) return m.type !== 'pin';
    return m.mentionEveryone || m.mentions.includes(me.id);
  }

  // ------------------------------------------------------------------ messages

  list(channelId: number): WritableSignal<MessageList> {
    let l = this.lists.get(channelId);
    if (!l) {
      l = signal<MessageList>({ messages: [], loaded: false, loading: false, hasMore: true });
      this.lists.set(channelId, l);
    }
    return l;
  }

  async loadMessages(channelId: number, older = false): Promise<void> {
    const l = this.list(channelId);
    const cur = l();
    if (cur.loading || (older && !cur.hasMore) || (!older && cur.loaded)) return;
    l.update((x) => ({ ...x, loading: true }));
    const first = cur.messages.find((m) => !m.pending);
    const before = older && first ? `&before=${first.id}` : '';
    try {
      const msgs = await this.api.get<Message[]>(`/channels/${channelId}/messages?limit=50${before}`);
      this.mergeUsers(
        msgs.map((m) => m.author),
        false,
      );
      l.update((x) => {
        const known = new Set(x.messages.map((m) => m.id));
        const fresh = msgs.filter((m) => !known.has(m.id));
        return {
          messages: older ? [...fresh, ...x.messages] : [...fresh, ...x.messages.filter((m) => m.pending)],
          loaded: true,
          loading: false,
          hasMore: msgs.length === 50,
        };
      });
    } catch (e) {
      l.update((x) => ({ ...x, loading: false }));
      throw e;
    }
  }

  addPending(m: Message) {
    this.list(m.channelId).update((l) => ({ ...l, messages: [...l.messages, m] }));
  }

  patchMessage(channelId: number, id: number, fn: (m: Message) => Message) {
    const l = this.lists.get(channelId);
    if (!l) return;
    l.update((x) => {
      const i = x.messages.findIndex((m) => m.id === id);
      if (i < 0) return x;
      const msgs = [...x.messages];
      msgs[i] = fn(msgs[i]);
      return { ...x, messages: msgs };
    });
  }

  patchPending(channelId: number, nonce: string, fn: (m: Message) => Message | null) {
    const l = this.lists.get(channelId);
    if (!l) return;
    l.update((x) => {
      const i = x.messages.findIndex((m) => m.pending && m.nonce === nonce);
      if (i < 0) return x;
      const msgs = [...x.messages];
      const next = fn(msgs[i]);
      if (next) msgs[i] = next;
      else msgs.splice(i, 1);
      return { ...x, messages: msgs };
    });
  }

  removeMessage(channelId: number, id: number) {
    const l = this.lists.get(channelId);
    if (!l) return;
    l.update((x) => ({ ...x, messages: x.messages.filter((m) => m.id !== id) }));
  }

  // ------------------------------------------------------------------ queries

  isUnread(c: Channel | undefined): boolean {
    if (!c || c.type === 'voice' || c.type === 'category' || !c.lastMessageId) return false;
    return c.lastMessageId > (this.readStates()[c.id]?.lastReadId ?? 0);
  }

  mentionCount(channelId: number): number {
    return this.readStates()[channelId]?.mentions ?? 0;
  }

  guildChannels(gid: number): Channel[] {
    return Object.values(this.channels())
      .filter((c) => c.guildId === gid)
      .sort((a, b) => a.position - b.position || a.id - b.id);
  }

  guildUnread(gid: number): boolean {
    return this.guildChannels(gid).some((c) => this.isUnread(c));
  }

  guildMentions(gid: number): number {
    return this.guildChannels(gid).reduce((n, c) => n + this.mentionCount(c.id), 0);
  }

  member(gid: number | null | undefined, uid: number): Member | null {
    if (gid == null) return null;
    return this.members()[gid]?.[uid] ?? null;
  }

  nameIn(gid: number | null | undefined, uid: number): string {
    return displayName(this.users()[uid], this.member(gid, uid));
  }

  colorIn(gid: number | null | undefined, uid: number): string | null {
    if (gid == null) return null;
    return roleColor(this.member(gid, uid), this.roles()[gid]);
  }

  isOwner(gid: number | null | undefined, uid = this.me()?.id): boolean {
    return gid != null && this.guilds()[gid]?.ownerId === uid;
  }

  isAdmin(gid: number | null | undefined, uid = this.me()?.id): boolean {
    if (gid == null || uid == null) return false;
    if (this.isOwner(gid, uid)) return true;
    const m = this.member(gid, uid);
    if (!m) return false;
    return (this.roles()[gid] ?? []).some((r) => r.admin && m.roles.includes(r.id));
  }

  statusOf(uid: number): Status {
    return this.presences()[uid] ?? 'offline';
  }

  /** The game someone is playing, if they're online and it hasn't expired. */
  activityOf(uid: number): Activity | null {
    const a = this.users()[uid]?.activity ?? (this.me()?.id === uid ? this.me()?.activity : null);
    if (!a) return null;
    const status = this.statusOf(uid);
    if (status === 'offline' || (status === 'invisible' && this.me()?.id !== uid)) return null;
    return !a.until || a.until > this.now() ? a : null;
  }

  voiceIn(channelId: number): VoiceState[] {
    return Object.values(this.voiceStates())
      .filter((v) => v.channelId === channelId)
      .sort((a, b) => this.nameIn(a.guildId, a.userId).localeCompare(this.nameIn(b.guildId, b.userId)));
  }

  dmPartner(c: Channel | undefined): User | null {
    if (!c || c.type !== 'dm') return null;
    const other = c.recipients?.find((id) => id !== this.me()?.id);
    return other != null ? (this.users()[other] ?? null) : null;
  }
}
