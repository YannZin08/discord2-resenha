// Discord-flavored markdown → HTML. Everything is escaped first; only the tags
// produced here end up in the output, so it is safe to bind as trusted HTML.

const TWEMOJI = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.2/assets/svg/';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

const EMOJI_SRC =
  '\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3|(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F)\\p{Emoji_Modifier}?(?:\\u200D\\p{Extended_Pictographic}\\uFE0F?\\p{Emoji_Modifier}?)*';
const EMOJI_RE = new RegExp(EMOJI_SRC, 'gu');
const ONLY_EMOJI_RE = new RegExp(`^(?:\\s|${EMOJI_SRC})+$`, 'u');
/** A server's own emoji in a message: <:nome:id>, or <a:nome:id> when animated. */
const CUSTOM_RE = /<a?:([A-Za-z0-9_]{2,32}):(\d{1,20})>/g;

export function twemojiUrl(emoji: string): string {
  const s = emoji.includes('‍') ? emoji : emoji.replace(/️/g, '');
  return TWEMOJI + [...s].map((c) => c.codePointAt(0)!.toString(16)).join('-') + '.svg';
}

export function emojiImg(emoji: string, cls = 'emoji'): string {
  return `<img class="${cls}" alt="${escapeHtml(emoji)}" draggable="false" src="${twemojiUrl(emoji)}">`;
}

export function emojify(escaped: string, cls = 'emoji'): string {
  return escaped.replace(EMOJI_RE, (e) => emojiImg(e, cls));
}

export interface RenderContext {
  userName(id: number): string | null;
  channelName(id: number): string | null;
  meId?: number;
}

function inline(t: string): string {
  return t
    .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/\*([^\s*](?:.*?[^\s*])?)\*/g, '<em>$1</em>')
    .replace(/(^|[^\p{L}\p{N}_])_([^_]+?)_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>');
}

export function renderMarkdown(src: string, ctx: RenderContext): string {
  const slots: string[] = [];
  const hold = (html: string) => `${slots.push(html) - 1}`;
  const attr = (s: string) => escapeHtml(s);
  const link = (url: string, text: string) =>
    hold(`<a href="${attr(url)}" target="_blank" rel="noopener noreferrer" title="${attr(url)}">${text}</a>`);

  let s = src;
  s = s.replace(/```(?:([\w+#.-]{1,20})\n)?([\s\S]*?)```/g, (_, _lang: string | undefined, code: string) =>
    hold(`<pre class="codeblock"><code>${escapeHtml(code.replace(/^\n+|\n+$/g, ''))}</code></pre>`),
  );
  s = s.replace(/``([^`]+?)``|`([^`\n]+?)`/g, (_, a: string | undefined, b: string | undefined) =>
    hold(`<code class="inline">${escapeHtml(a ?? b ?? '')}</code>`),
  );
  s = s.replace(/\\([*_~`|>\\[\]()#-])/g, (_, c: string) => hold(escapeHtml(c)));
  s = s.replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g, (_, text: string, url: string) => link(url, escapeHtml(text)));
  s = s.replace(/<(https?:\/\/[^\s>]+)>|(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g, (_, a: string | undefined, b: string | undefined) => {
    const url = (a ?? b)!;
    return link(url, escapeHtml(url));
  });
  s = s.replace(/<@(\d+)>/g, (_, id: string) => {
    const name = ctx.userName(+id);
    const me = ctx.meId === +id ? ' me' : '';
    return hold(`<span class="mention${me}" data-user="${id}">@${escapeHtml(name ?? 'usuário-desconhecido')}</span>`);
  });
  s = s.replace(/<#(\d+)>/g, (_, id: string) => {
    const name = ctx.channelName(+id);
    return hold(`<span class="mention channel" data-channel="${id}">#${escapeHtml(name ?? 'canal-excluído')}</span>`);
  });
  s = s.replace(/@(everyone|here)\b/g, (m) => hold(`<span class="mention">${m}</span>`));
  s = s.replace(CUSTOM_RE, (_, name: string, id: string) =>
    hold(`<img class="emoji custom" alt=":${name}:" title=":${name}:" draggable="false" src="/api/emojis/${id}">`),
  );

  s = escapeHtml(s);

  const lines = s.split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(para.map(inline).join('<br>'));
    para = [];
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);
    quote = [];
  };
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`);
    list = [];
  };
  const flushAll = () => {
    flushPara();
    flushQuote();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('&gt;&gt;&gt; ')) {
      flushAll();
      quote = [line.slice(13), ...lines.slice(i + 1)];
      break;
    }
    const q = line.match(/^&gt; ?(.*)$/);
    if (q && (line.startsWith('&gt; ') || line === '&gt;')) {
      flushPara();
      flushList();
      quote.push(q[1]);
      continue;
    }
    flushQuote();
    const h = line.match(/^(#{1,3}) (.+)$/);
    if (h) {
      flushAll();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    const li = line.match(/^\s*[-*] (.+)$/);
    if (li) {
      flushPara();
      list.push(li[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushAll();

  let html = out.join('');
  html = emojify(html);
  const restore = (h: string): string => h.replace(/(\d+)/g, (_, n: string) => restore(slots[+n]));
  return restore(html);
}

/** Messages made of only a few emojis are shown big, like Discord. */
export function isJumbo(content: string): boolean {
  const t = content.trim();
  const custom = t.match(CUSTOM_RE)?.length ?? 0;
  const rest = t.replace(CUSTOM_RE, '').trim();
  if (rest ? !ONLY_EMOJI_RE.test(rest) : !custom) return false;
  return custom + (rest.match(EMOJI_RE)?.length ?? 0) <= 27;
}

/** Message text for places without images (notifications): <:nome:id> reads as :nome:. */
export function plainEmojis(text: string): string {
  return text.replace(CUSTOM_RE, ':$1:');
}
