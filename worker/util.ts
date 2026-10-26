// IDs are time-ordered ("snowflake"-style): sorting by id is sorting by creation time.
export const EPOCH = Date.UTC(2026, 0, 1);
let lastMs = 0;
let seq = 0;

export function newId(): number {
  let ms = Date.now() - EPOCH;
  if (ms <= lastMs) {
    ms = lastMs;
    seq++;
    if (seq >= 4096) {
      ms++;
      seq = 0;
    }
  } else {
    seq = 0;
  }
  lastMs = ms;
  return ms * 4096 + seq;
}

export function idTime(id: number): number {
  return Math.floor(id / 4096) + EPOCH;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}

export function randomHex(bytes = 16): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export function randomCode(len = 8): string {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return [...a].map((b) => BASE62[b % 62]).join('');
}

const PBKDF2_ITERATIONS = 100_000;

async function derive(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return { hash: b64url(await derive(password, salt)), salt: b64url(salt) };
}

export async function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
  const got = new Uint8Array(await derive(password, fromB64url(salt)));
  const want = fromB64url(hash);
  if (got.byteLength !== want.byteLength) return false;
  return crypto.subtle.timingSafeEqual(got, want);
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function str(v: unknown, field: string, min: number, max: number): string {
  if (typeof v !== 'string') throw new HttpError(400, `${field} inválido.`);
  const s = v.trim();
  if (s.length < min || s.length > max) {
    throw new HttpError(400, min > 0 ? `${field} deve ter entre ${min} e ${max} caracteres.` : `${field} pode ter no máximo ${max} caracteres.`);
  }
  return s;
}

export function toId(v: unknown): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, 'ID inválido.');
  return n;
}

export function color(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) throw new HttpError(400, 'Cor inválida.');
  return v.toLowerCase();
}
