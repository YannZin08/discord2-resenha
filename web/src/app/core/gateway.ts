import { Injectable, signal } from '@angular/core';
import { Store } from './store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpListener = (msg: any) => void;

const IDLE_AFTER = 10 * 60_000;

/** The real-time connection: receives events, sends typing/voice/signaling ops. */
@Injectable({ providedIn: 'root' })
export class Gateway {
  readonly state = signal<'idle' | 'connecting' | 'open' | 'reconnecting'>('idle');
  private ws: WebSocket | null = null;
  private retries = 0;
  private stopped = true;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private ops = new Map<string, Set<OpListener>>();
  private lastActivity = Date.now();
  private idle = false;
  onUnauthorized: (() => void) | null = null;

  constructor(private store: Store) {
    const activity = () => {
      this.lastActivity = Date.now();
      if (this.idle) this.setIdle(false);
    };
    for (const ev of ['mousemove', 'keydown', 'mousedown', 'touchstart', 'focus']) window.addEventListener(ev, activity, { passive: true });
    setInterval(() => {
      if (!this.idle && Date.now() - this.lastActivity > IDLE_AFTER) this.setIdle(true);
    }, 30_000);
  }

  onOp(op: string, fn: OpListener): () => void {
    const set = this.ops.get(op) ?? new Set();
    set.add(fn);
    this.ops.set(op, set);
    return () => set.delete(fn);
  }

  connect() {
    this.stopped = false;
    this.open();
  }

  disconnect() {
    this.stopped = true;
    this.cleanup();
    this.ws?.close(1000);
    this.ws = null;
    this.state.set('idle');
  }

  send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setIdle(idle: boolean) {
    this.idle = idle;
    this.send({ op: 'idle', idle });
  }

  private open() {
    this.cleanup();
    this.state.set(this.retries ? 'reconnecting' : 'connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/gateway`);
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.heartbeat = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send('ping');
        this.pongTimeout ??= setTimeout(() => ws.close(4000, 'heartbeat timeout'), 15_000);
      }, 30_000);
    };

    ws.onmessage = (e) => {
      if (e.data === 'pong') {
        if (this.pongTimeout) clearTimeout(this.pongTimeout);
        this.pongTimeout = null;
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let msg: any;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.op === 'ready') {
        this.retries = 0;
        this.state.set('open');
        this.store.loadReady(msg.d);
        if (this.idle) this.send({ op: 'idle', idle: true });
      } else if (msg.op === 'event') {
        this.store.dispatch(msg.t, msg.d);
      }
      for (const fn of this.ops.get(msg.op) ?? []) fn(msg);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.cleanup();
      if (this.stopped) return;
      this.state.set('reconnecting');
      if (!opened) {
        // Could be an expired session: let the app check before retrying.
        void fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => {
          if (r.status === 401) this.onUnauthorized?.();
        });
      }
      const delay = Math.min(1000 * 2 ** this.retries, 15_000) + Math.random() * 500;
      this.retries++;
      this.reconnectTimer = setTimeout(() => this.open(), delay);
    };
  }

  private cleanup() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.pongTimeout) clearTimeout(this.pongTimeout);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeat = null;
    this.pongTimeout = null;
    this.reconnectTimer = null;
  }
}
