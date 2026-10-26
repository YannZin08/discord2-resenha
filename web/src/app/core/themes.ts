// Theme ids match the [data-theme] blocks in styles.css.

export interface Theme {
  id: string;
  label: string;
  group: 'base' | 'color';
  /** What the picker circle shows. */
  swatch: string;
  /** Browser/OS title bar color. */
  bar: string;
}

export const THEMES: Theme[] = [
  { id: 'light', label: 'Claro', group: 'base', swatch: '#ffffff', bar: '#e3e5e8' },
  { id: 'ash', label: 'Cinza', group: 'base', swatch: '#393a41', bar: '#26272c' },
  { id: 'dark', label: 'Escuro', group: 'base', swatch: '#313338', bar: '#1e1f22' },
  { id: 'onyx', label: 'Meia-noite', group: 'base', swatch: '#000000', bar: '#000000' },
  { id: 'aurora', label: 'Aurora', group: 'color', swatch: 'linear-gradient(135deg, #0b1f4d, #1b2f9e 50%, #0f7fa8)', bar: '#0b1f4d' },
  { id: 'sunset', label: 'Pôr do sol', group: 'color', swatch: 'linear-gradient(135deg, #3b1d6e, #8a3b6b 55%, #c2673c)', bar: '#3b1d6e' },
  { id: 'forest', label: 'Floresta', group: 'color', swatch: 'linear-gradient(160deg, #0f1f14, #1f3b2a 55%, #3a4a2a)', bar: '#0f1f14' },
  { id: 'ocean', label: 'Oceano', group: 'color', swatch: 'linear-gradient(160deg, #0b2233, #0e4a5c 55%, #13777a)', bar: '#0b2233' },
  { id: 'crimson', label: 'Lua carmesim', group: 'color', swatch: 'linear-gradient(160deg, #1a0000, #5c0a0a 60%, #8f1d1d)', bar: '#1a0000' },
  { id: 'neon', label: 'Neon', group: 'color', swatch: 'linear-gradient(135deg, #0a3d3a, #3c2f7a 50%, #6e1f5e)', bar: '#0a3d3a' },
  { id: 'candy', label: 'Algodão-doce', group: 'color', swatch: 'linear-gradient(135deg, #f7c6d0, #d9d3fb 50%, #b9d4fb)', bar: '#f7c6d0' },
];

export function applyTheme(id: string, chatFont: number) {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[2];
  const root = document.documentElement;
  root.dataset['theme'] = theme.id;
  root.style.setProperty('--chat-font', `${chatFont}px`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bar);
}
