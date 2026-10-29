/** How long a finger rests on something before it counts as a long press. */
const HOLD_MS = 450;
/** Moving more than this (px) means scrolling, not pressing. */
const SLOP = 10;

/**
 * On touch screens a long press does what a right click does: it sends a `contextmenu`
 * event to whatever is under the finger, so every (contextmenu) menu in the app works.
 * iOS never fires one by itself, and Android's comes late and also selects text.
 */
export function enableLongPress() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  let fired = false;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    start = null;
  };

  document.addEventListener(
    'touchstart',
    (e) => {
      cancel();
      fired = false;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const target = e.target;
      if (!(target instanceof Element) || target.closest('input, textarea, [contenteditable="true"], video, input[type="range"]')) return;
      start = { x: t.clientX, y: t.clientY };
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY, view: window }));
        navigator.vibrate?.(10);
      }, HOLD_MS);
    },
    { passive: true },
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      const t = e.touches[0];
      if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > SLOP) cancel();
    },
    { passive: true },
  );

  document.addEventListener(
    'touchend',
    (e) => {
      cancel();
      // The press already opened a menu: the finger lifting must not also click what's under it.
      if (fired && e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener('touchcancel', cancel, { passive: true });

  // Android's own long-press event: ours already ran, or it comes first and ours is dropped.
  document.addEventListener(
    'contextmenu',
    (e) => {
      if (!e.isTrusted || !matchMedia('(hover: none)').matches) return;
      if (fired) {
        e.preventDefault();
        e.stopPropagation();
      } else {
        cancel();
        fired = true;
      }
    },
    true,
  );
}
