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
  /** Songs in a row the player couldn't play; past a few, the bot stops. */
  failures?: number;
  /** Whether some listener's player started the current song, and its length in seconds. */
  playing?: boolean;
  duration?: number | null;
}

/** Why YouTube's embedded player refused a video, from its onError code. */
export function playerError(code: unknown): string {
  if (code === 101 || code === 150) return 'o dono não permite tocar fora do YouTube';
  if (code === 100) return 'o vídeo foi removido ou é privado';
  if (code === 2) return 'o link do vídeo é inválido';
  return typeof code === 'number' ? `o player do YouTube deu o erro ${code}` : 'o player do YouTube deu erro';
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

/** The `list=` of a YouTube or YouTube Music link (playlist, album, mix). */
export function playlistId(text: string): string | null {
  const m = text.match(/(?:youtube\.com|youtu\.be)\/\S*?[?&]list=([\w-]+)/);
  return m ? m[1] : null;
}

/**
 * Mixes ("RD…") are made up for whoever opened them and can't be listed, except
 * YouTube Music's curated playlists (RDCLAK…). A song link from YouTube Music
 * usually carries one (`watch?v=…&list=RDAMVM…`), so those play just the song.
 */
export function isMix(list: string): boolean {
  return list.startsWith('RD') && !list.startsWith('RDCLAK');
}

const YT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9',
};

/** Most songs one playlist adds to the queue. */
export const MAX_PLAYLIST = 500;

/** First result of a YouTube search, read from the public results page (no API key). */
async function searchYouTube(query: string): Promise<string | null> {
  const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=pt-BR`, {
    headers: YT_HEADERS,
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

function playlistTrack(videoId: string, title: string | undefined, author: string | undefined, requestedBy: number): Track {
  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: title || 'Vídeo do YouTube',
    author: author ?? '',
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    requestedBy,
  };
}

/**
 * Walks YouTube's page data for the playlist's videos and the token for the next page.
 * Handles the current layout (lockupViewModel) and the older one (playlistVideoRenderer).
 */
function collectPlaylist(node: any, requestedBy: number, out: Track[], next: string[]) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const v of node) collectPlaylist(v, requestedBy, out, next);
    return;
  }
  const lockup = node.lockupViewModel;
  if (lockup?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && lockup.contentId) {
    const meta = lockup.metadata?.lockupMetadataViewModel;
    const author = meta?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content;
    out.push(playlistTrack(lockup.contentId, meta?.title?.content, author, requestedBy));
    return;
  }
  const old = node.playlistVideoRenderer;
  if (old?.videoId) {
    if (old.isPlayable !== false) out.push(playlistTrack(old.videoId, old.title?.runs?.[0]?.text, old.shortBylineText?.runs?.[0]?.text, requestedBy));
    return;
  }
  if (node.continuationItemRenderer || node.continuationItemViewModel) {
    const token = JSON.stringify(node).match(/"token":"([^"]+)"/)?.[1];
    if (token) next.push(token);
    return;
  }
  for (const v of Object.values(node)) collectPlaylist(v, requestedBy, out, next);
}

/**
 * Reads a public or unlisted YouTube / YouTube Music playlist (or album) from its
 * public page, then the following pages (100 songs each), up to MAX_PLAYLIST.
 * `startAt` is the song the link pointed to, if any: the queue starts there.
 */
export async function resolvePlaylist(
  list: string,
  startAt: string | null,
  requestedBy: number,
): Promise<{ title: string; tracks: Track[]; truncated: boolean } | { error: string }> {
  const privateHelp = 'No YouTube Music, deixe a playlist como **Pública** ou **Não listada** e mande o link de novo.';
  if (list === 'LM' || list === 'LL') return { error: `"Músicas curtidas" é uma lista privada e eu não consigo vê-la. Crie uma playlist com elas. ${privateHelp}` };
  if (isMix(list)) {
    // "Radio" of a playlist: play the playlist itself.
    if (!list.startsWith('RDAMPL')) return { error: 'Esse é um mix automático do YouTube, que só existe para quem o abriu. Mande o link de uma playlist ou de uma música.' };
    list = list.slice('RDAMPL'.length);
  }
  try {
    const res = await fetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(list)}&hl=pt-BR`, { headers: YT_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { error: 'Não consegui falar com o YouTube agora. Tente de novo.' };
    const html = await res.text();
    const raw = html.match(/var ytInitialData = (\{.*?\});<\/script>/s)?.[1];
    if (!raw) return { error: 'Não consegui ler essa playlist (o YouTube pode ter mudado a página). Enquanto isso, mande as músicas uma por uma.' };
    const data = JSON.parse(raw);
    const blocked = (data.alerts ?? []).some((a: { alertRenderer?: { type?: string } }) => a.alertRenderer?.type === 'ERROR');
    if (blocked) return { error: `Não consegui abrir essa playlist: ela é privada ou não existe mais. ${privateHelp}` };
    const title: string = data.metadata?.playlistMetadataRenderer?.title ?? 'Playlist do YouTube';
    const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? '2.20261026.01.00';

    const tracks: Track[] = [];
    let next: string[] = [];
    collectPlaylist(data.contents, requestedBy, tracks, next);
    // Stop once there are enough songs after the starting one.
    const enough = () => {
      const from = startAt ? tracks.findIndex((t) => t.videoId === startAt) : 0;
      return tracks.length - Math.max(0, from) > MAX_PLAYLIST;
    };
    for (let page = 0; next.length && !enough() && page < 10; page++) {
      const r = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
        method: 'POST',
        headers: { ...YT_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion, hl: 'pt-BR' } }, continuation: next[0] }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) break; // keep what was read so far
      next = [];
      collectPlaylist((await r.json<{ onResponseReceivedActions?: unknown }>()).onResponseReceivedActions, requestedBy, tracks, next);
    }

    const from = startAt ? tracks.findIndex((t) => t.videoId === startAt) : -1;
    const fromStart = from > 0 ? tracks.slice(from) : tracks;
    if (!fromStart.length) return { error: 'Essa playlist está vazia, ou todas as músicas dela estão indisponíveis.' };
    return { title, tracks: fromStart.slice(0, MAX_PLAYLIST), truncated: fromStart.length > MAX_PLAYLIST || next.length > 0 };
  } catch {
    return { error: 'Não consegui falar com o YouTube agora. Tente de novo.' };
  }
}

export const HELP = [
  '**Comandos de música** (use `/` ou `!`):',
  '`/tocar <link ou nome>` — toca do YouTube ou põe na fila',
  '`/tocar <link de playlist ou álbum>` — põe a playlist inteira na fila (YouTube ou YouTube Music)',
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
