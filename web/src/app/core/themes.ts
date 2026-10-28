// Base theme ids match the [data-theme] blocks in styles.css. Colored themes share one
// CSS block per tone ([data-tone]) and bring their own colors from here.

export interface Theme {
  id: string;
  label: string;
  group: 'base' | 'color';
  /** What the picker circle shows (the gradient itself for colored themes). */
  swatch: string;
  /** Browser/OS title bar color. */
  bar: string;
  /** Colored themes: dark or light text over the gradient. */
  tone?: 'dark' | 'light';
  /** Solid backgrounds for windows and popouts, which can't be see-through. */
  modal?: string;
  popout?: string;
}

const color = (id: string, label: string, gradient: string, modal: string, popout: string, tone: 'dark' | 'light' = 'dark'): Theme => ({
  id,
  label,
  group: 'color',
  swatch: gradient,
  bar: gradient.match(/#[0-9a-f]{6}/i)![0],
  tone,
  modal,
  popout,
});

export const THEMES: Theme[] = [
  { id: 'light', label: 'Claro', group: 'base', swatch: '#ffffff', bar: '#e3e5e8' },
  { id: 'ash', label: 'Cinza', group: 'base', swatch: '#393a41', bar: '#26272c' },
  { id: 'dark', label: 'Escuro', group: 'base', swatch: '#313338', bar: '#1e1f22' },
  { id: 'onyx', label: 'Meia-noite', group: 'base', swatch: '#000000', bar: '#000000' },
  color('aurora', 'Aurora', 'linear-gradient(135deg, #0b1f4d, #1b2f9e 50%, #0f7fa8)', '#111a3a', '#0d1530'),
  color('sunset', 'Pôr do sol', 'linear-gradient(135deg, #3b1d6e, #8a3b6b 55%, #c2673c)', '#2b1840', '#231334'),
  color('forest', 'Floresta', 'linear-gradient(160deg, #0f1f14, #1f3b2a 55%, #3a4a2a)', '#15241a', '#101c14'),
  color('ocean', 'Oceano', 'linear-gradient(160deg, #0b2233, #0e4a5c 55%, #13777a)', '#0e2a38', '#0a212d'),
  color('crimson', 'Lua carmesim', 'linear-gradient(160deg, #1a0000, #5c0a0a 60%, #8f1d1d)', '#2a0808', '#200505'),
  color('neon', 'Neon', 'linear-gradient(135deg, #0a3d3a, #3c2f7a 50%, #6e1f5e)', '#1f2340', '#191c34'),
  color('lavender', 'Lavanda', 'linear-gradient(135deg, #241a45, #4a3a8f 55%, #7b5ec4)', '#241c42', '#1d1636'),
  color('galaxy', 'Galáxia', 'linear-gradient(160deg, #0d0221, #2a0f5a 50%, #6a1b9a)', '#1a0b38', '#140830'),
  color('synthwave', 'Synthwave', 'linear-gradient(135deg, #1a0b3d, #7a1f7a 55%, #e0457b)', '#2a1245', '#210e38'),
  color('ember', 'Brasa', 'linear-gradient(160deg, #1c0a02, #6b2208 55%, #b8460e)', '#2a1206', '#200d04'),
  color('golden', 'Dourado', 'linear-gradient(160deg, #1a1205, #4d3608 55%, #a37812)', '#261b07', '#1f1605'),
  color('toxic', 'Tóxico', 'linear-gradient(150deg, #0a1a05, #24470d 55%, #5c8a12)', '#13260b', '#0f1f08'),
  color('mint', 'Menta', 'linear-gradient(150deg, #0c2420, #1a4d43 55%, #2b7a62)', '#10302a', '#0c2622'),
  color('dusk', 'Crepúsculo', 'linear-gradient(160deg, #141e30, #243b55 55%, #3d5a80)', '#182436', '#131d2c'),
  color('steel', 'Aço', 'linear-gradient(160deg, #111418, #2a313b 55%, #4a5563)', '#1b2027', '#15191f'),
  color('coffee', 'Café', 'linear-gradient(160deg, #1b120c, #3d2817 55%, #6b4423)', '#26190f', '#1e140c'),
  color('candy', 'Algodão-doce', 'linear-gradient(135deg, #f7c6d0, #d9d3fb 50%, #b9d4fb)', '#fbf4fb', '#ffffff', 'light'),
  color('peach', 'Pêssego', 'linear-gradient(135deg, #ffe1c8, #ffd0bf 50%, #f7bfc6)', '#fff6f0', '#ffffff', 'light'),
  color('sky', 'Céu', 'linear-gradient(160deg, #cfe6ff, #e0edff 50%, #e7e0ff)', '#f6f9ff', '#ffffff', 'light'),
  color('lemon', 'Limonada', 'linear-gradient(135deg, #fbf1b0, #e2f5c2 50%, #c4eedb)', '#fbfdf3', '#ffffff', 'light'),
  color('lilac', 'Lilás', 'linear-gradient(135deg, #e6d8fc, #f3dff6 50%, #dbe2fb)', '#f8f4fd', '#ffffff', 'light'),
];

/** Accent colors for buttons, links in focus and mentions; null keeps the theme's own. */
export const ACCENTS = ['#5865f2', '#3ba55c', '#1abc9c', '#00a8fc', '#9b59b6', '#eb459f', '#ed4245', '#e67e22', '#f0b232', '#747f8d'];

export function applyTheme(id: string, chatFont: number, accent: string | null) {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[2];
  const root = document.documentElement;
  root.dataset['theme'] = theme.id;
  if (theme.tone) root.dataset['tone'] = theme.tone === 'light' ? 'color-light' : 'color';
  else delete root.dataset['tone'];
  const vars: Record<string, string | null> = {
    '--chat-font': `${chatFont}px`,
    '--app-gradient': theme.group === 'color' ? theme.swatch : null,
    '--bg-modal': theme.modal ?? null,
    '--bg-popout': theme.popout ?? null,
    '--brand': accent,
    '--brand-hover': accent && `color-mix(in srgb, ${accent} 82%, black)`,
    '--brand-active': accent && `color-mix(in srgb, ${accent} 70%, black)`,
    '--mention-bg': accent && `color-mix(in srgb, ${accent} 30%, transparent)`,
    '--mention-fg': accent && `color-mix(in srgb, ${accent} ${theme.tone === 'light' || theme.id === 'light' ? '70%, black' : '45%, white'})`,
  };
  for (const [k, v] of Object.entries(vars)) {
    if (v) root.style.setProperty(k, v);
    else root.style.removeProperty(k);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bar);
}
