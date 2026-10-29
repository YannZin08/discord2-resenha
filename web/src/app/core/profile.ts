import type { Profile, StatusMode, User, VibeLabel } from './types';

/** Same defaults as the server: an old profile looks the way it always did. */
export const DEFAULT_PROFILE: Profile = {
  status: { mode: null, emoji: null, color: null },
  vibe: null,
  interests: [],
  link: null,
  style: 'card',
  overlay: null,
  privacy: { interests: true, links: true, reactions: true, status: true, joined: true },
};

export function profileOf(u: User | null | undefined): Profile {
  const p = u?.profile;
  if (!p) return DEFAULT_PROFILE;
  return {
    ...DEFAULT_PROFILE,
    ...p,
    style: p.style === 'immersive' ? 'immersive' : 'card',
    status: { ...DEFAULT_PROFILE.status, ...p.status },
    privacy: { ...DEFAULT_PROFILE.privacy, ...p.privacy },
    interests: p.interests ?? [],
  };
}

export const STATUS_MODES: { id: StatusMode; label: string; emoji: string }[] = [
  { id: 'playing', label: 'Jogando', emoji: '🎮' },
  { id: 'listening', label: 'Ouvindo música', emoji: '🎧' },
  { id: 'available', label: 'Disponível', emoji: '☕' },
  { id: 'busy', label: 'Ocupado', emoji: '😴' },
  { id: 'resenha', label: 'Na resenha', emoji: '🔥' },
];

export const VIBE_LABELS: VibeLabel[] = ['Vibe', 'Modo', 'Energia', 'Tag', 'Personalidade'];

export const MAX_INTERESTS = 6;
export const INTEREST_SUGGESTIONS = ['Jogos', 'Música', 'Futebol', 'Tecnologia', 'Anime', 'Arte', 'Programação', 'Filmes', 'Criador de conteúdo'];

export const PROFILE_REACTIONS: { kind: string; label: string; emoji: string }[] = [
  { kind: 'boa_resenha', label: 'Boa resenha', emoji: '🔥' },
  { kind: 'gente_boa', label: 'Gente boa', emoji: '🤝' },
  { kind: 'lenda', label: 'Lenda', emoji: '👑' },
  { kind: 'joga_muito', label: 'Joga muito', emoji: '🎮' },
  { kind: 'criativo', label: 'Criativo', emoji: '🎨' },
];

/** Selos: the old badges (owner, pioneer, bot creator) plus new ones, each with a word, not just an icon. */
export const SELOS: Record<string, { icon: string; label: string; hint: string; color: string }> = {
  owner: { icon: 'crown', label: 'Fundador', hint: 'Criou este servidor', color: '#f0b232' },
  pioneer: { icon: 'star', label: 'Pioneiro', hint: 'Uma das primeiras 100 contas do Resenha', color: '#8b9cff' },
  veteran: { icon: 'shield', label: 'Veterano', hint: 'Mais de um ano no Resenha', color: '#5ed69a' },
  botDev: { icon: 'code', label: 'Criador', hint: 'Criou um bot no Resenha', color: '#4fc3f7' },
  boaResenha: { icon: 'fire', label: 'Boa resenha', hint: 'Recebeu muitas reações "Boa resenha"', color: '#ff7a45' },
};

/** A typed link as the server will store it ("instagram.com/x" gets https://), for the preview; null if not a web link. */
export function linkPreview(raw: string): string | null {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "https://www.instagram.com/yann_felipe_/" → "instagram.com/yann_felipe_". */
export function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = (u.pathname + u.search).replace(/\/$/, '');
    return u.hostname.replace(/^www\./, '') + (path === '/' ? '' : path);
  } catch {
    return url;
  }
}

/** Status line: "Jogando · Valorant", or just one of the two. */
export function statusLine(u: User): { emoji: string | null; text: string; color: string | null } | null {
  const p = profileOf(u);
  const mode = STATUS_MODES.find((m) => m.id === p.status.mode);
  const text = [mode?.label, u.customStatus].filter(Boolean).join(' · ');
  if (!text) return null;
  return { emoji: p.status.emoji ?? mode?.emoji ?? null, text, color: p.status.color };
}
