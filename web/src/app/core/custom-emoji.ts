// Custom (server) emojis. They travel like Discord's: <:nome:id> in messages (<a:nome:id> when
// animated) and "nome:id" in reactions. Anyone can use any of them anywhere — no Nitro here.

import { twemojiUrl } from './markdown';
import type { CustomEmoji } from './types';

export const CUSTOM_TOKEN = /<(a?):([A-Za-z0-9_]{2,32}):(\d{1,20})>/g;
const ONE_TOKEN = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{1,20})>$/;
const REACTION_KEY = /^([A-Za-z0-9_]{2,32}):(\d{1,20})$/;

export function customEmojiUrl(id: number | string): string {
  return `/api/emojis/${id}`;
}

export function customToken(e: CustomEmoji): string {
  return `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
}

/** Name and id of a custom emoji given as a token or a reaction key; null for Unicode ones. */
export function parseCustom(s: string): { name: string; id: string } | null {
  const m = s.match(ONE_TOKEN);
  if (m) return { name: m[2], id: m[3] };
  const r = s.match(REACTION_KEY);
  return r ? { name: r[1], id: r[2] } : null;
}

/** What the reactions API takes: the emoji itself, or "nome:id" for a custom one. */
export function reactionKey(picked: string): string {
  const c = parseCustom(picked);
  return c ? `${c.name}:${c.id}` : picked;
}

/** Image for any emoji the app handles: Unicode (Twemoji), token or reaction key. */
export function emojiSrc(e: string): string {
  const c = parseCustom(e);
  return c ? customEmojiUrl(c.id) : twemojiUrl(e);
}

/** How an emoji reads in text: ":nome:" for custom ones, the emoji itself otherwise. */
export function emojiLabel(e: string): string {
  const c = parseCustom(e);
  return c ? `:${c.name}:` : e;
}
