import { HttpError, color } from './util';

/**
 * The personal side of a profile (users.profile, JSON): status details, the "vibe" tag,
 * interests, a link, the card style and privacy. Old profiles have no row value and get
 * DEFAULT_PROFILE, so nothing changes for them until they edit.
 */
export interface Profile {
  /** Extra details for the custom status (its text stays in users.custom_status). */
  status: { mode: StatusMode | null; emoji: string | null; color: string | null };
  vibe: { label: VibeLabel; text: string; emoji: string | null; color: string | null } | null;
  interests: string[];
  link: string | null;
  style: ProfileStyle;
  /** Darkening over the banner, 0–90 %; null picks it from the picture's brightness. */
  overlay: number | null;
  privacy: { interests: boolean; links: boolean; reactions: boolean; status: boolean; joined: boolean };
}

export type StatusMode = 'playing' | 'listening' | 'available' | 'busy' | 'resenha';
export type VibeLabel = 'Vibe' | 'Modo' | 'Energia' | 'Tag' | 'Personalidade';
export type ProfileStyle = 'card' | 'immersive';

const STATUS_MODES: StatusMode[] = ['playing', 'listening', 'available', 'busy', 'resenha'];
const VIBE_LABELS: VibeLabel[] = ['Vibe', 'Modo', 'Energia', 'Tag', 'Personalidade'];
const STYLES: ProfileStyle[] = ['card', 'immersive'];

export const MAX_INTERESTS = 6;
const MAX_INTEREST = 20;
const MAX_VIBE = 24;
const MAX_LINK = 200;

/** Positive things people can say about someone, once each. */
export const PROFILE_REACTIONS = ['boa_resenha', 'gente_boa', 'lenda', 'joga_muito', 'criativo'] as const;
export type ProfileReaction = (typeof PROFILE_REACTIONS)[number];
/** Received this many "Boa resenha", the profile earns the selo of the same name. */
export const BOA_RESENHA_SELO = 5;

export const DEFAULT_PROFILE: Profile = {
  status: { mode: null, emoji: null, color: null },
  vibe: null,
  interests: [],
  link: null,
  style: 'card',
  overlay: null,
  privacy: { interests: true, links: true, reactions: true, status: true, joined: true },
};

/** The stored value, with defaults for anything missing (fields added later, old rows). */
export function readProfile(raw: unknown): Profile {
  let p: Partial<Profile> = {};
  try {
    p = typeof raw === 'string' && raw ? JSON.parse(raw) : {};
  } catch {
    // a broken value just falls back to the defaults
  }
  return {
    ...DEFAULT_PROFILE,
    ...p,
    // A style that no longer exists (the old "minimal") falls back to the card.
    style: STYLES.includes(p.style as ProfileStyle) ? (p.style as ProfileStyle) : 'card',
    status: { ...DEFAULT_PROFILE.status, ...p.status },
    privacy: { ...DEFAULT_PROFILE.privacy, ...p.privacy },
    interests: Array.isArray(p.interests) ? p.interests : [],
  };
}

/** What others see: hidden parts are left out here, not just hidden on screen. */
export function publicProfile(p: Profile): Profile {
  return {
    ...p,
    status: p.privacy.status ? p.status : DEFAULT_PROFILE.status,
    interests: p.privacy.interests ? p.interests : [],
    link: p.privacy.links ? p.link : null,
  };
}

function text(v: unknown, what: string, max: number): string {
  if (v == null) return '';
  if (typeof v !== 'string') throw new HttpError(400, `${what} inválido.`);
  // No line breaks or control characters in short fields.
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > max) throw new HttpError(400, `${what} pode ter no máximo ${max} caracteres.`);
  return s;
}

/** A Unicode emoji or one of ours (<:nome:id>), like a soundboard sound's. */
function emoji(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > 64 || /\s/.test(v)) throw new HttpError(400, 'Emoji inválido.');
  if (v.includes('<') && !/^<a?:[A-Za-z0-9_]{2,32}:\d{1,20}>$/.test(v)) throw new HttpError(400, 'Emoji inválido.');
  if (!v.includes('<') && /[<>"'&]/.test(v)) throw new HttpError(400, 'Emoji inválido.');
  return v;
}

/** Only http(s) links; "instagram.com/x" gets https:// in front. */
function link(v: unknown): string | null {
  const s = text(v, 'Link', MAX_LINK);
  if (!s) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    throw new HttpError(400, 'Link inválido.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HttpError(400, 'O link precisa começar com http:// ou https://.');
  if (!url.hostname.includes('.')) throw new HttpError(400, 'Link inválido.');
  return url.toString().slice(0, MAX_LINK);
}

/** Applies a PATCH's `profile` object over the current one, validating each field it has. */
export function mergeProfile(cur: Profile, b: unknown): Profile {
  if (b == null || typeof b !== 'object') throw new HttpError(400, 'Perfil inválido.');
  const v = b as Record<string, unknown>;
  const next: Profile = structuredClone(cur);
  if (v.status !== undefined) {
    const s = (v.status ?? {}) as Record<string, unknown>;
    if (s.mode !== undefined) {
      if (s.mode !== null && !STATUS_MODES.includes(s.mode as StatusMode)) throw new HttpError(400, 'Modo de status inválido.');
      next.status.mode = (s.mode as StatusMode) ?? null;
    }
    if (s.emoji !== undefined) next.status.emoji = emoji(s.emoji);
    if (s.color !== undefined) next.status.color = color(s.color);
  }
  if (v.vibe !== undefined) {
    if (v.vibe === null) next.vibe = null;
    else {
      const t = v.vibe as Record<string, unknown>;
      const label = (t.label ?? 'Vibe') as VibeLabel;
      if (!VIBE_LABELS.includes(label)) throw new HttpError(400, 'Tipo de etiqueta inválido.');
      const body = text(t.text, 'A etiqueta', MAX_VIBE);
      // An empty tag is no tag: it doesn't show at all.
      next.vibe = body ? { label, text: body, emoji: emoji(t.emoji), color: color(t.color) } : null;
    }
  }
  if (v.interests !== undefined) {
    if (!Array.isArray(v.interests)) throw new HttpError(400, 'Interesses inválidos.');
    const seen = new Set<string>();
    const list: string[] = [];
    for (const raw of v.interests) {
      const tag = text(raw, 'Cada interesse', MAX_INTEREST);
      if (!tag || seen.has(tag.toLowerCase())) continue;
      seen.add(tag.toLowerCase());
      list.push(tag);
    }
    if (list.length > MAX_INTERESTS) throw new HttpError(400, `Escolha no máximo ${MAX_INTERESTS} interesses.`);
    next.interests = list;
  }
  if (v.link !== undefined) next.link = link(v.link);
  if (v.style !== undefined) {
    if (!STYLES.includes(v.style as ProfileStyle)) throw new HttpError(400, 'Estilo de perfil inválido.');
    next.style = v.style as ProfileStyle;
  }
  if (v.overlay !== undefined) {
    if (v.overlay === null) next.overlay = null;
    else {
      const n = Number(v.overlay);
      if (!Number.isFinite(n) || n < 0 || n > 90) throw new HttpError(400, 'A camada escura vai de 0 a 90%.');
      next.overlay = Math.round(n);
    }
  }
  if (v.privacy !== undefined) {
    const p = (v.privacy ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(DEFAULT_PROFILE.privacy) as (keyof Profile['privacy'])[]) {
      if (p[k] !== undefined) next.privacy[k] = !!p[k];
    }
  }
  return next;
}
