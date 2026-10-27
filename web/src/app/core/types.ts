export type Status = 'online' | 'idle' | 'dnd' | 'offline' | 'invisible';
export type StatusPref = 'online' | 'idle' | 'dnd' | 'invisible';
export type RelType = 'friend' | 'incoming' | 'outgoing' | 'blocked';
export type ChannelType = 'text' | 'voice' | 'category' | 'dm' | 'group_dm';

export interface User {
  id: number;
  username: string;
  displayName: string;
  avatar: string | null;
  /** Profile banner image (can be an animated GIF); bannerColor shows when there's none. */
  banner?: string | null;
  bannerColor: string | null;
  about: string;
  customStatus: string;
  createdAt: number;
  status?: StatusPref;
  bot?: boolean;
}

export interface Track {
  videoId: string;
  url: string;
  title: string;
  author: string;
  thumbnail: string;
  requestedBy: number;
}

/** What the built-in music bot is playing in a server (synced by the server clock). */
export interface MusicState {
  guildId: number;
  voiceChannelId?: number;
  textChannelId?: number;
  track: Track | null;
  index?: number;
  upNext?: Track[];
  position?: number;
  paused?: boolean;
  serverTime?: number;
  /** client-only: Date.now() when this state arrived */
  receivedAt?: number;
}

export interface BotInfo {
  user: User;
  builtin: boolean;
  ownerId: number | null;
  token?: string;
}

export interface Guild {
  id: number;
  name: string;
  icon: string | null;
  ownerId: number;
  systemChannelId: number | null;
  createdAt?: number;
}

export interface Channel {
  id: number;
  guildId: number | null;
  type: ChannelType;
  name: string;
  topic: string;
  parentId: number | null;
  position: number;
  lastMessageId: number | null;
  ownerId?: number | null;
  recipients?: number[];
}

export interface Role {
  id: number;
  guildId: number;
  name: string;
  color: string | null;
  position: number;
  hoist: boolean;
  admin: boolean;
}

export interface Member {
  guildId: number;
  userId: number;
  nick: string | null;
  roles: number[];
  joinedAt: number;
}

export interface Attachment {
  key: string;
  name: string;
  size: number;
  mime: string;
  width: number | null;
  height: number | null;
}

export interface Embed {
  url: string;
  type: 'link' | 'image' | 'video';
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  color?: string;
}

export interface Reaction {
  emoji: string;
  users: number[];
}

export interface MessageRef {
  id: number;
  authorId?: number;
  author?: User | null;
  content?: string;
  hasAttachments?: boolean;
  deleted?: boolean;
}

export type MessageType = 'default' | 'join' | 'call' | 'pin';

export interface Message {
  id: number;
  channelId: number;
  guildId: number | null;
  authorId: number;
  author: User | null;
  type: MessageType;
  content: string;
  createdAt: number;
  editedAt: number | null;
  replyTo: number | null;
  reference: MessageRef | null;
  pinned: boolean;
  mentions: number[];
  mentionEveryone: boolean;
  attachments: Attachment[];
  embeds: Embed[];
  reactions: Reaction[];
  nonce?: string | null;
  // client-only
  pending?: boolean;
  failed?: boolean;
  localFiles?: PendingFile[];
}

export interface PendingFile {
  id: string;
  file: File;
  name: string;
  preview: string | null;
  spoiler?: boolean;
}

export interface VoiceState {
  userId: number;
  sessionId: string;
  channelId: number | null;
  guildId: number | null;
  mute: boolean;
  deaf: boolean;
  video: boolean;
  stream: boolean;
  /** Session id of the stream this person is watching. */
  watching?: string | null;
  leftChannelId?: number;
  bot?: boolean;
}

export interface ReadState {
  channelId: number;
  lastReadId: number;
  mentions: number;
}

export interface GuildPayload extends Guild {
  channels: Channel[];
  roles: Role[];
  members: Member[];
}

export interface Ready {
  sessionId: string;
  user: User;
  users: User[];
  guilds: GuildPayload[];
  privateChannels: Channel[];
  relationships: { userId: number; type: RelType }[];
  readStates: ReadState[];
  presences: Record<number, Status>;
  voiceStates: VoiceState[];
  music?: MusicState[];
}

export interface InviteInfo {
  code: string;
  guild: { id: number; name: string; icon: string | null; memberCount: number; onlineCount: number };
  inviter: User | null;
}
