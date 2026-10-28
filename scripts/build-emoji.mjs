// Generates web/public/emoji.json: every Unicode emoji (Emoji 17, drawn by Twemoji 17) with
// Discord-style shortcodes and Portuguese search words. Run after updating emojibase-data:
//   node scripts/build-emoji.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const data = require('emojibase-data/pt/data.json');
const iamcal = require('emojibase-data/en/shortcodes/iamcal.json');
const github = require('emojibase-data/en/shortcodes/github.json');
const base = require('emojibase-data/en/shortcodes/emojibase.json');
const ptCodes = require('emojibase-data/pt/shortcodes/cldr.json');

// Emoji groups from emojibase → the picker's categories (2, "component", is skin tones and hair).
const CATS = [
  [0, 'smileys', 'Carinhas e emoções', '😀'],
  [1, 'people', 'Pessoas e corpo', '👋'],
  [3, 'nature', 'Animais e natureza', '🐶'],
  [4, 'food', 'Comidas e bebidas', '🍔'],
  [6, 'activities', 'Atividades', '⚽'],
  [5, 'travel', 'Viagens e lugares', '🚗'],
  [7, 'objects', 'Objetos', '💡'],
  [8, 'symbols', 'Símbolos', '❤️'],
  [9, 'flags', 'Bandeiras', '🏁'],
];

// The hand-written list in emoji.ts has Brazilian slang ("kkk", "flw") and the names people
// already use (:flag_br:); keep them as extra names and search words.
const curated = new Map();
const src = readFileSync(new URL('../web/src/app/core/emoji.ts', import.meta.url), 'utf8');
for (const line of src.split('\n')) {
  const m = line.trim().match(/^`?(\S+) ([a-z0-9_+-]+)(?: (.*))?$/u);
  if (m && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(m[1])) curated.set(m[1].replace(/️/g, ''), { name: m[2], words: m[3] ?? '' });
}

const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const taken = new Set();
const out = CATS.map(([group, id, label, icon]) => ({ id, label, icon, emojis: [] }));

for (const e of [...data].sort((a, b) => a.order - b.order)) {
  const cat = out[CATS.findIndex(([g]) => g === e.group)];
  if (!cat) continue;
  const old = curated.get(e.emoji.replace(/️/g, ''));
  const names = [...new Set([...(old ? [old.name] : []), ...list(github[e.hexcode]), ...list(iamcal[e.hexcode]), ...list(base[e.hexcode]), ...list(ptCodes[e.hexcode])])]
    .map((n) => n.toLowerCase().replace(/[^a-z0-9_+-]/g, '_'))
    .filter((n) => n.length >= 2 && !taken.has(n))
    // The main name is a word (":thumbsup:", not ":+1:").
    .sort((a, b) => Number(!/^[a-z][a-z0-9_]*$/.test(a)) - Number(!/^[a-z][a-z0-9_]*$/.test(b)));
  if (!names.length) continue;
  names.forEach((n) => taken.add(n));
  const words = [e.label, ...(e.tags ?? []), old?.words ?? ''].join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
  const row = [e.emoji, names[0], names.slice(1).join(' '), words];
  // Five skin tones, light to dark (only single-person emojis; mixed tones stay out).
  const skins = (e.skins ?? []).filter((s) => !Array.isArray(s.tone)).map((s) => s.emoji);
  if (skins.length === 5) row.push(skins);
  cat.emojis.push(row);
}

const dest = new URL('../web/public/emoji.json', import.meta.url);
writeFileSync(dest, JSON.stringify({ version: 17, categories: out }));
console.log(`${out.reduce((n, c) => n + c.emojis.length, 0)} emojis → web/public/emoji.json`);
