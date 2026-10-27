import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import { HELP, MAX_PLAYLIST, formatTime, isMix, parseCommand, playerError, playlistId, resolvePlaylist, resolveTrack, youtubeId, type MusicState, type Track } from './music';
import { unfurl, type Embed } from './unfurl';
import {
  HttpError,
  color,
  hashPassword,
  idTime,
  json,
  newId,
  parseCookies,
  randomCode,
  randomHex,
  randomToken,
  str,
  toId,
  verifyPassword,
} from './util';

/** Songs in a row that fail to play before the music bot gives up. */
const MAX_FAILURES = 3;
/** The music bot leaves after being paused this long… */
const MUSIC_PAUSED_MS = 5 * 60_000;
/** …or when no listener's player starts the song within this time. */
const MUSIC_START_MS = 45_000;
/** A song that ran this long past its length without an "ended" report is skipped. */
const MUSIC_END_GRACE_MS = 15_000;
const MUSIC_CHECK_MS = 10_000;

// One Durable Object holds everything: the SQLite database and every open
// WebSocket. That keeps a team-sized server simple and fully consistent.

const COOKIE = 'rs_session';
const MAX_UPLOAD = 25 * 1024 * 1024;
/** Avatars and profile banners (GIFs included), like Discord's limit. */
const MAX_PROFILE_IMAGE = 10 * 1024 * 1024;
const MAX_MESSAGE = 4000;
// Files live in SQLite, split in chunks below the 2 MB value limit.
const CHUNK = 1024 * 1024;
// Only these types are shown inline; anything else is downloaded, so an uploaded
// HTML/SVG file can never run script on our origin.
const INLINE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|ogg|quicktime)|audio\/[\w.+-]+|application\/pdf)$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  avatar TEXT,
  banner_color TEXT,
  about TEXT NOT NULL DEFAULT '',
  custom_status TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'online',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS uploads (key TEXT PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS file_chunks (key TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (key, idx));
CREATE TABLE IF NOT EXISTS guilds (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, icon TEXT, owner_id INTEGER NOT NULL,
  system_channel_id INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  guild_id INTEGER NOT NULL, user_id INTEGER NOT NULL, nick TEXT, joined_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY, guild_id INTEGER NOT NULL, name TEXT NOT NULL, color TEXT,
  position INTEGER NOT NULL DEFAULT 0, hoist INTEGER NOT NULL DEFAULT 0, admin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS member_roles (
  guild_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role_id INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, role_id)
);
CREATE TABLE IF NOT EXISTS bans (guild_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id));
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY, guild_id INTEGER, type TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '', parent_id INTEGER, position INTEGER NOT NULL DEFAULT 0,
  owner_id INTEGER, last_message_id INTEGER
);
CREATE INDEX IF NOT EXISTS channels_guild ON channels(guild_id);
CREATE TABLE IF NOT EXISTS dm_members (
  channel_id INTEGER NOT NULL, user_id INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS dm_members_user ON dm_members(user_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, channel_id INTEGER NOT NULL, author_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'default', content TEXT NOT NULL DEFAULT '', reply_to INTEGER,
  edited_at INTEGER, pinned INTEGER NOT NULL DEFAULT 0, mentions TEXT NOT NULL DEFAULT '[]',
  mention_everyone INTEGER NOT NULL DEFAULT 0, attachments TEXT NOT NULL DEFAULT '[]', embeds TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel_id, id);
CREATE TABLE IF NOT EXISTS reactions (
  message_id INTEGER NOT NULL, emoji TEXT NOT NULL, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, emoji, user_id)
);
CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, guild_id INTEGER NOT NULL, inviter_id INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS relationships (user_id INTEGER NOT NULL, target_id INTEGER NOT NULL, type TEXT NOT NULL, PRIMARY KEY (user_id, target_id));
CREATE TABLE IF NOT EXISTS read_states (
  user_id INTEGER NOT NULL, channel_id INTEGER NOT NULL, last_read_id INTEGER NOT NULL DEFAULT 0,
  mentions INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX IF NOT EXISTS read_states_channel ON read_states(channel_id);
CREATE TABLE IF NOT EXISTS bot_tokens (token TEXT PRIMARY KEY, bot_id INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS music (guild_id INTEGER PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

// Columns added after the first release; ALTER fails harmlessly once they exist.
const MIGRATIONS = [
  'ALTER TABLE users ADD COLUMN bot INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN bot_owner INTEGER',
  'ALTER TABLE users ADD COLUMN banner TEXT',
];

const MUSIC_SID = (gid: number) => `bot:music:${gid}`;

// Everything here survives hibernation: it lives in the WebSocket attachment.
interface Att {
  uid: number;
  sid: string;
  idle: boolean;
  voice: VoiceAtt | null;
}
interface VoiceAtt {
  channelId: number;
  guildId: number | null;
  mute: boolean;
  deaf: boolean;
  video: boolean;
  stream: boolean;
  /** Session id of the stream this person is watching (one at a time, like Discord). */
  watching: string | null;
}
interface Attachment {
  key: string;
  name: string;
  size: number;
  mime: string;
  width: number | null;
  height: number | null;
}

// SQL rows come back loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  uid: number;
  body<T = Row>(): Promise<T>;
}
type Handler = (c: Ctx) => unknown;
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
  public: boolean;
}

const placeholders = (n: number) => Array(n).fill('?').join(',');

export class Hub extends DurableObject<Env> {
  private sql: SqlStorage;
  private sessions = new Map<string, number>();
  private loginFails = new Map<string, { n: number; until: number }>();
  private routes: Route[] = [];
  private closingSid: string | null = null;
  /** Active music sessions per guild (also stored in the `music` table). */
  private music = new Map<number, MusicState>();
  private musicBotId: number | null = null;
  private musicCheckScheduled = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(SCHEMA);
    for (const m of MIGRATIONS) {
      try {
        this.sql.exec(m);
      } catch {
        // already applied
      }
    }
    for (const row of this.all('SELECT data FROM music')) {
      const s = JSON.parse(row.data) as MusicState;
      this.music.set(s.guildId, s);
    }
    this.scheduleMusicCheck();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.registerRoutes();
  }

  // ---------------------------------------------------------------- SQL helpers

  private all(q: string, ...b: unknown[]): Row[] {
    return this.sql.exec(q, ...(b as SqlStorageValue[])).toArray() as Row[];
  }
  private one(q: string, ...b: unknown[]): Row | null {
    return this.all(q, ...b)[0] ?? null;
  }
  private run(q: string, ...b: unknown[]): void {
    this.sql.exec(q, ...(b as SqlStorageValue[]));
  }
  private tx<T>(fn: () => T): T {
    return this.ctx.storage.transactionSync(fn);
  }

  // ---------------------------------------------------------------- HTTP

  private registerRoutes() {
    const r = (method: string, path: string, handler: Handler, pub = false) => {
      const keys: string[] = [];
      const re = new RegExp(
        '^' +
          path.replace(/:(\w+)/g, (_, k: string) => {
            keys.push(k);
            return '([^/]+)';
          }) +
          '$',
      );
      this.routes.push({ method, re, keys, handler, public: pub });
    };
    r('POST', '/api/auth/register', (c) => this.register(c), true);
    r('POST', '/api/auth/login', (c) => this.login(c), true);
    r('POST', '/api/auth/logout', (c) => this.logout(c), true);
    r('GET', '/api/auth/me', (c) => this.selfUser(c.uid));
    r('PATCH', '/api/users/@me', (c) => this.updateMe(c));
    r('POST', '/api/users/@me/password', (c) => this.changePassword(c));
    r('POST', '/api/upload', (c) => this.upload(c));
    // File keys are random 128-bit ids, so links work like Discord's CDN links.
    for (const m of ['GET', 'HEAD']) {
      r(m, '/api/files/:key', (c) => this.serveFile(c), true);
      r(m, '/api/files/:key/:name', (c) => this.serveFile(c), true);
    }
    r('GET', '/api/voice/ice', () => this.iceServers());

    r('POST', '/api/relationships', (c) => this.addFriend(c));
    r('PUT', '/api/relationships/:userId', (c) => this.putRelationship(c));
    r('DELETE', '/api/relationships/:userId', (c) => this.deleteRelationship(c));
    r('POST', '/api/dms', (c) => this.openDm(c));

    r('POST', '/api/guilds', (c) => this.createGuild(c));
    r('PATCH', '/api/guilds/:guildId', (c) => this.updateGuild(c));
    r('DELETE', '/api/guilds/:guildId', (c) => this.deleteGuild(c));
    r('POST', '/api/guilds/:guildId/ack', (c) => this.ackGuild(c));
    r('DELETE', '/api/guilds/:guildId/members/@me', (c) => this.leaveGuild(c));
    r('PATCH', '/api/guilds/:guildId/members/:userId', (c) => this.updateMember(c));
    r('DELETE', '/api/guilds/:guildId/members/:userId', (c) => this.kick(c));
    r('GET', '/api/guilds/:guildId/bans', (c) => this.listBans(c));
    r('PUT', '/api/guilds/:guildId/bans/:userId', (c) => this.ban(c));
    r('DELETE', '/api/guilds/:guildId/bans/:userId', (c) => this.unban(c));
    r('POST', '/api/guilds/:guildId/channels', (c) => this.createChannel(c));
    r('PATCH', '/api/guilds/:guildId/channels', (c) => this.reorderChannels(c));
    r('POST', '/api/guilds/:guildId/roles', (c) => this.createRole(c));
    r('PATCH', '/api/guilds/:guildId/roles/:roleId', (c) => this.updateRole(c));
    r('DELETE', '/api/guilds/:guildId/roles/:roleId', (c) => this.deleteRole(c));
    r('GET', '/api/guilds/:guildId/invites', (c) => this.listInvites(c));
    r('POST', '/api/guilds/:guildId/invites', (c) => this.createInvite(c));
    r('GET', '/api/invites/:code', (c) => this.inviteInfo(c), true);
    r('POST', '/api/invites/:code', (c) => this.joinInvite(c));
    r('DELETE', '/api/invites/:code', (c) => this.deleteInvite(c));

    r('PATCH', '/api/channels/:channelId', (c) => this.updateChannel(c));
    r('DELETE', '/api/channels/:channelId', (c) => this.deleteChannel(c));
    r('GET', '/api/channels/:channelId/messages', (c) => this.getMessages(c));
    r('POST', '/api/channels/:channelId/messages', (c) => this.sendMessage(c));
    r('PATCH', '/api/channels/:channelId/messages/:messageId', (c) => this.editMessage(c));
    r('DELETE', '/api/channels/:channelId/messages/:messageId', (c) => this.deleteMessage(c));
    r('PUT', '/api/channels/:channelId/messages/:messageId/reactions/:emoji', (c) => this.react(c, true));
    r('DELETE', '/api/channels/:channelId/messages/:messageId/reactions/:emoji', (c) => this.react(c, false));
    r('GET', '/api/channels/:channelId/pins', (c) => this.getPins(c));
    r('PUT', '/api/channels/:channelId/pins/:messageId', (c) => this.setPin(c, true));
    r('DELETE', '/api/channels/:channelId/pins/:messageId', (c) => this.setPin(c, false));
    r('POST', '/api/channels/:channelId/ack', (c) => this.ack(c));
    r('GET', '/api/search', (c) => this.search(c));

    r('GET', '/api/guilds/:guildId/bots', (c) => this.listBots(c));
    r('POST', '/api/guilds/:guildId/bots', (c) => this.addBot(c));
    r('POST', '/api/guilds/:guildId/bots/:botId/token', (c) => this.regenerateBotToken(c));
    r('DELETE', '/api/guilds/:guildId/bots/:botId', (c) => this.removeBot(c));
    r('POST', '/api/guilds/:guildId/music', (c) => this.musicAction(c));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.get('origin');
        if (origin && new URL(origin).host !== url.host) throw new HttpError(403, 'Origem não permitida.');
      }
      if (url.pathname === '/api/gateway') return this.gateway(req, url);
      for (const route of this.routes) {
        if (route.method !== req.method) continue;
        const m = url.pathname.match(route.re);
        if (!m) continue;
        const params: Record<string, string> = {};
        route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        const uid = this.sessionUser(req);
        if (!uid && !route.public) throw new HttpError(401, 'Faça login para continuar.');
        let parsed: unknown;
        const ctx: Ctx = {
          req,
          url,
          params,
          uid: uid ?? 0,
          body: async <T>() => {
            if (parsed === undefined) {
              try {
                parsed = await req.json();
              } catch {
                throw new HttpError(400, 'Corpo da requisição inválido.');
              }
              if (!parsed || typeof parsed !== 'object') throw new HttpError(400, 'Corpo da requisição inválido.');
            }
            return parsed as T;
          },
        };
        const out = await route.handler(ctx);
        // A body nobody read would be streamed after the response is sent, which the runtime rejects.
        if (req.body && !req.bodyUsed) await req.body.cancel().catch(() => undefined);
        return out instanceof Response ? out : json(out ?? { ok: true });
      }
      throw new HttpError(404, 'Não encontrado.');
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Erro interno do servidor.' }, 500);
    }
  }

  private sessionUser(req: Request): number | null {
    // Bots authenticate like Discord bots: "Authorization: Bot <token>".
    const auth = req.headers.get('authorization')?.match(/^Bot\s+(\S+)$/i);
    if (auth) {
      const row = this.one('SELECT bot_id FROM bot_tokens WHERE token = ?', auth[1]);
      return row ? (row.bot_id as number) : null;
    }
    const token = parseCookies(req.headers.get('cookie'))[COOKIE];
    if (!token) return null;
    const cached = this.sessions.get(token);
    if (cached) return cached;
    const row = this.one('SELECT user_id FROM sessions WHERE token = ?', token);
    if (!row) return null;
    this.sessions.set(token, row.user_id);
    return row.user_id;
  }

  private sessionCookie(req: Request, token: string | null): string {
    const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
    if (!token) return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`;
  }

  private startSession(req: Request, uid: number): Response {
    const token = randomToken();
    this.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', token, uid, Date.now());
    this.sessions.set(token, uid);
    return json({ user: this.selfUser(uid) }, 200, { 'set-cookie': this.sessionCookie(req, token) });
  }

  // ---------------------------------------------------------------- serializers

  private pub(u: Row) {
    return {
      id: u.id as number,
      username: u.username as string,
      displayName: u.display_name as string,
      avatar: u.avatar as string | null,
      banner: (u.banner as string | null) ?? null,
      bannerColor: u.banner_color as string | null,
      about: u.about as string,
      customStatus: u.custom_status as string,
      createdAt: u.created_at as number,
      bot: !!u.bot,
    };
  }

  private selfUser(uid: number) {
    const u = this.one('SELECT * FROM users WHERE id = ?', uid);
    if (!u) throw new HttpError(401, 'Sessão inválida.');
    return { ...this.pub(u), status: u.status as string };
  }

  private usersByIds(ids: Iterable<number>): Row[] {
    const list = [...new Set(ids)];
    const out: Row[] = [];
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200);
      out.push(...this.all(`SELECT * FROM users WHERE id IN (${placeholders(chunk.length)})`, ...chunk));
    }
    return out;
  }

  private chan(c: Row) {
    const out: Row = {
      id: c.id,
      guildId: c.guild_id,
      type: c.type,
      name: c.name,
      topic: c.topic,
      parentId: c.parent_id,
      position: c.position,
      lastMessageId: c.last_message_id,
    };
    if (c.guild_id == null) {
      out.ownerId = c.owner_id;
      out.recipients = this.all('SELECT user_id FROM dm_members WHERE channel_id = ?', c.id).map((r) => r.user_id);
    }
    return out;
  }

  private role(r: Row) {
    return { id: r.id, guildId: r.guild_id, name: r.name, color: r.color, position: r.position, hoist: !!r.hoist, admin: !!r.admin };
  }

  private member(gid: number, uid: number) {
    const m = this.one('SELECT * FROM members WHERE guild_id = ? AND user_id = ?', gid, uid);
    if (!m) return null;
    const roles = this.all('SELECT role_id FROM member_roles WHERE guild_id = ? AND user_id = ?', gid, uid).map((r) => r.role_id);
    return { guildId: gid, userId: uid, nick: m.nick, roles, joinedAt: m.joined_at };
  }

  private buildGuild(gid: number) {
    const g = this.one('SELECT * FROM guilds WHERE id = ?', gid);
    if (!g) throw new HttpError(404, 'Servidor não encontrado.');
    const roleMap = new Map<number, number[]>();
    for (const r of this.all('SELECT user_id, role_id FROM member_roles WHERE guild_id = ?', gid)) {
      const list = roleMap.get(r.user_id) ?? [];
      list.push(r.role_id);
      roleMap.set(r.user_id, list);
    }
    return {
      id: g.id,
      name: g.name,
      icon: g.icon,
      ownerId: g.owner_id,
      systemChannelId: g.system_channel_id,
      createdAt: g.created_at,
      channels: this.all('SELECT * FROM channels WHERE guild_id = ? ORDER BY position, id', gid).map((c) => this.chan(c)),
      roles: this.all('SELECT * FROM roles WHERE guild_id = ? ORDER BY position DESC, id', gid).map((r) => this.role(r)),
      members: this.all('SELECT * FROM members WHERE guild_id = ?', gid).map((m) => ({
        guildId: gid,
        userId: m.user_id,
        nick: m.nick,
        roles: roleMap.get(m.user_id) ?? [],
        joinedAt: m.joined_at,
      })),
    };
  }

  private serializeMessages(rows: Row[]) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const reactions = new Map<number, Map<string, number[]>>();
    for (const r of this.all(
      `SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${placeholders(ids.length)}) ORDER BY created_at`,
      ...ids,
    )) {
      const byEmoji = reactions.get(r.message_id) ?? new Map<string, number[]>();
      const users = byEmoji.get(r.emoji) ?? [];
      users.push(r.user_id);
      byEmoji.set(r.emoji, users);
      reactions.set(r.message_id, byEmoji);
    }
    const refIds = [...new Set(rows.map((r) => r.reply_to).filter((x) => x != null))];
    const refs = new Map<number, Row>();
    if (refIds.length) {
      for (const r of this.all(`SELECT id, author_id, content, attachments, type FROM messages WHERE id IN (${placeholders(refIds.length)})`, ...refIds)) {
        refs.set(r.id, r);
      }
    }
    const users = new Map<number, Row>();
    for (const u of this.usersByIds([...rows.map((r) => r.author_id), ...[...refs.values()].map((r) => r.author_id)])) users.set(u.id, u);
    const chanIds = [...new Set(rows.map((r) => r.channel_id))];
    const guildOf = new Map<number, number | null>();
    for (const c of this.all(`SELECT id, guild_id FROM channels WHERE id IN (${placeholders(chanIds.length)})`, ...chanIds)) {
      guildOf.set(c.id, c.guild_id);
    }

    return rows.map((r) => {
      const author = users.get(r.author_id);
      const ref = r.reply_to != null ? refs.get(r.reply_to) : undefined;
      const refAuthor = ref ? users.get(ref.author_id) : undefined;
      return {
        id: r.id as number,
        channelId: r.channel_id as number,
        guildId: guildOf.get(r.channel_id) ?? null,
        authorId: r.author_id as number,
        author: author ? this.pub(author) : null,
        type: r.type as string,
        content: r.content as string,
        createdAt: idTime(r.id),
        editedAt: r.edited_at as number | null,
        replyTo: r.reply_to as number | null,
        reference:
          r.reply_to == null
            ? null
            : ref
              ? {
                  id: ref.id,
                  authorId: ref.author_id,
                  author: refAuthor ? this.pub(refAuthor) : null,
                  content: String(ref.content).slice(0, 300),
                  hasAttachments: ref.attachments !== '[]',
                }
              : { id: r.reply_to, deleted: true },
        pinned: !!r.pinned,
        mentions: JSON.parse(r.mentions) as number[],
        mentionEveryone: !!r.mention_everyone,
        attachments: JSON.parse(r.attachments) as Attachment[],
        embeds: JSON.parse(r.embeds) as Embed[],
        reactions: [...(reactions.get(r.id) ?? new Map<string, number[]>()).entries()].map(([emoji, users]) => ({ emoji, users })),
      };
    });
  }

  private message(id: number) {
    const row = this.one('SELECT * FROM messages WHERE id = ?', id);
    return row ? this.serializeMessages([row])[0] : null;
  }

  // ---------------------------------------------------------------- access

  private isMember(gid: number, uid: number): boolean {
    return !!this.one('SELECT 1 FROM members WHERE guild_id = ? AND user_id = ?', gid, uid);
  }

  private guildFor(uid: number, gid: number): Row {
    const g = this.one('SELECT * FROM guilds WHERE id = ?', gid);
    if (!g || !this.isMember(gid, uid)) throw new HttpError(404, 'Servidor não encontrado.');
    return g;
  }

  private isAdmin(gid: number, uid: number): boolean {
    const g = this.one('SELECT owner_id FROM guilds WHERE id = ?', gid);
    if (!g) return false;
    if (g.owner_id === uid) return true;
    return !!this.one(
      'SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.guild_id = ? AND mr.user_id = ? AND r.admin = 1',
      gid,
      uid,
    );
  }

  private adminGuild(uid: number, gid: number): Row {
    const g = this.guildFor(uid, gid);
    if (!this.isAdmin(gid, uid)) throw new HttpError(403, 'Você não tem permissão para fazer isso.');
    return g;
  }

  private channelFor(uid: number, channelId: number): Row {
    const c = this.one('SELECT * FROM channels WHERE id = ?', channelId);
    if (!c) throw new HttpError(404, 'Canal não encontrado.');
    if (c.guild_id != null) {
      if (!this.isMember(c.guild_id, uid)) throw new HttpError(404, 'Canal não encontrado.');
    } else if (!this.one('SELECT 1 FROM dm_members WHERE channel_id = ? AND user_id = ?', c.id, uid)) {
      throw new HttpError(404, 'Canal não encontrado.');
    }
    return c;
  }

  private audience(c: Row): number[] {
    if (c.guild_id != null) return this.all('SELECT user_id FROM members WHERE guild_id = ?', c.guild_id).map((r) => r.user_id);
    return this.all('SELECT user_id FROM dm_members WHERE channel_id = ?', c.id).map((r) => r.user_id);
  }

  private guildMembers(gid: number): number[] {
    return this.all('SELECT user_id FROM members WHERE guild_id = ?', gid).map((r) => r.user_id);
  }

  private relatedUserIds(uid: number): number[] {
    return this.all(
      `SELECT m2.user_id AS id FROM members m1 JOIN members m2 ON m1.guild_id = m2.guild_id WHERE m1.user_id = ?
       UNION SELECT target_id FROM relationships WHERE user_id = ?
       UNION SELECT d2.user_id FROM dm_members d1 JOIN dm_members d2 ON d1.channel_id = d2.channel_id WHERE d1.user_id = ?`,
      uid,
      uid,
      uid,
    ).map((r) => r.id);
  }

  private ownedUpload(key: unknown, uid: number, imageOnly = false): string {
    if (typeof key !== 'string') throw new HttpError(400, 'Arquivo inválido.');
    const up = this.one('SELECT * FROM uploads WHERE key = ? AND user_id = ?', key, uid);
    if (!up) throw new HttpError(400, 'Arquivo não encontrado.');
    if (imageOnly && !String(up.mime).startsWith('image/')) throw new HttpError(400, 'O arquivo precisa ser uma imagem.');
    return key;
  }

  private profileImage(key: unknown, uid: number, what: string): string {
    const k = this.ownedUpload(key, uid, true);
    const size = Number(this.one('SELECT size FROM uploads WHERE key = ?', k)?.size ?? 0);
    if (size > MAX_PROFILE_IMAGE) {
      throw new HttpError(413, `${what} pode ter até 10 MB e esse arquivo tem ${(size / 1024 / 1024).toFixed(1)} MB. Escolha uma imagem ou GIF menor.`);
    }
    return k;
  }

  private blockedBetween(a: number, b: number): boolean {
    return !!this.one(
      "SELECT 1 FROM relationships WHERE type = 'blocked' AND ((user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?))",
      a,
      b,
      b,
      a,
    );
  }

  // ---------------------------------------------------------------- sockets

  private attOf(ws: WebSocket): Att | null {
    return ws.deserializeAttachment() as Att | null;
  }

  private live(tag?: string): WebSocket[] {
    return this.ctx.getWebSockets(tag).filter((ws) => {
      if (ws.readyState !== 1) return false;
      return this.attOf(ws)?.sid !== this.closingSid;
    });
  }

  private sendWs(ws: WebSocket, payload: unknown) {
    try {
      ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    } catch {
      // socket already gone
    }
  }

  private broadcast(uids: Iterable<number>, t: string, d: unknown) {
    const s = JSON.stringify({ op: 'event', t, d });
    for (const uid of new Set(uids)) for (const ws of this.live(String(uid))) this.sendWs(ws, s);
  }

  private presence(uid: number, forSelf = false, row?: Row): string {
    // The built-in music bot lives in the server itself, so it is always online.
    if (uid === this.musicBot(false)) return 'online';
    const socks = this.live(String(uid));
    if (!socks.length) return 'offline';
    const pref = (row ?? this.one('SELECT status FROM users WHERE id = ?', uid))?.status ?? 'online';
    if (pref === 'invisible') return forSelf ? 'invisible' : 'offline';
    if (pref === 'dnd' || pref === 'idle') return pref;
    return socks.every((ws) => this.attOf(ws)?.idle) ? 'idle' : 'online';
  }

  private broadcastPresence(uid: number) {
    const status = this.presence(uid);
    this.broadcast(
      this.relatedUserIds(uid).filter((id) => id !== uid),
      'PRESENCE_UPDATE',
      { userId: uid, status },
    );
    this.broadcast([uid], 'PRESENCE_UPDATE', { userId: uid, status: this.presence(uid, true) });
  }

  private voiceStates(filter: (v: VoiceAtt) => boolean, withBots = true) {
    const out = [];
    for (const ws of this.live()) {
      const att = this.attOf(ws);
      if (att?.voice && filter(att.voice)) out.push(this.voiceState(att, att.voice));
    }
    if (withBots) {
      for (const m of this.music.values()) {
        const v: VoiceAtt = { channelId: m.voiceChannelId, guildId: m.guildId, mute: false, deaf: true, video: false, stream: false, watching: null };
        if (filter(v)) out.push(this.musicVoiceState(m.guildId, m.voiceChannelId));
      }
    }
    return out;
  }

  private musicVoiceState(gid: number, channelId: number | null) {
    return {
      userId: this.musicBot(),
      sessionId: MUSIC_SID(gid),
      channelId,
      guildId: gid,
      mute: false,
      deaf: true,
      video: false,
      stream: false,
      watching: null,
      bot: true,
    };
  }

  private voiceState(att: Att, v: VoiceAtt | null) {
    return {
      userId: att.uid,
      sessionId: att.sid,
      channelId: v?.channelId ?? null,
      guildId: v?.guildId ?? null,
      mute: v?.mute ?? false,
      deaf: v?.deaf ?? false,
      video: v?.video ?? false,
      stream: v?.stream ?? false,
      watching: v?.watching ?? null,
    };
  }

  private broadcastVoiceLeave(att: Att, prev: VoiceAtt) {
    const ch = this.one('SELECT * FROM channels WHERE id = ?', prev.channelId);
    const aud = ch ? this.audience(ch) : [att.uid];
    this.broadcast(aud, 'VOICE_STATE_UPDATE', { ...this.voiceState(att, null), guildId: prev.guildId, leftChannelId: prev.channelId });
    this.checkMusicListeners(prev.channelId);
  }

  /** Drops voice connections matching `match`, e.g. everyone in a deleted channel. */
  private disconnectVoice(match: (att: Att, v: VoiceAtt) => boolean) {
    for (const ws of this.live()) {
      const att = this.attOf(ws);
      if (!att?.voice || !match(att, att.voice)) continue;
      const prev = att.voice;
      att.voice = null;
      ws.serializeAttachment(att);
      this.broadcastVoiceLeave(att, prev);
      this.sendWs(ws, { op: 'voice_kicked' });
    }
  }

  private gateway(req: Request, url: URL): Response {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const origin = req.headers.get('origin');
    if (origin && new URL(origin).host !== url.host) return new Response('Forbidden', { status: 403 });
    const uid = this.sessionUser(req);
    if (!uid) return new Response('Unauthorized', { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const wasOnline = this.live(String(uid)).length > 0;
    this.ctx.acceptWebSocket(server, [String(uid)]);
    const att: Att = { uid, sid: randomToken(9), idle: false, voice: null };
    server.serializeAttachment(att);
    this.sendWs(server, { op: 'ready', d: this.buildReady(uid, att.sid) });
    if (!wasOnline) this.broadcastPresence(uid);
    return new Response(null, { status: 101, webSocket: client });
  }

  private buildReady(uid: number, sid: string) {
    const guildIds = this.all('SELECT guild_id FROM members WHERE user_id = ? ORDER BY joined_at', uid).map((r) => r.guild_id);
    const privateChannels = this.all(
      'SELECT c.* FROM channels c JOIN dm_members d ON d.channel_id = c.id WHERE d.user_id = ? AND d.hidden = 0',
      uid,
    ).map((c) => this.chan(c));
    const allDmIds = new Set(this.all('SELECT channel_id FROM dm_members WHERE user_id = ?', uid).map((r) => r.channel_id));
    const related = this.relatedUserIds(uid);
    const users = this.usersByIds([uid, ...related]);
    const presences: Record<number, string> = {};
    for (const u of users) if (u.id !== uid) presences[u.id] = this.presence(u.id, false, u);
    presences[uid] = this.presence(uid, true);
    const guildSet = new Set(guildIds);
    return {
      sessionId: sid,
      user: this.selfUser(uid),
      users: users.map((u) => this.pub(u)),
      guilds: guildIds.map((g) => this.buildGuild(g)),
      privateChannels,
      relationships: this.all('SELECT target_id, type FROM relationships WHERE user_id = ?', uid).map((r) => ({
        userId: r.target_id,
        type: r.type,
      })),
      readStates: this.all('SELECT channel_id, last_read_id, mentions FROM read_states WHERE user_id = ?', uid).map((r) => ({
        channelId: r.channel_id,
        lastReadId: r.last_read_id,
        mentions: r.mentions,
      })),
      presences,
      voiceStates: this.voiceStates((v) => (v.guildId != null ? guildSet.has(v.guildId) : allDmIds.has(v.channelId))),
      music: guildIds.map((g) => this.musicPayload(g)).filter((m) => m.track),
    };
  }

  private sendGuildCreate(uid: number, gid: number) {
    const guild = this.buildGuild(gid);
    const users = this.usersByIds(guild.members.map((m) => m.userId));
    const presences: Record<number, string> = {};
    for (const u of users) presences[u.id] = this.presence(u.id, u.id === uid, u);
    this.broadcast([uid], 'GUILD_CREATE', {
      guild,
      users: users.map((u) => this.pub(u)),
      presences,
      voiceStates: this.voiceStates((v) => v.guildId === gid),
      music: this.musicPayload(gid),
    });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const att = this.attOf(ws);
    if (!att || !msg || typeof msg !== 'object') return;
    try {
      switch (msg.op) {
        case 'typing':
          return this.onTyping(att, toId(msg.channelId));
        case 'idle':
          return this.onIdle(ws, att, !!msg.idle);
        case 'voice':
          return this.onVoice(ws, att, msg);
        case 'rtc':
          return this.onRtc(att, msg);
      }
    } catch (e) {
      if (e instanceof HttpError) this.sendWs(ws, { op: 'error', message: e.message });
      else console.error(e);
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.onSocketGone(ws, code);
  }

  async webSocketError(ws: WebSocket) {
    this.onSocketGone(ws, 1011);
  }

  private onSocketGone(ws: WebSocket, code: number) {
    const att = this.attOf(ws);
    try {
      ws.close(code >= 3000 && code < 5000 ? code : 1000, 'bye');
    } catch {
      // already closed
    }
    if (!att) return;
    this.closingSid = att.sid;
    try {
      if (att.voice) this.broadcastVoiceLeave(att, att.voice);
      if (!this.live(String(att.uid)).length) this.broadcastPresence(att.uid);
    } finally {
      this.closingSid = null;
    }
  }

  private onTyping(att: Att, channelId: number) {
    const ch = this.channelFor(att.uid, channelId);
    this.broadcast(
      this.audience(ch).filter((u) => u !== att.uid),
      'TYPING_START',
      { channelId, userId: att.uid },
    );
  }

  private onIdle(ws: WebSocket, att: Att, idle: boolean) {
    if (att.idle === idle) return;
    const before = this.presence(att.uid);
    att.idle = idle;
    ws.serializeAttachment(att);
    if (this.presence(att.uid) !== before) this.broadcastPresence(att.uid);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onVoice(ws: WebSocket, att: Att, msg: any) {
    const prev = att.voice;
    if (msg.channelId == null) {
      if (!prev) return;
      att.voice = null;
      ws.serializeAttachment(att);
      this.broadcastVoiceLeave(att, prev);
      return;
    }
    const channelId = toId(msg.channelId);
    const ch = this.channelFor(att.uid, channelId);
    if (ch.guild_id != null && ch.type !== 'voice') throw new HttpError(400, 'Esse canal não é de voz.');
    const joining = !prev || prev.channelId !== channelId;
    if (joining) {
      // One voice connection per user: joining here drops the other tabs/devices.
      this.disconnectVoice((a) => a.uid === att.uid && a.sid !== att.sid);
    }
    const othersInChannel = this.voiceStates((v) => v.channelId === channelId).filter((v) => v.userId !== att.uid).length;
    att.voice = {
      channelId,
      guildId: ch.guild_id,
      mute: !!msg.mute,
      deaf: !!msg.deaf,
      video: !!msg.video,
      stream: !!msg.stream,
      watching: typeof msg.watching === 'string' && msg.watching !== att.sid ? msg.watching.slice(0, 64) : null,
    };
    ws.serializeAttachment(att);
    if (prev && prev.channelId !== channelId) this.broadcastVoiceLeave(att, prev);
    this.broadcast(this.audience(ch), 'VOICE_STATE_UPDATE', this.voiceState(att, att.voice));
    if (ch.guild_id == null && joining && othersInChannel === 0) this.createMessage(ch, att.uid, { type: 'call' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onRtc(att: Att, msg: any) {
    if (!att.voice || typeof msg.to !== 'string') return;
    for (const ws of this.live()) {
      const target = this.attOf(ws);
      if (!target || target.sid !== msg.to) continue;
      if (target.voice?.channelId !== att.voice.channelId) return;
      this.sendWs(ws, { op: 'rtc', from: att.sid, fromUser: att.uid, data: msg.data });
      return;
    }
  }

  // ---------------------------------------------------------------- auth & users

  private async register(c: Ctx) {
    const b = await c.body();
    const username = str(b.username, 'Nome de usuário', 2, 32).toLowerCase();
    if (!/^[a-z0-9_.]+$/.test(username)) {
      throw new HttpError(400, 'O nome de usuário só pode ter letras minúsculas, números, "_" e ".".');
    }
    const displayName = b.displayName ? str(b.displayName, 'Nome de exibição', 1, 32) : username;
    const password = typeof b.password === 'string' ? b.password : '';
    if (password.length < 6 || password.length > 128) throw new HttpError(400, 'A senha precisa ter pelo menos 6 caracteres.');
    const { hash, salt } = await hashPassword(password);
    if (this.one('SELECT 1 FROM users WHERE username = ?', username)) {
      throw new HttpError(409, 'Esse nome de usuário já está em uso.');
    }
    const id = newId();
    this.run(
      'INSERT INTO users (id, username, display_name, pass_hash, pass_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      username,
      displayName,
      hash,
      salt,
      Date.now(),
    );
    return this.startSession(c.req, id);
  }

  private async login(c: Ctx) {
    const b = await c.body();
    const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    const fails = this.loginFails.get(username);
    if (fails && fails.n >= 8 && fails.until > Date.now()) {
      throw new HttpError(429, 'Muitas tentativas. Tente de novo em alguns minutos.');
    }
    const u = this.one('SELECT * FROM users WHERE username = ?', username);
    if (!u || u.bot || !(await verifyPassword(password, u.pass_salt, u.pass_hash))) {
      const n = fails && fails.until > Date.now() ? fails.n + 1 : 1;
      this.loginFails.set(username, { n, until: Date.now() + 15 * 60_000 });
      throw new HttpError(401, 'Usuário ou senha incorretos.');
    }
    this.loginFails.delete(username);
    return this.startSession(c.req, u.id);
  }

  private logout(c: Ctx) {
    const token = parseCookies(c.req.headers.get('cookie'))[COOKIE];
    if (token) {
      this.run('DELETE FROM sessions WHERE token = ?', token);
      this.sessions.delete(token);
    }
    return json({ ok: true }, 200, { 'set-cookie': this.sessionCookie(c.req, null) });
  }

  private async updateMe(c: Ctx) {
    const b = await c.body();
    const u = this.one('SELECT * FROM users WHERE id = ?', c.uid)!;
    const next = { ...u };
    if (b.username !== undefined) {
      const username = str(b.username, 'Nome de usuário', 2, 32).toLowerCase();
      if (!/^[a-z0-9_.]+$/.test(username)) {
        throw new HttpError(400, 'O nome de usuário só pode ter letras minúsculas, números, "_" e ".".');
      }
      const taken = this.one('SELECT id FROM users WHERE username = ?', username);
      if (taken && taken.id !== c.uid) throw new HttpError(409, 'Esse nome de usuário já está em uso.');
      next.username = username;
    }
    if (b.displayName !== undefined) next.display_name = str(b.displayName, 'Nome de exibição', 1, 32);
    if (b.avatar !== undefined) next.avatar = b.avatar === null ? null : this.profileImage(b.avatar, c.uid, 'O avatar');
    if (b.banner !== undefined) next.banner = b.banner === null ? null : this.profileImage(b.banner, c.uid, 'O banner');
    if (b.bannerColor !== undefined) next.banner_color = color(b.bannerColor);
    if (b.about !== undefined) next.about = str(b.about, 'Sobre mim', 0, 190);
    if (b.customStatus !== undefined) next.custom_status = str(b.customStatus, 'Status personalizado', 0, 128);
    if (b.status !== undefined) {
      if (!['online', 'idle', 'dnd', 'invisible'].includes(b.status)) throw new HttpError(400, 'Status inválido.');
      next.status = b.status;
    }
    this.run(
      'UPDATE users SET username = ?, display_name = ?, avatar = ?, banner = ?, banner_color = ?, about = ?, custom_status = ?, status = ? WHERE id = ?',
      next.username,
      next.display_name,
      next.avatar,
      next.banner ?? null,
      next.banner_color,
      next.about,
      next.custom_status,
      next.status,
      c.uid,
    );
    this.releaseFiles([u.avatar !== next.avatar ? u.avatar : null, u.banner !== next.banner ? u.banner : null]);
    const pub = this.pub(next);
    this.broadcast(
      this.relatedUserIds(c.uid).filter((id) => id !== c.uid),
      'USER_UPDATE',
      pub,
    );
    const self = this.selfUser(c.uid);
    this.broadcast([c.uid], 'USER_UPDATE', self);
    if (next.status !== u.status) this.broadcastPresence(c.uid);
    return self;
  }

  private async changePassword(c: Ctx) {
    const b = await c.body();
    const u = this.one('SELECT * FROM users WHERE id = ?', c.uid)!;
    if (typeof b.current !== 'string' || !(await verifyPassword(b.current, u.pass_salt, u.pass_hash))) {
      throw new HttpError(400, 'A senha atual está incorreta.');
    }
    if (typeof b.next !== 'string' || b.next.length < 6 || b.next.length > 128) {
      throw new HttpError(400, 'A nova senha precisa ter pelo menos 6 caracteres.');
    }
    const { hash, salt } = await hashPassword(b.next);
    const token = parseCookies(c.req.headers.get('cookie'))[COOKIE];
    this.run('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?', hash, salt, c.uid);
    // Sign out every other device.
    this.run('DELETE FROM sessions WHERE user_id = ? AND token != ?', c.uid, token);
    for (const [t, id] of this.sessions) if (id === c.uid && t !== token) this.sessions.delete(t);
    return { ok: true };
  }

  private async upload(c: Ctx) {
    const size = Number(c.req.headers.get('content-length') ?? 0);
    if (!size) throw new HttpError(411, 'Arquivo vazio.');
    if (size > MAX_UPLOAD) throw new HttpError(413, 'O arquivo passa do limite de 25 MB.');
    let name = 'arquivo';
    try {
      name = decodeURIComponent(c.req.headers.get('x-filename') ?? 'arquivo');
    } catch {
      // keep default
    }
    name = name.replace(/[\\/\0\r\n]/g, '_').slice(0, 200) || 'arquivo';
    const mime = (c.req.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim().toLowerCase().slice(0, 100);
    const data = await c.req.arrayBuffer();
    if (data.byteLength > MAX_UPLOAD) throw new HttpError(413, 'O arquivo passa do limite de 25 MB.');
    const key = randomHex(16);
    this.tx(() => {
      for (let i = 0, idx = 0; i < data.byteLength; i += CHUNK, idx++) {
        this.run('INSERT INTO file_chunks (key, idx, data) VALUES (?, ?, ?)', key, idx, data.slice(i, i + CHUNK));
      }
      this.run(
        'INSERT INTO uploads (key, user_id, name, size, mime, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        key,
        c.uid,
        name,
        data.byteLength,
        mime,
        Date.now(),
      );
    });
    return { key, name, size: data.byteLength, mime };
  }

  private serveFile(c: Ctx): Response {
    const key = c.params.key;
    const up = /^[a-f0-9]{32}$/.test(key) ? this.one('SELECT * FROM uploads WHERE key = ?', key) : null;
    if (!up) return new Response('Not found', { status: 404 });
    const size = up.size as number;
    const mime = String(up.mime);
    const inline = INLINE.test(mime);
    const etag = `"${key}"`;
    const headers = new Headers({
      'content-type': inline ? mime : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(up.name)}`,
      'cache-control': 'public, max-age=31536000, immutable',
      'accept-ranges': 'bytes',
      etag,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
    if (c.req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });

    let start = 0;
    let end = size - 1;
    let partial = false;
    const range = c.req.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && size > 0) {
      if (range[1] === '' && range[2] !== '') {
        start = Math.max(0, size - Number(range[2]));
      } else {
        start = Number(range[1] || 0);
        if (range[2] !== '') end = Math.min(end, Number(range[2]));
      }
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
      }
      partial = true;
      headers.set('content-range', `bytes ${start}-${end}/${size}`);
    }
    headers.set('content-length', String(end - start + 1));
    if (c.req.method === 'HEAD') return new Response(null, { status: partial ? 206 : 200, headers });

    const body = new Uint8Array(end - start + 1);
    const first = Math.floor(start / CHUNK);
    const last = Math.floor(end / CHUNK);
    for (const row of this.all('SELECT idx, data FROM file_chunks WHERE key = ? AND idx BETWEEN ? AND ? ORDER BY idx', key, first, last)) {
      const chunk = new Uint8Array(row.data as ArrayBuffer);
      const chunkStart = (row.idx as number) * CHUNK;
      const from = Math.max(start, chunkStart);
      const to = Math.min(end + 1, chunkStart + chunk.byteLength);
      body.set(chunk.subarray(from - chunkStart, to - chunkStart), from - start);
    }
    return new Response(body, { status: partial ? 206 : 200, headers });
  }

  /** Deletes stored files that nothing (message, avatar, banner, server icon) points at any more. */
  private releaseFiles(keys: (string | null | undefined)[]) {
    for (const key of new Set(keys)) {
      if (!key) continue;
      const used =
        this.one('SELECT 1 FROM users WHERE avatar = ? OR banner = ?', key, key) ||
        this.one('SELECT 1 FROM guilds WHERE icon = ?', key) ||
        this.one("SELECT 1 FROM messages WHERE attachments LIKE ? ESCAPE '\\'", `%${key}%`);
      if (used) continue;
      this.run('DELETE FROM file_chunks WHERE key = ?', key);
      this.run('DELETE FROM uploads WHERE key = ?', key);
    }
  }

  /**
   * STUN is enough when both sides can reach each other directly. Behind CGNAT, corporate
   * firewalls or isolated Wi-Fi the media needs a TURN relay: Cloudflare's (TURN_KEY_ID +
   * TURN_KEY_API_TOKEN) or any other provider (TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL).
   */
  private async iceServers() {
    type Ice = { urls: string | string[]; username?: string; credential?: string };
    const servers: Ice[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
    const { TURN_KEY_ID: keyId, TURN_KEY_API_TOKEN: token, TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL } = this.env;
    if (TURN_URLS && TURN_USERNAME && TURN_CREDENTIAL) {
      servers.push({ urls: TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean), username: TURN_USERNAME, credential: TURN_CREDENTIAL });
    }
    if (keyId && token) {
      try {
        const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ ttl: 86400 }),
        });
        if (res.ok) {
          const data = await res.json<{ iceServers: Ice | Ice[] }>();
          for (const s of Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers]) {
            // Port 53 URLs tend to time out in browsers.
            const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
            if (urls.length && s.username) servers.push({ ...s, urls });
          }
        } else {
          console.error('TURN credentials failed', res.status, await res.text());
        }
      } catch (e) {
        console.error('TURN credentials failed', e);
      }
    }
    const relay = servers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.startsWith('turn')));
    return { iceServers: servers, relay };
  }

  // ---------------------------------------------------------------- friends & DMs

  private relationshipEvent(to: number, other: number, type: string) {
    const u = this.one('SELECT * FROM users WHERE id = ?', other);
    if (!u) return;
    this.broadcast([to], 'RELATIONSHIP_ADD', {
      userId: other,
      type,
      user: this.pub(u),
      status: type === 'friend' ? this.presence(other, false, u) : 'offline',
    });
  }

  private async addFriend(c: Ctx) {
    const b = await c.body();
    const username = typeof b.username === 'string' ? b.username.trim().replace(/^@/, '').toLowerCase() : '';
    const target = this.one('SELECT * FROM users WHERE username = ?', username);
    if (!target) throw new HttpError(404, 'Não encontramos ninguém com esse nome de usuário. Confira a grafia.');
    if (target.id === c.uid) throw new HttpError(400, 'Você não pode adicionar você mesmo.');
    return this.befriend(c.uid, target.id);
  }

  private befriend(uid: number, tid: number) {
    const mine = this.one('SELECT type FROM relationships WHERE user_id = ? AND target_id = ?', uid, tid);
    const theirs = this.one('SELECT type FROM relationships WHERE user_id = ? AND target_id = ?', tid, uid);
    if (mine?.type === 'friend') throw new HttpError(400, 'Vocês já são amigos.');
    if (theirs?.type === 'blocked') throw new HttpError(400, 'Não foi possível enviar o pedido de amizade.');
    if (mine?.type === 'outgoing') throw new HttpError(400, 'Você já enviou um pedido para essa pessoa.');
    const upsert = 'INSERT INTO relationships (user_id, target_id, type) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET type = excluded.type';
    if (mine?.type === 'incoming') {
      this.run(upsert, uid, tid, 'friend');
      this.run(upsert, tid, uid, 'friend');
      this.relationshipEvent(uid, tid, 'friend');
      this.relationshipEvent(tid, uid, 'friend');
      return { type: 'friend' };
    }
    this.run(upsert, uid, tid, 'outgoing');
    this.run(upsert, tid, uid, 'incoming');
    this.relationshipEvent(uid, tid, 'outgoing');
    this.relationshipEvent(tid, uid, 'incoming');
    return { type: 'outgoing' };
  }

  private async putRelationship(c: Ctx) {
    const tid = toId(c.params.userId);
    const b = await c.body();
    if (tid === c.uid || !this.one('SELECT 1 FROM users WHERE id = ?', tid)) throw new HttpError(404, 'Usuário não encontrado.');
    if (b.type === 'friend') return this.befriend(c.uid, tid);
    if (b.type !== 'blocked') throw new HttpError(400, 'Tipo inválido.');
    this.run(
      'INSERT INTO relationships (user_id, target_id, type) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET type = excluded.type',
      c.uid,
      tid,
      'blocked',
    );
    const theirs = this.one('SELECT type FROM relationships WHERE user_id = ? AND target_id = ?', tid, c.uid);
    if (theirs && theirs.type !== 'blocked') {
      this.run('DELETE FROM relationships WHERE user_id = ? AND target_id = ?', tid, c.uid);
      this.broadcast([tid], 'RELATIONSHIP_REMOVE', { userId: c.uid });
    }
    this.relationshipEvent(c.uid, tid, 'blocked');
    return { type: 'blocked' };
  }

  private deleteRelationship(c: Ctx) {
    const tid = toId(c.params.userId);
    this.run('DELETE FROM relationships WHERE user_id = ? AND target_id = ?', c.uid, tid);
    this.broadcast([c.uid], 'RELATIONSHIP_REMOVE', { userId: tid });
    const theirs = this.one('SELECT type FROM relationships WHERE user_id = ? AND target_id = ?', tid, c.uid);
    if (theirs && theirs.type !== 'blocked') {
      this.run('DELETE FROM relationships WHERE user_id = ? AND target_id = ?', tid, c.uid);
      this.broadcast([tid], 'RELATIONSHIP_REMOVE', { userId: c.uid });
    }
    return { ok: true };
  }

  private channelCreateFor(uid: number, ch: Row) {
    const channel = this.chan(ch);
    const users = this.usersByIds(channel.recipients as number[]);
    const presences: Record<number, string> = {};
    for (const u of users) presences[u.id] = this.presence(u.id, u.id === uid, u);
    this.broadcast([uid], 'CHANNEL_CREATE', { channel, users: users.map((u) => this.pub(u)), presences });
  }

  private async openDm(c: Ctx) {
    const b = await c.body();
    const ids = [...new Set((Array.isArray(b.recipients) ? b.recipients : []).map(toId))].filter((id) => id !== c.uid);
    if (!ids.length) throw new HttpError(400, 'Escolha pelo menos uma pessoa.');
    if (ids.length > 9) throw new HttpError(400, 'Um grupo pode ter no máximo 10 pessoas.');
    for (const id of ids) if (!this.one('SELECT 1 FROM users WHERE id = ?', id)) throw new HttpError(404, 'Usuário não encontrado.');

    if (ids.length === 1) {
      const existing = this.one(
        `SELECT c.* FROM channels c
         JOIN dm_members a ON a.channel_id = c.id AND a.user_id = ?
         JOIN dm_members b ON b.channel_id = c.id AND b.user_id = ?
         WHERE c.type = 'dm'`,
        c.uid,
        ids[0],
      );
      if (existing) {
        this.run('UPDATE dm_members SET hidden = 0 WHERE channel_id = ? AND user_id = ?', existing.id, c.uid);
        this.channelCreateFor(c.uid, existing);
        return this.chan(existing);
      }
      const id = newId();
      this.tx(() => {
        this.run("INSERT INTO channels (id, guild_id, type) VALUES (?, NULL, 'dm')", id);
        this.run('INSERT INTO dm_members (channel_id, user_id, hidden) VALUES (?, ?, 0)', id, c.uid);
        // The other side only sees the conversation once a message arrives.
        this.run('INSERT INTO dm_members (channel_id, user_id, hidden) VALUES (?, ?, 1)', id, ids[0]);
      });
      const ch = this.one('SELECT * FROM channels WHERE id = ?', id)!;
      this.channelCreateFor(c.uid, ch);
      return this.chan(ch);
    }

    for (const id of ids) {
      const rel = this.one('SELECT type FROM relationships WHERE user_id = ? AND target_id = ?', c.uid, id);
      if (rel?.type !== 'friend') throw new HttpError(400, 'Você só pode criar grupos com seus amigos.');
    }
    const id = newId();
    this.tx(() => {
      this.run("INSERT INTO channels (id, guild_id, type, owner_id) VALUES (?, NULL, 'group_dm', ?)", id, c.uid);
      for (const member of [c.uid, ...ids]) this.run('INSERT INTO dm_members (channel_id, user_id, hidden) VALUES (?, ?, 0)', id, member);
    });
    const ch = this.one('SELECT * FROM channels WHERE id = ?', id)!;
    for (const member of [c.uid, ...ids]) this.channelCreateFor(member, ch);
    return this.chan(ch);
  }

  // ---------------------------------------------------------------- guilds

  private async createGuild(c: Ctx) {
    const b = await c.body();
    const name = str(b.name, 'Nome do servidor', 1, 100);
    const icon = b.icon ? this.ownedUpload(b.icon, c.uid, true) : null;
    const gid = newId();
    const [catText, general, catVoice, voice] = [newId(), newId(), newId(), newId()];
    const now = Date.now();
    this.tx(() => {
      this.run(
        'INSERT INTO guilds (id, name, icon, owner_id, system_channel_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        gid,
        name,
        icon,
        c.uid,
        general,
        now,
      );
      this.run('INSERT INTO members (guild_id, user_id, joined_at) VALUES (?, ?, ?)', gid, c.uid, now);
      const ins = 'INSERT INTO channels (id, guild_id, type, name, parent_id, position) VALUES (?, ?, ?, ?, ?, ?)';
      this.run(ins, catText, gid, 'category', 'Canais de texto', null, 0);
      this.run(ins, general, gid, 'text', 'geral', catText, 0);
      this.run(ins, catVoice, gid, 'category', 'Canais de voz', null, 1);
      this.run(ins, voice, gid, 'voice', 'Geral', catVoice, 0);
    });
    this.sendGuildCreate(c.uid, gid);
    return { id: gid, systemChannelId: general };
  }

  private async updateGuild(c: Ctx) {
    const gid = toId(c.params.guildId);
    const g = this.adminGuild(c.uid, gid);
    const b = await c.body();
    const name = b.name !== undefined ? str(b.name, 'Nome do servidor', 1, 100) : g.name;
    const icon = b.icon === undefined ? g.icon : b.icon === null ? null : this.ownedUpload(b.icon, c.uid, true);
    let ownerId = g.owner_id;
    if (b.ownerId !== undefined) {
      if (g.owner_id !== c.uid) throw new HttpError(403, 'Só o dono pode transferir a posse do servidor.');
      ownerId = toId(b.ownerId);
      if (!this.isMember(gid, ownerId)) throw new HttpError(400, 'Essa pessoa não está no servidor.');
    }
    let systemChannelId = g.system_channel_id;
    if (b.systemChannelId !== undefined) {
      systemChannelId = b.systemChannelId === null ? null : toId(b.systemChannelId);
      if (systemChannelId && !this.one("SELECT 1 FROM channels WHERE id = ? AND guild_id = ? AND type = 'text'", systemChannelId, gid)) {
        throw new HttpError(400, 'Canal inválido.');
      }
    }
    this.run('UPDATE guilds SET name = ?, icon = ?, owner_id = ?, system_channel_id = ? WHERE id = ?', name, icon, ownerId, systemChannelId, gid);
    if (g.icon !== icon) this.releaseFiles([g.icon]);
    const out = { id: gid, name, icon, ownerId, systemChannelId };
    this.broadcast(this.guildMembers(gid), 'GUILD_UPDATE', out);
    return out;
  }

  private purgeChannelMessages(channelIds: number[]) {
    const keys: string[] = [];
    for (const id of channelIds) {
      for (const m of this.all("SELECT attachments FROM messages WHERE channel_id = ? AND attachments != '[]'", id)) {
        for (const a of JSON.parse(m.attachments) as Attachment[]) keys.push(a.key);
      }
      this.run('DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id = ?)', id);
      this.run('DELETE FROM messages WHERE channel_id = ?', id);
      this.run('DELETE FROM read_states WHERE channel_id = ?', id);
    }
    this.releaseFiles(keys);
  }

  private deleteGuild(c: Ctx) {
    const gid = toId(c.params.guildId);
    const g = this.guildFor(c.uid, gid);
    if (g.owner_id !== c.uid) throw new HttpError(403, 'Só o dono pode excluir o servidor.');
    const members = this.guildMembers(gid);
    this.disconnectVoice((_, v) => v.guildId === gid);
    this.music.delete(gid);
    this.run('DELETE FROM music WHERE guild_id = ?', gid);
    this.tx(() => {
      this.purgeChannelMessages(this.all('SELECT id FROM channels WHERE guild_id = ?', gid).map((r) => r.id));
      for (const t of ['channels', 'members', 'member_roles', 'roles', 'invites', 'bans']) this.run(`DELETE FROM ${t} WHERE guild_id = ?`, gid);
      this.run('DELETE FROM guilds WHERE id = ?', gid);
      this.releaseFiles([g.icon]);
    });
    this.broadcast(members, 'GUILD_DELETE', { id: gid });
    return { ok: true };
  }

  private async ackGuild(c: Ctx) {
    const gid = toId(c.params.guildId);
    this.guildFor(c.uid, gid);
    const states = this.all('SELECT id, last_message_id FROM channels WHERE guild_id = ? AND last_message_id IS NOT NULL', gid).map((ch) => {
      this.upsertRead(c.uid, ch.id, ch.last_message_id);
      return { channelId: ch.id, lastReadId: ch.last_message_id, mentions: 0 };
    });
    this.broadcast([c.uid], 'READ_STATE_UPDATE', states);
    return { ok: true };
  }

  private removeMember(gid: number, uid: number) {
    if (uid === this.musicBot(false)) this.stopMusic(gid);
    this.disconnectVoice((a, v) => a.uid === uid && v.guildId === gid);
    this.tx(() => {
      this.run('DELETE FROM members WHERE guild_id = ? AND user_id = ?', gid, uid);
      this.run('DELETE FROM member_roles WHERE guild_id = ? AND user_id = ?', gid, uid);
      this.run('DELETE FROM read_states WHERE user_id = ? AND channel_id IN (SELECT id FROM channels WHERE guild_id = ?)', uid, gid);
    });
    this.broadcast([uid], 'GUILD_DELETE', { id: gid });
    this.broadcast(this.guildMembers(gid), 'GUILD_MEMBER_REMOVE', { guildId: gid, userId: uid });
  }

  private leaveGuild(c: Ctx) {
    const gid = toId(c.params.guildId);
    const g = this.guildFor(c.uid, gid);
    if (g.owner_id === c.uid) throw new HttpError(400, 'O dono não pode sair. Transfira a posse ou exclua o servidor.');
    this.removeMember(gid, c.uid);
    return { ok: true };
  }

  private moderationTarget(c: Ctx): { gid: number; tid: number; g: Row } {
    const gid = toId(c.params.guildId);
    const g = this.adminGuild(c.uid, gid);
    const tid = toId(c.params.userId);
    if (tid === c.uid) throw new HttpError(400, 'Você não pode fazer isso com você mesmo.');
    if (tid === g.owner_id) throw new HttpError(403, 'O dono do servidor não pode ser removido.');
    if (this.isAdmin(gid, tid) && g.owner_id !== c.uid) throw new HttpError(403, 'Só o dono pode remover administradores.');
    return { gid, tid, g };
  }

  private kick(c: Ctx) {
    const { gid, tid } = this.moderationTarget(c);
    if (!this.isMember(gid, tid)) throw new HttpError(404, 'Membro não encontrado.');
    this.removeMember(gid, tid);
    return { ok: true };
  }

  private ban(c: Ctx) {
    const { gid, tid } = this.moderationTarget(c);
    this.run('INSERT OR IGNORE INTO bans (guild_id, user_id, created_at) VALUES (?, ?, ?)', gid, tid, Date.now());
    if (this.isMember(gid, tid)) this.removeMember(gid, tid);
    return { ok: true };
  }

  private unban(c: Ctx) {
    const gid = toId(c.params.guildId);
    this.adminGuild(c.uid, gid);
    this.run('DELETE FROM bans WHERE guild_id = ? AND user_id = ?', gid, toId(c.params.userId));
    return { ok: true };
  }

  private listBans(c: Ctx) {
    const gid = toId(c.params.guildId);
    this.adminGuild(c.uid, gid);
    const bans = this.all('SELECT user_id, created_at FROM bans WHERE guild_id = ? ORDER BY created_at DESC', gid);
    const users = new Map(this.usersByIds(bans.map((b) => b.user_id)).map((u) => [u.id, u]));
    return bans.filter((b) => users.has(b.user_id)).map((b) => ({ user: this.pub(users.get(b.user_id)!), createdAt: b.created_at }));
  }

  private async updateMember(c: Ctx) {
    const gid = toId(c.params.guildId);
    this.guildFor(c.uid, gid);
    const tid = c.params.userId === '@me' ? c.uid : toId(c.params.userId);
    if (!this.isMember(gid, tid)) throw new HttpError(404, 'Membro não encontrado.');
    const b = await c.body();
    const admin = this.isAdmin(gid, c.uid);
    if (b.nick !== undefined) {
      if (tid !== c.uid && !admin) throw new HttpError(403, 'Você não tem permissão para fazer isso.');
      const nick = b.nick === null ? '' : str(b.nick, 'Apelido', 0, 32);
      this.run('UPDATE members SET nick = ? WHERE guild_id = ? AND user_id = ?', nick || null, gid, tid);
    }
    if (b.roles !== undefined) {
      if (!admin) throw new HttpError(403, 'Você não tem permissão para fazer isso.');
      const roles = [...new Set((Array.isArray(b.roles) ? b.roles : []).map(toId))];
      for (const r of roles) if (!this.one('SELECT 1 FROM roles WHERE id = ? AND guild_id = ?', r, gid)) throw new HttpError(400, 'Cargo inválido.');
      this.tx(() => {
        this.run('DELETE FROM member_roles WHERE guild_id = ? AND user_id = ?', gid, tid);
        for (const r of roles) this.run('INSERT INTO member_roles (guild_id, user_id, role_id) VALUES (?, ?, ?)', gid, tid, r);
      });
    }
    const member = this.member(gid, tid);
    this.broadcast(this.guildMembers(gid), 'GUILD_MEMBER_UPDATE', member);
    return member;
  }

  // ---------------------------------------------------------------- channels

  private channelName(type: string, raw: unknown): string {
    const name = str(raw, 'Nome do canal', 1, 100);
    if (type !== 'text') return name;
    const slug = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_-]/gu, '')
      .replace(/-+/g, '-');
    if (!slug) throw new HttpError(400, 'Nome do canal inválido.');
    return slug;
  }

  private async createChannel(c: Ctx) {
    const gid = toId(c.params.guildId);
    this.adminGuild(c.uid, gid);
    const b = await c.body();
    const type = b.type as string;
    if (!['text', 'voice', 'category'].includes(type)) throw new HttpError(400, 'Tipo de canal inválido.');
    const name = this.channelName(type, b.name);
    let parentId: number | null = null;
    if (type !== 'category' && b.parentId != null) {
      parentId = toId(b.parentId);
      if (!this.one("SELECT 1 FROM channels WHERE id = ? AND guild_id = ? AND type = 'category'", parentId, gid)) {
        throw new HttpError(400, 'Categoria inválida.');
      }
    }
    const pos = this.one(
      'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM channels WHERE guild_id = ? AND parent_id IS ?',
      gid,
      parentId,
    )!.p;
    const id = newId();
    this.run(
      'INSERT INTO channels (id, guild_id, type, name, topic, parent_id, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      gid,
      type,
      name,
      typeof b.topic === 'string' ? b.topic.slice(0, 1024) : '',
      parentId,
      pos,
    );
    const channel = this.chan(this.one('SELECT * FROM channels WHERE id = ?', id)!);
    this.broadcast(this.guildMembers(gid), 'CHANNEL_CREATE', { channel });
    return channel;
  }

  private async reorderChannels(c: Ctx) {
    const gid = toId(c.params.guildId);
    this.adminGuild(c.uid, gid);
    const b = await c.body<{ channels?: { id: unknown; position: unknown; parentId?: unknown }[] }>();
    const list = Array.isArray(b.channels) ? b.channels : [];
    const changed: Row[] = [];
    this.tx(() => {
      for (const item of list) {
        const id = toId(item.id);
        const ch = this.one('SELECT * FROM channels WHERE id = ? AND guild_id = ?', id, gid);
        if (!ch) continue;
        let parentId = ch.parent_id;
        if (item.parentId !== undefined && ch.type !== 'category') {
          parentId = item.parentId === null ? null : toId(item.parentId);
          if (parentId && !this.one("SELECT 1 FROM channels WHERE id = ? AND guild_id = ? AND type = 'category'", parentId, gid)) continue;
        }
        this.run('UPDATE channels SET position = ?, parent_id = ? WHERE id = ?', Number(item.position) || 0, parentId, id);
        changed.push(this.one('SELECT * FROM channels WHERE id = ?', id)!);
      }
    });
    const members = this.guildMembers(gid);
    for (const ch of changed) this.broadcast(members, 'CHANNEL_UPDATE', { channel: this.chan(ch) });
    return { ok: true };
  }

  private async updateChannel(c: Ctx) {
    const ch = this.channelFor(c.uid, toId(c.params.channelId));
    const b = await c.body();
    if (ch.guild_id == null) {
      if (ch.type !== 'group_dm') throw new HttpError(400, 'Não é possível editar essa conversa.');
      const name = b.name ? str(b.name, 'Nome do grupo', 0, 100) : '';
      this.run('UPDATE channels SET name = ? WHERE id = ?', name, ch.id);
    } else {
      this.adminGuild(c.uid, ch.guild_id);
      const name = b.name !== undefined ? this.channelName(ch.type, b.name) : ch.name;
      const topic = b.topic !== undefined ? str(b.topic ?? '', 'Tópico', 0, 1024) : ch.topic;
      this.run('UPDATE channels SET name = ?, topic = ? WHERE id = ?', name, topic, ch.id);
    }
    const channel = this.chan(this.one('SELECT * FROM channels WHERE id = ?', ch.id)!);
    this.broadcast(this.audience(ch), 'CHANNEL_UPDATE', { channel });
    return channel;
  }

  private deleteChannel(c: Ctx) {
    const ch = this.channelFor(c.uid, toId(c.params.channelId));
    if (ch.type === 'dm') {
      this.run('UPDATE dm_members SET hidden = 1 WHERE channel_id = ? AND user_id = ?', ch.id, c.uid);
      this.broadcast([c.uid], 'CHANNEL_DELETE', { id: ch.id, guildId: null });
      return { ok: true };
    }
    if (ch.type === 'group_dm') {
      this.disconnectVoice((a, v) => a.uid === c.uid && v.channelId === ch.id);
      this.run('DELETE FROM dm_members WHERE channel_id = ? AND user_id = ?', ch.id, c.uid);
      this.run('DELETE FROM read_states WHERE channel_id = ? AND user_id = ?', ch.id, c.uid);
      this.broadcast([c.uid], 'CHANNEL_DELETE', { id: ch.id, guildId: null });
      const rest = this.audience(ch);
      if (!rest.length) {
        this.tx(() => {
          this.purgeChannelMessages([ch.id]);
          this.run('DELETE FROM channels WHERE id = ?', ch.id);
        });
      } else {
        if (ch.owner_id === c.uid) this.run('UPDATE channels SET owner_id = ? WHERE id = ?', rest[0], ch.id);
        this.broadcast(rest, 'CHANNEL_UPDATE', { channel: this.chan(this.one('SELECT * FROM channels WHERE id = ?', ch.id)!) });
      }
      return { ok: true };
    }
    const gid = ch.guild_id as number;
    this.adminGuild(c.uid, gid);
    this.disconnectVoice((_, v) => v.channelId === ch.id);
    const members = this.guildMembers(gid);
    const orphans = ch.type === 'category' ? this.all('SELECT id FROM channels WHERE parent_id = ?', ch.id).map((r) => r.id) : [];
    this.tx(() => {
      this.purgeChannelMessages([ch.id]);
      this.run('DELETE FROM channels WHERE id = ?', ch.id);
      this.run('UPDATE channels SET parent_id = NULL WHERE parent_id = ?', ch.id);
      const g = this.one('SELECT system_channel_id FROM guilds WHERE id = ?', gid);
      if (g?.system_channel_id === ch.id) {
        const next = this.one("SELECT id FROM channels WHERE guild_id = ? AND type = 'text' ORDER BY position, id", gid);
        this.run('UPDATE guilds SET system_channel_id = ? WHERE id = ?', next?.id ?? null, gid);
      }
    });
    this.broadcast(members, 'CHANNEL_DELETE', { id: ch.id, guildId: gid });
    for (const id of orphans) this.broadcast(members, 'CHANNEL_UPDATE', { channel: this.chan(this.one('SELECT * FROM channels WHERE id = ?', id)!) });
    const g = this.one('SELECT * FROM guilds WHERE id = ?', gid)!;
    this.broadcast(members, 'GUILD_UPDATE', { id: gid, name: g.name, icon: g.icon, ownerId: g.owner_id, systemChannelId: g.system_channel_id });
    return { ok: true };
  }

  // ---------------------------------------------------------------- roles & invites

  private async createRole(c: Ctx) {
    const gid = toId(c.params.guildId);
    this.adminGuild(c.uid, gid);
    const b = await c.body();
    const name = b.name ? str(b.name, 'Nome do cargo', 1, 100) : 'novo cargo';
    const pos = this.one('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM roles WHERE guild_id = ?', gid)!.p;
    const id = newId();
    this.run(
      'INSERT INTO roles (id, guild_id, name, color, position, hoist, admin) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      gid,
      name,
      color(b.color),
      pos,
      b.hoist ? 1 : 0,
      b.admin ? 1 : 0,
    );
    const role = this.role(this.one('SELECT * FROM roles WHERE id = ?', id)!);
    this.broadcast(this.guildMembers(gid), 'GUILD_ROLE_CREATE', role);
    return role;
  }

  private async updateRole(c: Ctx) {
    const gid = toId(c.params.guildId);
    this.adminGuild(c.uid, gid);
    const r = this.one('SELECT * FROM roles WHERE id = ? AND guild_id = ?', toId(c.params.roleId), gid);
    if (!r) throw new HttpError(404, 'Cargo não encontrado.');
    const b = await c.body();
    this.run(
      'UPDATE roles SET name = ?, color = ?, hoist = ?, admin = ?, position = ? WHERE id = ?',
      b.name !== undefined ? str(b.name, 'Nome do cargo', 1, 100) : r.name,
      b.color !== undefined ? color(b.color) : r.color,
      b.hoist !== undefined ? (b.hoist ? 1 : 0) : r.hoist,
      b.admin !== undefined ? (b.admin ? 1 : 0) : r.admin,
      b.position !== undefined ? Number(b.position) || 0 : r.position,
      r.id,
    );
    const role = this.role(this.one('SELECT * FROM roles WHERE id = ?', r.id)!);
    this.broadcast(this.guildMembers(gid), 'GUILD_ROLE_UPDATE', role);
    return role;
  }

  private deleteRole(c: Ctx) {
    const gid = toId(c.params.guildId);
    this.adminGuild(c.uid, gid);
    const roleId = toId(c.params.roleId);
    this.tx(() => {
      this.run('DELETE FROM roles WHERE id = ? AND guild_id = ?', roleId, gid);
      this.run('DELETE FROM member_roles WHERE role_id = ?', roleId);
    });
    this.broadcast(this.guildMembers(gid), 'GUILD_ROLE_DELETE', { guildId: gid, roleId });
    return { ok: true };
  }

  private listInvites(c: Ctx) {
    const gid = toId(c.params.guildId);
    this.adminGuild(c.uid, gid);
    const invites = this.all('SELECT * FROM invites WHERE guild_id = ? ORDER BY created_at DESC', gid);
    const users = new Map(this.usersByIds(invites.map((i) => i.inviter_id)).map((u) => [u.id, u]));
    return invites.map((i) => ({
      code: i.code,
      uses: i.uses,
      createdAt: i.created_at,
      inviter: users.has(i.inviter_id) ? this.pub(users.get(i.inviter_id)!) : null,
    }));
  }

  private createInvite(c: Ctx) {
    const gid = toId(c.params.guildId);
    this.guildFor(c.uid, gid);
    // Reuse the member's own invite so links stay stable, like Discord's default invite.
    const existing = this.one('SELECT code FROM invites WHERE guild_id = ? AND inviter_id = ? ORDER BY created_at LIMIT 1', gid, c.uid);
    if (existing) return { code: existing.code };
    const code = randomCode(8);
    this.run('INSERT INTO invites (code, guild_id, inviter_id, created_at) VALUES (?, ?, ?, ?)', code, gid, c.uid, Date.now());
    return { code };
  }

  private inviteInfo(c: Ctx) {
    const inv = this.one('SELECT * FROM invites WHERE code = ?', c.params.code);
    if (!inv) throw new HttpError(404, 'Este convite é inválido ou expirou.');
    const g = this.one('SELECT * FROM guilds WHERE id = ?', inv.guild_id);
    if (!g) throw new HttpError(404, 'Este convite é inválido ou expirou.');
    const members = this.guildMembers(g.id);
    const inviter = this.one('SELECT * FROM users WHERE id = ?', inv.inviter_id);
    return {
      code: inv.code,
      guild: {
        id: g.id,
        name: g.name,
        icon: g.icon,
        memberCount: members.length,
        onlineCount: members.filter((m) => this.presence(m) !== 'offline').length,
      },
      inviter: inviter ? this.pub(inviter) : null,
    };
  }

  private joinInvite(c: Ctx) {
    const inv = this.one('SELECT * FROM invites WHERE code = ?', c.params.code);
    if (!inv) throw new HttpError(404, 'Este convite é inválido ou expirou.');
    const gid = inv.guild_id as number;
    if (this.one('SELECT 1 FROM bans WHERE guild_id = ? AND user_id = ?', gid, c.uid)) throw new HttpError(403, 'Você foi banido deste servidor.');
    if (this.isMember(gid, c.uid)) return { guildId: gid };
    const others = this.guildMembers(gid);
    this.tx(() => {
      this.run('INSERT INTO members (guild_id, user_id, joined_at) VALUES (?, ?, ?)', gid, c.uid, Date.now());
      this.run('UPDATE invites SET uses = uses + 1 WHERE code = ?', inv.code);
      for (const ch of this.all('SELECT id, last_message_id FROM channels WHERE guild_id = ? AND last_message_id IS NOT NULL', gid)) {
        this.upsertRead(c.uid, ch.id, ch.last_message_id);
      }
    });
    const u = this.one('SELECT * FROM users WHERE id = ?', c.uid)!;
    this.broadcast(others, 'GUILD_MEMBER_ADD', { member: this.member(gid, c.uid), user: this.pub(u), status: this.presence(c.uid, false, u) });
    this.sendGuildCreate(c.uid, gid);
    const g = this.one('SELECT system_channel_id FROM guilds WHERE id = ?', gid);
    const sys = g?.system_channel_id ? this.one('SELECT * FROM channels WHERE id = ?', g.system_channel_id) : null;
    if (sys) this.createMessage(sys, c.uid, { type: 'join' });
    return { guildId: gid };
  }

  private deleteInvite(c: Ctx) {
    const inv = this.one('SELECT * FROM invites WHERE code = ?', c.params.code);
    if (!inv) throw new HttpError(404, 'Convite não encontrado.');
    if (inv.inviter_id !== c.uid) this.adminGuild(c.uid, inv.guild_id);
    this.run('DELETE FROM invites WHERE code = ?', inv.code);
    return { ok: true };
  }

  // ---------------------------------------------------------------- messages

  private upsertRead(uid: number, channelId: number, lastReadId: number) {
    this.run(
      `INSERT INTO read_states (user_id, channel_id, last_read_id, mentions) VALUES (?, ?, ?, 0)
       ON CONFLICT DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id), mentions = 0`,
      uid,
      channelId,
      lastReadId,
    );
  }

  private createMessage(
    ch: Row,
    authorId: number,
    opts: { type?: string; content?: string; replyTo?: number | null; attachments?: Attachment[]; nonce?: unknown; embeds?: Embed[] },
  ) {
    const type = opts.type ?? 'default';
    const content = opts.content ?? '';
    const audience = this.audience(ch);
    const inAudience = new Set(audience);
    const mentions = new Set(
      [...content.matchAll(/<@(\d+)>/g)].map((m) => Number(m[1])).filter((id) => inAudience.has(id) && id !== authorId),
    );
    let replyTo = opts.replyTo ?? null;
    if (replyTo != null) {
      const ref = this.one('SELECT author_id FROM messages WHERE id = ? AND channel_id = ?', replyTo, ch.id);
      if (!ref) replyTo = null;
      else if (type === 'default' && ref.author_id !== authorId && inAudience.has(ref.author_id)) mentions.add(ref.author_id);
    }
    const everyone = ch.guild_id != null && type === 'default' && /@(everyone|here)\b/.test(content);
    const id = newId();

    const hiddenFor: number[] = [];
    this.tx(() => {
      this.run(
        `INSERT INTO messages (id, channel_id, author_id, type, content, reply_to, mentions, mention_everyone, attachments, embeds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        ch.id,
        authorId,
        type,
        content,
        replyTo,
        JSON.stringify([...mentions]),
        everyone ? 1 : 0,
        JSON.stringify(opts.attachments ?? []),
        JSON.stringify(opts.embeds ?? []),
      );
      this.run('UPDATE channels SET last_message_id = ? WHERE id = ?', id, ch.id);
      this.upsertRead(authorId, ch.id, id);
      for (const uid of audience) {
        if (uid === authorId) continue;
        const notify = ch.guild_id == null ? type !== 'pin' : everyone || mentions.has(uid);
        if (!notify) continue;
        this.run(
          `INSERT INTO read_states (user_id, channel_id, last_read_id, mentions) VALUES (?, ?, 0, 1)
           ON CONFLICT DO UPDATE SET mentions = mentions + 1`,
          uid,
          ch.id,
        );
      }
      if (ch.guild_id == null) {
        hiddenFor.push(...this.all('SELECT user_id FROM dm_members WHERE channel_id = ? AND hidden = 1', ch.id).map((r) => r.user_id));
        this.run('UPDATE dm_members SET hidden = 0 WHERE channel_id = ?', ch.id);
      }
    });

    const fresh = this.one('SELECT * FROM channels WHERE id = ?', ch.id)!;
    for (const uid of hiddenFor) this.channelCreateFor(uid, fresh);
    const msg = this.message(id)!;
    this.broadcast(audience, 'MESSAGE_CREATE', { ...msg, nonce: opts.nonce ?? null });
    if (!opts.embeds) this.scheduleUnfurl(id, content);
    return msg;
  }

  private scheduleUnfurl(id: number, content: string) {
    const withoutCode = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    const urls = [...new Set([...withoutCode.matchAll(/(?<!<)https?:\/\/[^\s<>]+[^\s<>.,:;"')\]!?]/g)].map((m) => m[0]))].slice(0, 3);
    if (!urls.length) return;
    this.ctx.waitUntil(
      (async () => {
        const embeds = (await Promise.all(urls.map((u) => unfurl(u).catch(() => null)))).filter((e): e is Embed => !!e);
        if (!embeds.length) return;
        const row = this.one('SELECT content, channel_id FROM messages WHERE id = ?', id);
        if (!row || row.content !== content) return;
        this.run('UPDATE messages SET embeds = ? WHERE id = ?', JSON.stringify(embeds), id);
        const ch = this.one('SELECT * FROM channels WHERE id = ?', row.channel_id);
        if (ch) this.broadcast(this.audience(ch), 'MESSAGE_UPDATE', this.message(id));
      })(),
    );
  }

  private getMessages(c: Ctx) {
    const ch = this.channelFor(c.uid, toId(c.params.channelId));
    const limit = Math.min(Math.max(Number(c.url.searchParams.get('limit')) || 50, 1), 100);
    const before = c.url.searchParams.get('before');
    const around = c.url.searchParams.get('around');
    let rows: Row[];
    if (around) {
      const mid = toId(around);
      const half = Math.floor(limit / 2);
      const older = this.all('SELECT * FROM messages WHERE channel_id = ? AND id <= ? ORDER BY id DESC LIMIT ?', ch.id, mid, half + 1);
      const newer = this.all('SELECT * FROM messages WHERE channel_id = ? AND id > ? ORDER BY id ASC LIMIT ?', ch.id, mid, half);
      rows = [...older.reverse(), ...newer];
    } else if (before) {
      rows = this.all('SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?', ch.id, toId(before), limit).reverse();
    } else {
      rows = this.all('SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?', ch.id, limit).reverse();
    }
    return this.serializeMessages(rows);
  }

  private async sendMessage(c: Ctx) {
    const ch = this.channelFor(c.uid, toId(c.params.channelId));
    if (ch.type === 'category' || ch.type === 'voice') throw new HttpError(400, 'Não é possível enviar mensagens aqui.');
    if (ch.type === 'dm') {
      const other = this.audience(ch).find((u) => u !== c.uid);
      if (other && this.blockedBetween(c.uid, other)) {
        throw new HttpError(403, 'Sua mensagem não pôde ser entregue. Vocês precisam não estar bloqueados.');
      }
    }
    const b = await c.body();
    const content = typeof b.content === 'string' ? b.content.trim() : '';
    if (content.length > MAX_MESSAGE) throw new HttpError(400, `A mensagem pode ter no máximo ${MAX_MESSAGE} caracteres.`);
    const attachments: Attachment[] = (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 10).map((a: Row) => {
      const up = this.one('SELECT * FROM uploads WHERE key = ? AND user_id = ?', a?.key, c.uid);
      if (!up) throw new HttpError(400, 'Anexo não encontrado.');
      const dim = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
      return { key: up.key, name: up.name, size: up.size, mime: up.mime, width: dim(a.width), height: dim(a.height) };
    });
    if (!content && !attachments.length) throw new HttpError(400, 'A mensagem está vazia.');
    const msg = this.createMessage(ch, c.uid, {
      content,
      attachments,
      replyTo: b.replyTo != null ? toId(b.replyTo) : null,
      nonce: typeof b.nonce === 'string' ? b.nonce.slice(0, 64) : null,
    });
    const command = ch.guild_id != null ? parseCommand(content) : null;
    const botId = this.musicBot(false);
    if (command && botId && c.uid !== botId && this.isMember(ch.guild_id, botId)) {
      this.ctx.waitUntil(this.musicCommand(ch, c.uid, command).catch((e) => console.error('music command failed', e)));
    }
    return msg;
  }

  // ---------------------------------------------------------------- bots

  /** The built-in music bot's user id, created on first use. */
  private musicBot(create = true): number {
    if (this.musicBotId) return this.musicBotId;
    const row = this.one("SELECT value FROM meta WHERE key = 'music_bot'");
    if (row) return (this.musicBotId = Number(row.value));
    if (!create) return 0;
    const id = newId();
    const taken = this.one("SELECT 1 FROM users WHERE username = 'musica'");
    this.run(
      `INSERT INTO users (id, username, display_name, pass_hash, pass_salt, banner_color, about, created_at, bot)
       VALUES (?, ?, 'Música', '!', '!', '#5865f2', ?, ?, 1)`,
      id,
      taken ? `musica.${id % 10000}` : 'musica',
      'Bot de música do Resenha. Entre num canal de voz e digite /tocar seguido do link ou do nome da música.',
      Date.now(),
    );
    this.run("INSERT INTO meta (key, value) VALUES ('music_bot', ?)", String(id));
    return (this.musicBotId = id);
  }

  private botInfo(gid: number, u: Row) {
    return { user: this.pub(u), builtin: u.id === this.musicBot(false), ownerId: u.bot_owner ?? null };
  }

  private listBots(c: Ctx) {
    const gid = toId(c.params.guildId);
    this.adminGuild(c.uid, gid);
    return this.all('SELECT u.* FROM users u JOIN members m ON m.user_id = u.id WHERE m.guild_id = ? AND u.bot = 1 ORDER BY u.created_at', gid).map((u) =>
      this.botInfo(gid, u),
    );
  }

  private addBotMember(gid: number, botId: number) {
    if (this.isMember(gid, botId)) return;
    const others = this.guildMembers(gid);
    this.run('INSERT INTO members (guild_id, user_id, joined_at) VALUES (?, ?, ?)', gid, botId, Date.now());
    const u = this.one('SELECT * FROM users WHERE id = ?', botId)!;
    this.broadcast(others, 'GUILD_MEMBER_ADD', { member: this.member(gid, botId), user: this.pub(u), status: this.presence(botId, false, u) });
  }

  private async addBot(c: Ctx) {
    const gid = toId(c.params.guildId);
    this.adminGuild(c.uid, gid);
    const b = await c.body();
    if (b.type === 'music') {
      const id = this.musicBot();
      this.addBotMember(gid, id);
      return this.botInfo(gid, this.one('SELECT * FROM users WHERE id = ?', id)!);
    }
    const name = str(b.name, 'Nome do bot', 2, 32);
    const id = newId();
    const base = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_.]+/g, '').slice(0, 20) || 'bot';
    this.run(
      `INSERT INTO users (id, username, display_name, pass_hash, pass_salt, created_at, bot, bot_owner)
       VALUES (?, ?, ?, '!', '!', ?, 1, ?)`,
      id,
      `${base}.bot${id % 10000}`,
      name,
      Date.now(),
      c.uid,
    );
    this.addBotMember(gid, id);
    const token = this.newBotToken(id);
    return { ...this.botInfo(gid, this.one('SELECT * FROM users WHERE id = ?', id)!), token };
  }

  private newBotToken(botId: number): string {
    const token = `rb.${randomToken(32)}`;
    this.run('DELETE FROM bot_tokens WHERE bot_id = ?', botId);
    this.run('INSERT INTO bot_tokens (token, bot_id, created_at) VALUES (?, ?, ?)', token, botId, Date.now());
    // Close connections that used the old token.
    for (const ws of this.live(String(botId))) {
      try {
        ws.close(4001, 'token regenerated');
      } catch {
        // already closed
      }
    }
    return token;
  }

  private customBotIn(c: Ctx): { gid: number; bot: Row } {
    const gid = toId(c.params.guildId);
    this.adminGuild(c.uid, gid);
    const bot = this.one('SELECT * FROM users WHERE id = ? AND bot = 1', toId(c.params.botId));
    if (!bot || !this.isMember(gid, bot.id)) throw new HttpError(404, 'Bot não encontrado neste servidor.');
    return { gid, bot };
  }

  private regenerateBotToken(c: Ctx) {
    const { bot } = this.customBotIn(c);
    if (bot.id === this.musicBot(false)) throw new HttpError(400, 'O bot de música não usa token.');
    return { token: this.newBotToken(bot.id) };
  }

  private removeBot(c: Ctx) {
    const { gid, bot } = this.customBotIn(c);
    this.removeMember(gid, bot.id);
    return { ok: true };
  }

  // ---------------------------------------------------------------- music bot

  private musicPayload(gid: number) {
    const m = this.music.get(gid);
    const now = Date.now();
    if (!m) return { guildId: gid, track: null };
    return {
      guildId: gid,
      voiceChannelId: m.voiceChannelId,
      textChannelId: m.textChannelId,
      track: m.queue[m.index] ?? null,
      index: m.index,
      // Sent to everyone on every change, so a 500-song playlist isn't repeated in full.
      upNext: m.queue.slice(m.index + 1, m.index + 51),
      position: ((m.pausedAt ?? now) - m.startedAt) / 1000,
      paused: m.pausedAt != null,
      serverTime: now,
    };
  }

  private saveMusic(gid: number) {
    this.storeMusic(gid);
    this.broadcast(this.guildMembers(gid), 'MUSIC_STATE', this.musicPayload(gid));
    this.scheduleMusicCheck();
  }

  private storeMusic(gid: number) {
    const m = this.music.get(gid);
    if (m) this.run('INSERT INTO music (guild_id, data) VALUES (?, ?) ON CONFLICT DO UPDATE SET data = excluded.data', gid, JSON.stringify(m));
    else this.run('DELETE FROM music WHERE guild_id = ?', gid);
  }

  private scheduleMusicCheck() {
    if (!this.music.size || this.musicCheckScheduled) return;
    this.musicCheckScheduled = true;
    void this.ctx.storage.setAlarm(Date.now() + MUSIC_CHECK_MS);
  }

  /**
   * Runs every few seconds while the music bot is in a call: like a Discord music bot,
   * it leaves when nothing is playing (paused too long, or no player could start the song),
   * and moves on if a song ran out without anyone's player reporting the end.
   */
  async alarm() {
    this.musicCheckScheduled = false;
    const now = Date.now();
    for (const m of [...this.music.values()]) {
      if (m.pausedAt != null) {
        if (now - m.pausedAt >= MUSIC_PAUSED_MS) {
          this.stopMusic(m.guildId, `⏹️ A música ficou pausada por ${MUSIC_PAUSED_MS / 60_000} minutos, então saí do canal de voz. Use \`/tocar\` para me chamar de novo.`);
        }
      } else if (!m.playing) {
        if (now - m.startedAt >= MUSIC_START_MS) {
          this.stopMusic(
            m.guildId,
            `⏹️ **${m.queue[m.index]?.title ?? 'A música'}** não começou a tocar para ninguém da call, então saí do canal de voz. ` +
              'Se o YouTube estiver bloqueado no navegador (bloqueador de anúncios, rede da empresa), libere e use `/tocar` de novo.',
          );
        }
      } else if (m.duration && now - m.startedAt >= m.duration * 1000 + MUSIC_END_GRACE_MS) {
        this.advance(m.guildId, null);
      }
    }
    this.scheduleMusicCheck();
  }

  private musicSay(channelId: number, content: string, track?: Track) {
    const ch = this.one('SELECT * FROM channels WHERE id = ?', channelId);
    if (!ch) return;
    const embeds: Embed[] = track
      ? [{ url: track.url, type: 'link', title: track.title, siteName: track.author ? `YouTube · ${track.author}` : 'YouTube', image: track.thumbnail, color: '#ff0033' }]
      : [];
    this.createMessage(ch, this.musicBot(), { content, embeds });
  }

  private voiceChannelOf(uid: number, gid: number): number | null {
    for (const ws of this.live(String(uid))) {
      const v = this.attOf(ws)?.voice;
      if (v?.guildId === gid) return v.channelId;
    }
    return null;
  }

  private startTrack(m: MusicState, index: number) {
    m.index = index;
    m.startedAt = Date.now() + 1500; // give players a moment to load
    m.pausedAt = null;
    m.playing = false;
    m.duration = null;
  }

  private stopMusic(gid: number, message?: string) {
    const m = this.music.get(gid);
    if (!m) return;
    this.music.delete(gid);
    this.broadcast(this.guildMembers(gid), 'VOICE_STATE_UPDATE', { ...this.musicVoiceState(gid, null), leftChannelId: m.voiceChannelId });
    this.saveMusic(gid);
    if (message) this.musicSay(m.textChannelId, message);
  }

  /** The bot leaves when the last person leaves its voice channel. */
  private checkMusicListeners(channelId: number) {
    for (const m of this.music.values()) {
      if (m.voiceChannelId !== channelId) continue;
      const humans = this.voiceStates((v) => v.channelId === channelId, false).length;
      if (!humans) this.stopMusic(m.guildId, 'Todo mundo saiu do canal de voz, então parei a música. 👋');
    }
  }

  /** `note` goes in the same message, so a skipped song doesn't cost a message of its own. */
  private advance(gid: number, by: string | null, note?: string) {
    const m = this.music.get(gid);
    if (!m) return;
    const prefix = note ? `${note}\n` : '';
    if (m.index + 1 >= m.queue.length) {
      this.stopMusic(gid, prefix + (by ? `⏹️ ${by} pulou a última música. A fila acabou.` : 'A fila acabou. Até a próxima! 🎶'));
      return;
    }
    this.startTrack(m, m.index + 1);
    const t = m.queue[m.index];
    this.saveMusic(gid);
    this.musicSay(m.textChannelId, `${prefix}${by ? `⏭️ ${by} pulou. ` : ''}🎵 Tocando agora: **${t.title}** · pedido por <@${t.requestedBy}>`, t);
  }

  private async musicCommand(ch: Row, uid: number, command: ReturnType<typeof parseCommand> & object) {
    const gid = ch.guild_id as number;
    const name = this.one('SELECT display_name FROM users WHERE id = ?', uid)?.display_name ?? 'Alguém';
    const m = this.music.get(gid);
    const say = (text: string, track?: Track) => this.musicSay(ch.id, text, track);
    const voice = this.voiceChannelOf(uid, gid);

    if (command.cmd === 'help') return say(HELP);
    if (command.cmd === 'queue') {
      if (!m) return say('Não tem nada tocando. Use `/tocar <link ou nome>`.');
      const lines = m.queue.slice(m.index, m.index + 11).map((t, i) => (i === 0 ? `▶️ **${t.title}**` : `${i}. ${t.title}`));
      const more = m.queue.length - m.index - 11;
      return say(`**Fila de músicas**\n${lines.join('\n')}${more > 0 ? `\n… e mais ${more}` : ''}`);
    }
    if (command.cmd === 'now') {
      if (!m) return say('Não tem nada tocando.');
      const t = m.queue[m.index];
      const pos = ((m.pausedAt ?? Date.now()) - m.startedAt) / 1000;
      return say(`${m.pausedAt ? '⏸️ Pausado' : '🎵 Tocando agora'}: **${t.title}** · ${formatTime(pos)}`, t);
    }

    if (command.cmd === 'play') {
      if (!command.query) return say('Diga o que tocar: `/tocar <link do YouTube ou nome da música>`.');
      if (!voice) return say(`<@${uid}>, entre em um canal de voz primeiro e depois peça a música.`);
      if (m && m.voiceChannelId !== voice) return say(`Já estou tocando em outro canal de voz. Entre lá ou use \`/parar\` primeiro.`);
      // A song link from YouTube Music carries its auto mix (list=RDAMVM…): play just the song.
      const videoId = youtubeId(command.query);
      const list = playlistId(command.query);
      if (list && !(videoId && isMix(list))) {
        const found = await resolvePlaylist(list, videoId, uid);
        if (!('error' in found)) return this.queuePlaylist(ch, uid, voice, found);
        // A song opened from a list we can't read (e.g. "Músicas curtidas"): play just the song.
        if (!videoId) return say(`❌ ${found.error}`);
      }
      const track = await resolveTrack(command.query, uid);
      if ('error' in track) return say(`❌ ${track.error}`);
      const cur = this.music.get(gid);
      if (cur) {
        cur.queue.push(track);
        this.saveMusic(gid);
        return say(`➕ Adicionada à fila (posição ${cur.queue.length - cur.index - 1}): **${track.title}**`, track);
      }
      this.startMusic(gid, voice, ch.id, [track]);
      return say(`🎵 Tocando agora: **${track.title}** · pedido por <@${uid}>`, track);
    }

    if (!m) return say('Não tem nada tocando.');
    if (voice !== m.voiceChannelId) return say(`<@${uid}>, entre no canal de voz onde estou tocando para controlar a música.`);
    this.musicControl(gid, command.cmd, name);
  }

  private startMusic(gid: number, voiceChannelId: number, textChannelId: number, queue: Track[]) {
    const state: MusicState = { guildId: gid, voiceChannelId, textChannelId, queue, index: 0, startedAt: 0, pausedAt: null };
    this.startTrack(state, 0);
    this.music.set(gid, state);
    this.broadcast(this.guildMembers(gid), 'VOICE_STATE_UPDATE', this.musicVoiceState(gid, voiceChannelId));
    this.saveMusic(gid);
  }

  /** `/tocar <playlist or album link>`: queues its songs. */
  private queuePlaylist(ch: Row, uid: number, voice: number, found: { title: string; tracks: Track[]; truncated: boolean }) {
    const gid = ch.guild_id as number;
    const say = (text: string, track?: Track) => this.musicSay(ch.id, text, track);
    // The command waited on YouTube: someone may have started or moved the music meanwhile.
    const cur = this.music.get(gid);
    if (cur && cur.voiceChannelId !== voice) return say(`Já estou tocando em outro canal de voz. Entre lá ou use \`/parar\` primeiro.`);
    const upcoming = cur ? cur.queue.length - cur.index - 1 : 0;
    const tracks = found.tracks.slice(0, Math.max(0, MAX_PLAYLIST - upcoming));
    if (!tracks.length) return say(`❌ A fila já tem ${upcoming} músicas, o máximo. Use \`/pular\` ou \`/parar\` antes de adicionar outra playlist.`);
    const cut = tracks.length < found.tracks.length || found.truncated;
    const count = `${tracks.length} ${tracks.length === 1 ? 'música' : 'músicas'}${cut ? ` (o máximo é ${MAX_PLAYLIST} na fila, então ficaram só as primeiras)` : ''}`;
    if (cur) {
      cur.queue.push(...tracks);
      this.saveMusic(gid);
      return say(`📃 Playlist **${found.title}**: adicionei ${count} à fila.`, tracks[0]);
    }
    this.startMusic(gid, voice, ch.id, tracks);
    return say(`📃 Playlist **${found.title}**: ${count} na fila.\n🎵 Tocando agora: **${tracks[0].title}** · pedido por <@${uid}>`, tracks[0]);
  }

  /** Shared by chat commands and the player buttons. */
  private musicControl(gid: number, action: string, by: string, index?: number, extra: { code?: number; duration?: number } = {}) {
    const m = this.music.get(gid);
    if (!m) return;
    const now = Date.now();
    switch (action) {
      case 'skip':
        return this.advance(gid, by);
      case 'pause':
        if (m.pausedAt == null) {
          m.pausedAt = now;
          this.saveMusic(gid);
          this.musicSay(m.textChannelId, `⏸️ ${by} pausou a música.`);
        }
        return;
      case 'resume':
        if (m.pausedAt != null) {
          m.startedAt += now - m.pausedAt;
          m.pausedAt = null;
          this.saveMusic(gid);
          this.musicSay(m.textChannelId, `▶️ ${by} voltou a tocar.`);
        }
        return;
      case 'stop':
        return this.stopMusic(gid, `⏹️ ${by} parou a música.`);
      case 'playing':
        // Proof that the song really plays somewhere, and how long it is (0 for a live video).
        if (index === m.index && !m.playing) {
          m.playing = true;
          m.duration = extra.duration && extra.duration > 0 ? extra.duration : null;
          this.storeMusic(gid);
        }
        return;
      case 'ended':
        // Every listener reports the end; only the first one for this track counts.
        if (index === m.index) {
          m.failures = 0;
          this.advance(gid, null);
        }
        return;
      case 'error':
        if (index === m.index) {
          const failed = `❌ Pulei **${m.queue[m.index].title}**: ${playerError(extra.code)}.`;
          m.failures = (m.failures ?? 0) + 1;
          // One listener whose browser can't play YouTube would otherwise burn through a whole playlist.
          if (m.failures >= MAX_FAILURES) {
            return this.stopMusic(
              gid,
              `${failed}\n⏹️ ${m.failures} músicas seguidas não tocaram, então parei a música para não pular a fila inteira. ` +
                'Se o YouTube estiver bloqueado no navegador de alguém da call (bloqueador de anúncios, rede da empresa), resolva isso e use `/tocar` de novo.',
            );
          }
          this.advance(gid, null, failed);
        }
        return;
    }
  }

  private async musicAction(c: Ctx) {
    const gid = toId(c.params.guildId);
    this.guildFor(c.uid, gid);
    const b = await c.body();
    const m = this.music.get(gid);
    if (!m) throw new HttpError(400, 'Não tem nada tocando.');
    const action = String(b.action);
    if (!['skip', 'pause', 'resume', 'stop', 'playing', 'ended', 'error'].includes(action)) throw new HttpError(400, 'Ação inválida.');
    if (this.voiceChannelOf(c.uid, gid) !== m.voiceChannelId) throw new HttpError(403, 'Entre no canal de voz da música para controlá-la.');
    const name = this.one('SELECT display_name FROM users WHERE id = ?', c.uid)?.display_name ?? 'Alguém';
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    this.musicControl(gid, action, name, num(b.index), { code: num(b.code), duration: num(b.duration) });
    return this.musicPayload(gid);
  }

  private messageIn(ch: Row, messageId: number): Row {
    const m = this.one('SELECT * FROM messages WHERE id = ? AND channel_id = ?', messageId, ch.id);
    if (!m) throw new HttpError(404, 'Mensagem não encontrada.');
    return m;
  }

  private async editMessage(c: Ctx) {
    const ch = this.channelFor(c.uid, toId(c.params.channelId));
    const m = this.messageIn(ch, toId(c.params.messageId));
    if (m.author_id !== c.uid || m.type !== 'default') throw new HttpError(403, 'Você só pode editar suas próprias mensagens.');
    const b = await c.body();
    const content = typeof b.content === 'string' ? b.content.trim() : '';
    if (content.length > MAX_MESSAGE) throw new HttpError(400, `A mensagem pode ter no máximo ${MAX_MESSAGE} caracteres.`);
    if (!content && m.attachments === '[]') throw new HttpError(400, 'A mensagem está vazia.');
    if (content === m.content) return this.message(m.id);
    const audience = new Set(this.audience(ch));
    const mentions = new Set(
      [...content.matchAll(/<@(\d+)>/g)].map((x) => Number(x[1])).filter((id) => audience.has(id) && id !== c.uid),
    );
    for (const old of JSON.parse(m.mentions) as number[]) {
      // keep the implicit reply mention
      if (m.reply_to != null && this.one('SELECT 1 FROM messages WHERE id = ? AND author_id = ?', m.reply_to, old)) mentions.add(old);
    }
    const everyone = ch.guild_id != null && /@(everyone|here)\b/.test(content);
    this.run(
      "UPDATE messages SET content = ?, edited_at = ?, mentions = ?, mention_everyone = ?, embeds = '[]' WHERE id = ?",
      content,
      Date.now(),
      JSON.stringify([...mentions]),
      everyone ? 1 : 0,
      m.id,
    );
    const msg = this.message(m.id);
    this.broadcast(audience, 'MESSAGE_UPDATE', msg);
    this.scheduleUnfurl(m.id, content);
    return msg;
  }

  private deleteMessage(c: Ctx) {
    const ch = this.channelFor(c.uid, toId(c.params.channelId));
    const m = this.messageIn(ch, toId(c.params.messageId));
    if (m.author_id !== c.uid && !(ch.guild_id != null && this.isAdmin(ch.guild_id, c.uid))) {
      throw new HttpError(403, 'Você não tem permissão para apagar essa mensagem.');
    }
    const keys = (JSON.parse(m.attachments) as Attachment[]).map((a) => a.key);
    this.tx(() => {
      this.run('DELETE FROM reactions WHERE message_id = ?', m.id);
      this.run('DELETE FROM messages WHERE id = ?', m.id);
      const last = this.one('SELECT MAX(id) AS id FROM messages WHERE channel_id = ?', ch.id);
      this.run('UPDATE channels SET last_message_id = ? WHERE id = ?', last?.id ?? null, ch.id);
      this.releaseFiles(keys);
    });
    const last = this.one('SELECT last_message_id FROM channels WHERE id = ?', ch.id);
    const aud = this.audience(ch);
    this.broadcast(aud, 'MESSAGE_DELETE', { id: m.id, channelId: ch.id, guildId: ch.guild_id, lastMessageId: last?.last_message_id ?? null });
    if (m.pinned) this.broadcast(aud, 'CHANNEL_PINS_UPDATE', { channelId: ch.id });
    return { ok: true };
  }

  private react(c: Ctx, add: boolean) {
    const ch = this.channelFor(c.uid, toId(c.params.channelId));
    const m = this.messageIn(ch, toId(c.params.messageId));
    const emoji = c.params.emoji;
    if (!emoji || emoji.length > 64 || /\s/.test(emoji)) throw new HttpError(400, 'Emoji inválido.');
    if (add) {
      const distinct = this.one('SELECT COUNT(DISTINCT emoji) AS n FROM reactions WHERE message_id = ?', m.id)!.n;
      const has = this.one('SELECT 1 FROM reactions WHERE message_id = ? AND emoji = ?', m.id, emoji);
      if (!has && distinct >= 20) throw new HttpError(400, 'Essa mensagem já tem reações demais.');
      this.run('INSERT OR IGNORE INTO reactions (message_id, emoji, user_id, created_at) VALUES (?, ?, ?, ?)', m.id, emoji, c.uid, Date.now());
    } else {
      this.run('DELETE FROM reactions WHERE message_id = ? AND emoji = ? AND user_id = ?', m.id, emoji, c.uid);
    }
    this.broadcast(this.audience(ch), add ? 'REACTION_ADD' : 'REACTION_REMOVE', {
      messageId: m.id,
      channelId: ch.id,
      emoji,
      userId: c.uid,
    });
    return { ok: true };
  }

  private getPins(c: Ctx) {
    const ch = this.channelFor(c.uid, toId(c.params.channelId));
    return this.serializeMessages(this.all('SELECT * FROM messages WHERE channel_id = ? AND pinned = 1 ORDER BY id DESC', ch.id));
  }

  private setPin(c: Ctx, pinned: boolean) {
    const ch = this.channelFor(c.uid, toId(c.params.channelId));
    if (ch.guild_id != null && !this.isAdmin(ch.guild_id, c.uid)) throw new HttpError(403, 'Você não tem permissão para fixar mensagens.');
    const m = this.messageIn(ch, toId(c.params.messageId));
    if (!!m.pinned === pinned) return { ok: true };
    if (pinned && this.one('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND pinned = 1', ch.id)!.n >= 50) {
      throw new HttpError(400, 'Esse canal já tem 50 mensagens fixadas.');
    }
    this.run('UPDATE messages SET pinned = ? WHERE id = ?', pinned ? 1 : 0, m.id);
    const aud = this.audience(ch);
    this.broadcast(aud, 'MESSAGE_UPDATE', this.message(m.id));
    this.broadcast(aud, 'CHANNEL_PINS_UPDATE', { channelId: ch.id });
    if (pinned) this.createMessage(ch, c.uid, { type: 'pin', replyTo: m.id });
    return { ok: true };
  }

  private async ack(c: Ctx) {
    const ch = this.channelFor(c.uid, toId(c.params.channelId));
    const b = await c.body();
    const messageId = b.messageId != null ? toId(b.messageId) : (ch.last_message_id ?? 0);
    this.upsertRead(c.uid, ch.id, messageId);
    const rs = this.one('SELECT last_read_id FROM read_states WHERE user_id = ? AND channel_id = ?', c.uid, ch.id);
    this.broadcast([c.uid], 'READ_STATE_UPDATE', [{ channelId: ch.id, lastReadId: rs?.last_read_id ?? messageId, mentions: 0 }]);
    return { ok: true };
  }

  private search(c: Ctx) {
    const q = (c.url.searchParams.get('q') ?? '').trim();
    if (q.length < 1 || q.length > 200) throw new HttpError(400, 'Digite algo para pesquisar.');
    const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    const guildId = c.url.searchParams.get('guildId');
    const channelId = c.url.searchParams.get('channelId');
    let rows: Row[];
    if (guildId) {
      const gid = toId(guildId);
      this.guildFor(c.uid, gid);
      rows = this.all(
        `SELECT * FROM messages WHERE channel_id IN (SELECT id FROM channels WHERE guild_id = ?)
         AND type = 'default' AND content LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 25`,
        gid,
        like,
      );
    } else if (channelId) {
      const ch = this.channelFor(c.uid, toId(channelId));
      rows = this.all(
        "SELECT * FROM messages WHERE channel_id = ? AND type = 'default' AND content LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 25",
        ch.id,
        like,
      );
    } else {
      throw new HttpError(400, 'Informe onde pesquisar.');
    }
    return this.serializeMessages(rows);
  }
}
