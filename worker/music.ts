// Built-in music bot helpers: command parsing and YouTube lookups.
// Playback happens in each listener's browser through YouTube's official embedded
// player, kept in sync by the server — the only allowed way to play YouTube on a site.

export interface Track {
  videoId: string;
  url: string;
  title: string;
  author: string;
  thumbnail: string;
  requestedBy: number;
}

export interface MusicState {
  guildId: number;
  voiceChannelId: number;
  textChannelId: number;
  queue: Track[];
  index: number;
  /** Epoch ms at which the current track would have been at position 0. */
  startedAt: number;
  pausedAt: number | null;
}

export type MusicCommand =
  | { cmd: 'play'; query: string }
  | { cmd: 'skip' | 'pause' | 'resume' | 'stop' | 'queue' | 'now' | 'help' };

const ALIASES: Record<string, MusicCommand['cmd']> = {
  tocar: 'play',
  play: 'play',
  p: 'play',
  pular: 'skip',
  skip: 'skip',
  s: 'skip',
  proxima: 'skip',
  próxima: 'skip',
  pausar: 'pause',
  pause: 'pause',
  continuar: 'resume',
  resume: 'resume',
  retomar: 'resume',
  parar: 'stop',
  stop: 'stop',
  sair: 'stop',
  leave: 'stop',
  fila: 'queue',
  queue: 'queue',
  q: 'queue',
  tocando: 'now',
  np: 'now',
  agora: 'now',
  ajuda: 'help',
  help: 'help',
  musica: 'help',
  música: 'help',
};

/** "/tocar xyz", "!play xyz" … → a command, or null if the message isn't one. */
export function parseCommand(content: string): MusicCommand | null {
  const m = content.trim().match(/^[/!]([\p{L}]+)(?:\s+([\s\S]*))?$/u);
  if (!m) return null;
  const cmd = ALIASES[m[1].toLowerCase()];
  if (!cmd) return null;
  if (cmd === 'play') return { cmd, query: (m[2] ?? '').trim() };
  return { cmd };
}

export function youtubeId(text: string): string | null {
  const m = text.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/|music\.youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/);
  return m ? m[1] : null;
}

/** First result of a YouTube search, read from the public results page (no API key). */
async function searchYouTube(query: string): Promise<string | null> {
  const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=pt-BR`, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'accept-language': 'pt-BR,pt;q=0.9' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  return html.match(/"videoRenderer":\{"videoId":"([\w-]{11})"/)?.[1] ?? html.match(/"videoId":"([\w-]{11})"/)?.[1] ?? null;
}

/** Resolves a link or search text into a playable track, or a reason it can't be played. */
export async function resolveTrack(query: string, requestedBy: number): Promise<Track | { error: string }> {
  let id = youtubeId(query);
  if (!id && /^https?:\/\//i.test(query)) return { error: 'Por enquanto eu só toco links do YouTube.' };
  if (!id) {
    try {
      id = await searchYouTube(query);
    } catch {
      id = null;
    }
    if (!id) return { error: `Não encontrei nada para "${query}". Tente mandar o link do YouTube.` };
  }
  const url = `https://www.youtube.com/watch?v=${id}`;
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal: AbortSignal.timeout(6000) });
    if (res.status === 401 || res.status === 403) return { error: 'O dono desse vídeo não permite tocá-lo fora do YouTube.' };
    if (!res.ok) return { error: 'Esse vídeo não existe ou é privado.' };
    const data = await res.json<{ title?: string; author_name?: string; thumbnail_url?: string }>();
    return {
      videoId: id,
      url,
      title: data.title ?? 'Vídeo do YouTube',
      author: data.author_name ?? '',
      thumbnail: data.thumbnail_url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      requestedBy,
    };
  } catch {
    return { error: 'Não consegui falar com o YouTube agora. Tente de novo.' };
  }
}

export const HELP = [
  '**Comandos de música** (use `/` ou `!`):',
  '`/tocar <link ou nome>` — toca do YouTube ou põe na fila',
  '`/pular` — pula para a próxima',
  '`/pausar` · `/continuar`',
  '`/fila` — mostra a fila',
  '`/tocando` — o que está tocando',
  '`/parar` — para e sai do canal',
  'Entre em um canal de voz antes de pedir uma música.',
].join('\n');

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
