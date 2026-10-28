import type { Channel, Member, Role, User } from './types';

export const APP_NAME = 'Resenha';

export function fileUrl(key: string, name = 'arquivo'): string {
  return `/api/files/${key}/${encodeURIComponent(name)}`;
}

const DEFAULT_AVATAR_COLORS = ['#5865f2', '#757e8a', '#3ba55c', '#faa61a', '#ed4245', '#eb459f'];

export function defaultAvatarColor(id: number): string {
  return DEFAULT_AVATAR_COLORS[Math.floor(id / 4096) % DEFAULT_AVATAR_COLORS.length];
}

export function avatarUrl(u: User | null | undefined): string | null {
  return u?.avatar ? fileUrl(u.avatar, 'avatar') : null;
}

/** CSS background-image for a profile banner, or null to show the banner color. */
export function bannerImage(u: User | null | undefined): string | null {
  return u?.banner ? `url("${fileUrl(u.banner, 'banner')}")` : null;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return [...words[0]].slice(0, 2).join('');
  return words
    .slice(0, 3)
    .map((w) => [...w][0])
    .join('');
}

export function displayName(u: User | null | undefined, member?: Member | null): string {
  if (!u) return 'Usuário desconhecido';
  return member?.nick || u.displayName || u.username;
}

/** Color of the highest colored role, like Discord name colors. */
export function roleColor(member: Member | null | undefined, roles: Role[] | undefined): string | null {
  if (!member || !roles?.length) return null;
  let best: Role | null = null;
  for (const r of roles) {
    if (!r.color || !member.roles.includes(r.id)) continue;
    if (!best || r.position > best.position) best = r;
  }
  return best?.color ?? null;
}

export function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fullDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const longDate = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
const tooltipDate = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatTime(ts: number): string {
  return time.format(ts);
}

export function formatTimestamp(ts: number): string {
  const now = Date.now();
  if (sameDay(ts, now)) return `Hoje às ${time.format(ts)}`;
  if (sameDay(ts, now - 86_400_000)) return `Ontem às ${time.format(ts)}`;
  return `${fullDate.format(ts)} ${time.format(ts)}`;
}

export function formatLongDate(ts: number): string {
  return longDate.format(ts);
}

export function formatTooltipDate(ts: number): string {
  const s = tooltipDate.format(ts);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** How long since a moment, Discord-style: "há 5 min", "há 1 h 20 min". */
export function elapsedLabel(since: number, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - since) / 60_000));
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `há ${h} h ${min % 60} min` : `há ${h} h`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2).replace('.', ',')} MB`;
}

export function channelLabel(c: Channel | undefined, users: Record<number, User>, meId: number | undefined): string {
  if (!c) return '';
  if (c.type === 'dm' || c.type === 'group_dm') {
    if (c.name) return c.name;
    const others = (c.recipients ?? []).filter((id) => id !== meId).map((id) => displayName(users[id]));
    return others.join(', ') || 'Grupo vazio';
  }
  return c.name;
}

export function isImage(mime: string): boolean {
  return /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mime);
}

export function isVideo(mime: string): boolean {
  return /^video\/(mp4|webm|ogg|quicktime)$/.test(mime);
}

export function isAudio(mime: string): boolean {
  return mime.startsWith('audio/');
}

export function store<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode); preferences just won't persist
  }
}

export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (!isImage(file.type)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/** Fit an attachment into Discord-like max bounds, keeping the aspect ratio. */
export function fitSize(w: number | null, h: number | null, maxW = 400, maxH = 300): { width: number; height: number } | null {
  if (!w || !h) return null;
  const scale = Math.min(1, maxW / w, maxH / h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}
