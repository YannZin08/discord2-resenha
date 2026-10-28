/** Most an avatar or profile banner can weigh (the server checks it too). */
export const MAX_PROFILE_IMAGE = 10 * 1024 * 1024;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Não foi possível ler essa imagem.'));
    i.src = url;
  });
}

/** Crops the image's center to w:h and scales it down to at most w×h. GIFs keep their animation. */
async function cropImage(file: File, w: number, h: number, type: string): Promise<Blob> {
  if (file.type === 'image/gif') return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(img.naturalWidth / w, img.naturalHeight / h);
    const sw = w * scale;
    const sh = h * scale;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(Math.min(w, sw));
    canvas.height = Math.round(Math.min(h, sh));
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao processar a imagem.'))), type, 0.9),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Center-crops an image to a square and scales it down (avatars, server icons). GIFs keep their animation. */
export function squareImage(file: File, size = 256): Promise<Blob> {
  return cropImage(file, size, size, 'image/png');
}

/** Profile banners: 17:6 like Discord's (680×240, kept sharp at 2×). GIFs keep their animation. */
export function bannerImage(file: File): Promise<Blob> {
  return cropImage(file, 1360, 480, 'image/webp');
}

/** Most a custom emoji can weigh (the server checks it too). */
export const MAX_EMOJI_IMAGE = 2 * 1024 * 1024;

/** Custom emojis: scaled down to fit 128×128 without cropping. GIFs keep their animation. */
export async function emojiImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif') return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 128 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao processar a imagem.'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Several images at once (custom emojis). */
export function pickImages(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}

export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
