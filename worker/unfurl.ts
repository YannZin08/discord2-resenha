// Link previews: reads the page's Open Graph / Twitter tags, like Discord's embeds.

export interface Embed {
  url: string;
  /** `track`: Nox's compact song card (small cover, label, title, artist · who asked). */
  type: 'link' | 'image' | 'video' | 'track';
  /** Small line above a track's title: "Tocando agora", "Na fila · 2º"… */
  label?: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  color?: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined;
  const out = s
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
  if (!out) return undefined;
  return out.length > max ? out.slice(0, max - 1) + '…' : out;
}

export async function unfurl(url: string): Promise<Embed | null> {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; ResenhaBot/1.0; +link-preview)',
      accept: 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5',
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) {
    await res.body?.cancel();
    return null;
  }
  const type = res.headers.get('content-type') ?? '';
  if (type.startsWith('image/')) {
    await res.body?.cancel();
    return { url, type: 'image', image: url };
  }
  if (type.startsWith('video/')) {
    await res.body?.cancel();
    return { url, type: 'video' };
  }
  if (!type.includes('html')) {
    await res.body?.cancel();
    return null;
  }

  const meta: Record<string, string> = {};
  let title = '';
  let inHead = true;
  const rewriter = new HTMLRewriter()
    .on('meta', {
      element(el) {
        const k = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase();
        const v = el.getAttribute('content');
        if (k && v && !(k in meta)) meta[k] = v;
      },
    })
    .on('title', {
      text(t) {
        if (inHead && title.length < 400) title += t.text;
      },
    })
    .on('body', {
      element() {
        inHead = false;
      },
    });
  await rewriter.transform(res).arrayBuffer();

  const abs = (u: string | undefined) => {
    if (!u) return undefined;
    try {
      return new URL(decode(u, 2000)!, res.url || url).toString();
    } catch {
      return undefined;
    }
  };
  const embed: Embed = {
    url,
    type: 'link',
    title: decode(meta['og:title'] || meta['twitter:title'] || title, 256),
    description: decode(meta['og:description'] || meta['twitter:description'] || meta['description'], 350),
    siteName: decode(meta['og:site_name'], 100),
    image: abs(meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src']),
    color: /^#[0-9a-f]{6}$/i.test(meta['theme-color'] ?? '') ? meta['theme-color'] : undefined,
  };
  if (!embed.title && !embed.description && !embed.image) return null;
  return embed;
}
