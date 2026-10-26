import { Injectable, computed, effect, signal, untracked } from '@angular/core';
import { Api } from './api';
import { Gateway } from './gateway';
import { Prefs } from './prefs';
import { sounds } from './sounds';
import { Store } from './store';
import { Ui } from './ui';

interface MediaInfo {
  camera: string | null;
  screen: string | null;
}

interface Peer {
  sid: string;
  userId: number;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  micAudio: HTMLAudioElement;
  screenAudio: HTMLAudioElement;
  streams: Map<string, MediaStream>;
  media: MediaInfo;
  analyser: { node: AnalyserNode; data: Uint8Array<ArrayBuffer>; streamId: string } | null;
  senders: RTCRtpSender[];
  cameraSenders: RTCRtpSender[];
  screenSenders: RTCRtpSender[];
  /** Signals are applied one at a time, in arrival order (a candidate must wait for its description). */
  queue: Promise<void>;
}

export interface RemoteVideo {
  camera: MediaStream | null;
  screen: MediaStream | null;
}

const SPEAK_THRESHOLD = 14;

/**
 * Voice & video over WebRTC: a full mesh between everyone in the channel, with
 * signaling relayed by the server ("perfect negotiation" handles offer races).
 */
@Injectable({ providedIn: 'root' })
export class Voice {
  readonly channelId = signal<number | null>(null);
  readonly guildId = signal<number | null>(null);
  readonly active = signal(false);
  readonly mute = signal(false);
  readonly deaf = signal(false);
  readonly localCamera = signal<MediaStream | null>(null);
  readonly localScreen = signal<MediaStream | null>(null);
  readonly speaking = signal<ReadonlySet<number>>(new Set());
  readonly remoteVideo = signal<Record<string, RemoteVideo>>({});
  readonly peerStates = signal<Record<string, RTCPeerConnectionState>>({});
  readonly hasMic = signal(true);

  readonly connectionLabel = computed(() => {
    if (!this.channelId()) return '';
    if (!this.active()) return 'Conectando...';
    const states = Object.values(this.peerStates());
    if (states.some((s) => s === 'failed')) return 'Falha na conexão';
    if (states.some((s) => s === 'connecting' || s === 'new')) return 'Conectando ao RTC';
    return 'Voz conectada';
  });

  private mic: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private iceServers: RTCIceServer[] = [];
  private audioCtx: AudioContext | null = null;
  private localAnalyser: { node: AnalyserNode; data: Uint8Array<ArrayBuffer> } | null = null;
  private speakTimer: ReturnType<typeof setInterval> | null = null;
  private lastSpoke = new Map<number, number>();

  constructor(
    private store: Store,
    private gateway: Gateway,
    private api: Api,
    private prefs: Prefs,
    private ui: Ui,
  ) {
    this.mute.set(prefs.get('mute'));
    this.deaf.set(prefs.get('deaf'));

    // Keep one peer connection per other session in our channel.
    effect(() => {
      const states = this.store.voiceStates();
      const channelId = this.channelId();
      const active = this.active();
      const mySid = this.store.sessionId();
      untracked(() => {
        if (!active || !channelId || !mySid) return;
        const wanted = new Map<string, number>();
        for (const v of Object.values(states)) if (v.channelId === channelId && v.sessionId !== mySid) wanted.set(v.sessionId, v.userId);
        for (const [sid, uid] of wanted) if (!this.peers.has(sid)) this.createPeer(sid, uid);
        for (const sid of [...this.peers.keys()]) if (!wanted.has(sid)) this.closePeer(sid);
      });
    });

    gateway.onOp('rtc', (msg) => this.onSignal(msg.from, msg.fromUser, msg.data));
    gateway.onOp('voice_kicked', () => {
      this.teardown();
      sounds.leave();
    });
    // After a reconnect we have a new session: announce ourselves again.
    store.on('READY', () => {
      if (!this.channelId()) return;
      for (const sid of [...this.peers.keys()]) this.closePeer(sid);
      if (this.active()) this.sendState();
    });
    store.on('CHANNEL_DELETE', (d) => {
      if (d.id === this.channelId()) this.teardown();
    });
    store.on('GUILD_DELETE', (d) => {
      if (d.id === this.guildId()) this.teardown();
    });
  }

  // ------------------------------------------------------------------ public

  async join(channelId: number, guildId: number | null) {
    if (this.channelId() === channelId) return;
    if (this.channelId()) this.leave(false);
    sounds.unlock();
    this.channelId.set(channelId);
    this.guildId.set(guildId);
    try {
      const res = await this.api.get<{ iceServers: RTCIceServer[] }>('/voice/ice');
      this.iceServers = res.iceServers;
    } catch {
      this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }
    await this.startMic();
    if (this.channelId() !== channelId) return;
    this.active.set(true);
    this.sendState();
    if (this.prefs.get('sounds')) sounds.join();
    this.startSpeakingLoop();
  }

  leave(playSound = true) {
    if (!this.channelId()) return;
    this.gateway.send({ op: 'voice', channelId: null });
    this.teardown();
    if (playSound && this.prefs.get('sounds')) sounds.leave();
  }

  toggleMute() {
    if (this.deaf()) {
      this.deaf.set(false);
      this.mute.set(false);
    } else {
      this.mute.update((m) => !m);
    }
    this.afterAudioToggle(this.mute());
  }

  toggleDeaf() {
    this.deaf.update((d) => !d);
    this.afterAudioToggle(this.deaf());
  }

  private afterAudioToggle(off: boolean) {
    this.prefs.set('mute', this.mute());
    this.prefs.set('deaf', this.deaf());
    this.applyMute();
    this.applyOutput();
    if (this.prefs.get('sounds')) (off ? sounds.mute : sounds.unmute)();
    if (this.active()) this.sendState();
  }

  async toggleCamera() {
    if (this.localCamera()) {
      this.stopCamera();
      return;
    }
    try {
      const dev = this.prefs.get('videoDevice');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: dev !== 'default' ? { exact: dev } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      this.localCamera.set(stream);
      for (const p of this.peers.values()) {
        for (const t of stream.getVideoTracks()) p.cameraSenders.push(p.pc.addTrack(t, stream));
      }
      this.broadcastMedia();
      this.sendState();
    } catch {
      this.ui.toast('Não foi possível acessar a câmera.', 'error');
    }
  }

  async toggleScreen() {
    if (this.localScreen()) {
      this.stopScreen();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
      stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stopScreen());
      this.localScreen.set(stream);
      for (const p of this.peers.values()) {
        for (const t of stream.getTracks()) p.screenSenders.push(p.pc.addTrack(t, stream));
      }
      this.broadcastMedia();
      this.sendState();
    } catch (e) {
      if ((e as DOMException)?.name !== 'NotAllowedError') this.ui.toast('Não foi possível compartilhar a tela.', 'error');
    }
  }

  setUserVolume(userId: number, volume: number) {
    this.prefs.set('userVolumes', { ...this.prefs.get('userVolumes'), [userId]: volume });
    this.applyOutput();
  }

  userVolume(userId: number): number {
    return this.prefs.get('userVolumes')[userId] ?? 100;
  }

  async changeInputDevice(deviceId: string) {
    this.prefs.set('inputDevice', deviceId);
    if (!this.active()) return;
    const old = this.mic;
    await this.startMic();
    const track = this.mic?.getAudioTracks()[0] ?? null;
    for (const p of this.peers.values()) {
      const sender = p.senders.find((s) => s.track?.kind === 'audio');
      if (sender) await sender.replaceTrack(track);
      else if (track && this.mic) p.senders.push(p.pc.addTrack(track, this.mic));
    }
    old?.getTracks().forEach((t) => t.stop());
  }

  changeOutputDevice(deviceId: string) {
    this.prefs.set('outputDevice', deviceId);
    this.applyOutput();
  }

  // ------------------------------------------------------------------ internals

  private sendState() {
    this.gateway.send({
      op: 'voice',
      channelId: this.channelId(),
      mute: this.mute() || this.deaf() || !this.mic,
      deaf: this.deaf(),
      video: !!this.localCamera(),
      stream: !!this.localScreen(),
    });
  }

  private async startMic() {
    const dev = this.prefs.get('inputDevice');
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: dev !== 'default' ? { exact: dev } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.hasMic.set(true);
      this.applyMute();
      this.localAnalyser = this.makeAnalyser(this.mic);
    } catch {
      this.mic = null;
      this.hasMic.set(false);
      this.localAnalyser = null;
      this.ui.toast('Não foi possível acessar o microfone. Você entrou só para ouvir.', 'error');
    }
  }

  private applyMute() {
    const on = !this.mute() && !this.deaf();
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = on));
  }

  private applyOutput() {
    const sink = this.prefs.get('outputDevice');
    for (const p of this.peers.values()) {
      const vol = Math.min(1, this.userVolume(p.userId) / 100);
      for (const el of [p.micAudio, p.screenAudio]) {
        el.muted = this.deaf();
        el.volume = vol;
        const withSink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        if (withSink.setSinkId && sink) withSink.setSinkId(sink === 'default' ? '' : sink).catch(() => undefined);
      }
    }
  }

  private makeAnalyser(stream: MediaStream) {
    try {
      this.audioCtx ??= new AudioContext();
      if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
      const node = this.audioCtx.createAnalyser();
      node.fftSize = 512;
      this.audioCtx.createMediaStreamSource(stream).connect(node);
      return { node, data: new Uint8Array(node.frequencyBinCount) };
    } catch {
      return null;
    }
  }

  private level(a: { node: AnalyserNode; data: Uint8Array<ArrayBuffer> }): number {
    a.node.getByteFrequencyData(a.data);
    let sum = 0;
    for (let i = 0; i < a.data.length; i++) sum += a.data[i];
    return sum / a.data.length;
  }

  private startSpeakingLoop() {
    if (this.speakTimer) return;
    this.speakTimer = setInterval(() => {
      const now = Date.now();
      const me = this.store.me()?.id;
      if (me != null && this.localAnalyser && !this.mute() && !this.deaf() && this.level(this.localAnalyser) > SPEAK_THRESHOLD) {
        this.lastSpoke.set(me, now);
      }
      for (const p of this.peers.values()) {
        if (p.analyser && this.level(p.analyser) > SPEAK_THRESHOLD) this.lastSpoke.set(p.userId, now);
      }
      const next = new Set<number>();
      for (const [uid, t] of this.lastSpoke) if (now - t < 350) next.add(uid);
      const cur = this.speaking();
      if (next.size !== cur.size || [...next].some((u) => !cur.has(u))) this.speaking.set(next);
    }, 80);
  }

  private signal(to: string, data: unknown) {
    this.gateway.send({ op: 'rtc', to, data });
  }

  private mediaInfo(): MediaInfo {
    return { camera: this.localCamera()?.id ?? null, screen: this.localScreen()?.id ?? null };
  }

  private broadcastMedia() {
    const info = this.mediaInfo();
    for (const p of this.peers.values()) this.signal(p.sid, { media: info });
  }

  private createPeer(sid: string, userId: number): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const micAudio = new Audio();
    const screenAudio = new Audio();
    micAudio.autoplay = true;
    screenAudio.autoplay = true;
    const peer: Peer = {
      sid,
      userId,
      pc,
      polite: (this.store.sessionId() ?? '') < sid,
      makingOffer: false,
      ignoreOffer: false,
      micAudio,
      screenAudio,
      streams: new Map(),
      media: { camera: null, screen: null },
      analyser: null,
      senders: [],
      cameraSenders: [],
      screenSenders: [],
      queue: Promise.resolve(),
    };
    this.peers.set(sid, peer);

    if (this.mic) for (const t of this.mic.getAudioTracks()) peer.senders.push(pc.addTrack(t, this.mic));
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    const cam = this.localCamera();
    if (cam) for (const t of cam.getVideoTracks()) peer.cameraSenders.push(pc.addTrack(t, cam));
    const screen = this.localScreen();
    if (screen) for (const t of screen.getTracks()) peer.screenSenders.push(pc.addTrack(t, screen));

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(sid, { description: pc.localDescription });
      } catch (e) {
        console.warn('negotiation failed', e);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(sid, { candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      peer.streams.set(stream.id, stream);
      stream.onremovetrack = () => this.refreshPeerMedia(peer);
      e.track.onunmute = () => this.refreshPeerMedia(peer);
      e.track.onended = () => this.refreshPeerMedia(peer);
      this.refreshPeerMedia(peer);
    };
    pc.onconnectionstatechange = () => {
      this.peerStates.update((s) => ({ ...s, [sid]: pc.connectionState }));
      if (pc.connectionState === 'failed') pc.restartIce();
    };
    // If a connection never comes up (lost candidate, network change), retry ICE.
    let since = Date.now();
    const watchdog = setInterval(() => {
      if (pc.connectionState === 'closed') return clearInterval(watchdog);
      if (pc.connectionState === 'connected') {
        since = Date.now();
        return;
      }
      if (Date.now() - since > 12_000) {
        since = Date.now();
        pc.restartIce();
      }
    }, 4000);
    this.peerStates.update((s) => ({ ...s, [sid]: pc.connectionState }));
    this.signal(sid, { media: this.mediaInfo() });
    this.applyOutput();
    return peer;
  }

  /** Figures out which remote stream is mic, camera or screen and wires it up. */
  private refreshPeerMedia(peer: Peer) {
    let camera: MediaStream | null = null;
    let screen: MediaStream | null = null;
    for (const [id, stream] of peer.streams) {
      const hasVideo = stream.getVideoTracks().some((t) => t.readyState === 'live');
      const hasAudio = stream.getAudioTracks().length > 0;
      if (id === peer.media.screen) {
        if (hasVideo) screen = stream;
        if (hasAudio && peer.screenAudio.srcObject !== stream) {
          peer.screenAudio.srcObject = stream;
          void peer.screenAudio.play().catch(() => undefined);
        }
      } else if (id === peer.media.camera) {
        if (hasVideo) camera = stream;
      } else if (hasAudio) {
        if (peer.micAudio.srcObject !== stream) {
          peer.micAudio.srcObject = stream;
          void peer.micAudio.play().catch(() => undefined);
        }
        if (peer.analyser?.streamId !== id) {
          const a = this.makeAnalyser(stream);
          peer.analyser = a ? { ...a, streamId: id } : null;
        }
      }
    }
    this.remoteVideo.update((all) => ({ ...all, [peer.sid]: { camera, screen } }));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onSignal(from: string, fromUser: number, data: any) {
    if (!this.active() || !data) return;
    const peer = this.peers.get(from) ?? this.createPeer(from, fromUser);
    peer.queue = peer.queue.then(() => this.applySignal(peer, data));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async applySignal(peer: Peer, data: any) {
    const pc = peer.pc;
    const from = peer.sid;
    if (pc.signalingState === 'closed') return;
    try {
      if (data.media) {
        peer.media = data.media;
        this.refreshPeerMedia(peer);
      } else if (data.description) {
        const desc = data.description as RTCSessionDescriptionInit;
        const collision = desc.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(desc);
        if (desc.type === 'offer') {
          await pc.setLocalDescription();
          this.signal(from, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (e) {
          if (!peer.ignoreOffer) throw e;
        }
      }
    } catch (e) {
      console.warn('signal handling failed', e);
    }
  }

  private closePeer(sid: string) {
    const p = this.peers.get(sid);
    if (!p) return;
    this.peers.delete(sid);
    p.pc.onnegotiationneeded = null;
    p.pc.close();
    p.micAudio.srcObject = null;
    p.screenAudio.srcObject = null;
    this.remoteVideo.update((all) => {
      const next = { ...all };
      delete next[sid];
      return next;
    });
    this.peerStates.update((s) => {
      const next = { ...s };
      delete next[sid];
      return next;
    });
  }

  private stopCamera() {
    const cam = this.localCamera();
    if (!cam) return;
    cam.getTracks().forEach((t) => t.stop());
    for (const p of this.peers.values()) {
      for (const s of p.cameraSenders) p.pc.removeTrack(s);
      p.cameraSenders = [];
    }
    this.localCamera.set(null);
    this.broadcastMedia();
    if (this.active()) this.sendState();
  }

  private stopScreen() {
    const screen = this.localScreen();
    if (!screen) return;
    screen.getTracks().forEach((t) => t.stop());
    for (const p of this.peers.values()) {
      for (const s of p.screenSenders) p.pc.removeTrack(s);
      p.screenSenders = [];
    }
    this.localScreen.set(null);
    this.broadcastMedia();
    if (this.active()) this.sendState();
  }

  private teardown() {
    for (const sid of [...this.peers.keys()]) this.closePeer(sid);
    this.stopCamera();
    this.stopScreen();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.localAnalyser = null;
    if (this.speakTimer) clearInterval(this.speakTimer);
    this.speakTimer = null;
    this.lastSpoke.clear();
    this.speaking.set(new Set());
    this.active.set(false);
    this.channelId.set(null);
    this.guildId.set(null);
  }
}
