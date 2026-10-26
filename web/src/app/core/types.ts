export type Status = 'online' | 'idle' | 'dnd' | 'offline' | 'invisible';
export type StatusPref = 'online' | 'idle' | 'dnd' | 'invisible';
export type RelType = 'friend' | 'incoming' | 'outgoing' | 'blocked';
export type ChannelType = 'text' | 'voice' | 'category' | 'dm' | 'group_dm';

export interface User {
  id: number;
  username: string;
  displayName: string;
  avatar: string | null;
  bannerColor: string | null;
  about: string;
  customStatus: string;
  createdAt: number;
  status?: StatusPref;
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
  leftChannelId?: number;
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
}

export interface InviteInfo {
  code: string;
  guild: { id: number; name: string; icon: string | null; memberCount: number; onlineCount: number };
  inviter: User | null;
}
