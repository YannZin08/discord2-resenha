import { Injectable, computed, effect, signal, untracked } from '@angular/core';
import { Api } from './api';
import { Gateway } from './gateway';
import { MicLevel, MicPipeline } from './mic';
import { MicSettings, Prefs, StreamSettings } from './prefs';
import { sounds } from './sounds';
import { Store } from './store';
import type { VoiceState } from './types';
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
  analyser: { node: AnalyserNode; data: Float32Array<ArrayBuffer>; streamId: string } | null;
  senders: RTCRtpSender[];
  cameraSenders: RTCRtpSender[];
  screenSenders: RTCRtpSender[];
  /** Signals are applied one at a time, in arrival order (a candidate must wait for its description). */
  queue: Promise<void>;
  /** Our mic/camera/screen tracks are on this connection (the polite side waits for the first offer). */
  localAttached: boolean;
}

export interface PeerInfo {
  userId: number;
  state: RTCPeerConnectionState;
  /** lan = same network, direct = peer-to-peer over the internet, relay = through TURN. */
  route: 'lan' | 'direct' | 'relay' | null;
  rtt: number | null;
  received: number;
  sent: number;
}

export interface RemoteVideo {
  camera: MediaStream | null;
  screen: MediaStream | null;
}

/** Level (dBFS) of someone else's audio that counts as speaking; their own voice gate already silences the rest. */
const SPEAK_DB = -60;
/** How long the ring stays after the voice stops, so it doesn't flicker between words. */
const SPEAK_HANG_MS = 200;

function videoConstraints(s: StreamSettings): MediaTrackConstraints {
  // "source" captures the screen as-is, up to 4K; caps never upscale a smaller screen.
  const h = s.resolution === 'source' ? 2160 : Number(s.resolution);
  return { width: { max: Math.round((h * 16) / 9) }, height: { max: h }, frameRate: { ideal: s.fps, max: s.fps } };
}

function displayOptions(s: StreamSettings): DisplayMediaStreamOptions {
  return {
    video: videoConstraints(s),
    audio: s.audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
    // Chrome-only hints, ignored by other browsers.
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    systemAudio: s.audio ? 'include' : 'exclude',
  } as DisplayMediaStreamOptions;
}

/** ~0.05 bits per pixel per frame: 4K60 gets ~25 Mbps, 1080p60 ~6 Mbps. */
function streamBitrate(track: MediaStreamTrack, fps: number): number {
  const s = track.getSettings();
  const pixels = (s.width ?? 1920) * (s.height ?? 1080);
  const rate = Math.min(s.frameRate ?? fps, fps);
  return Math.round(Math.min(40_000_000, Math.max(2_500_000, pixels * rate * 0.05)));
}

/** Prefers a hardware-accelerated codec for streaming (AV1/H.264/VP9), falling back to H.264. */
async function pickStreamCodec(): Promise<string | null> {
  const caps = RTCRtpSender.getCapabilities?.('video');
  if (!caps) return null;
  const have = new Set(caps.codecs.map((c) => c.mimeType.toLowerCase()));
  const candidates = ['video/AV1', 'video/H264', 'video/VP9'].filter((m) => have.has(m.toLowerCase()));
  for (const mime of candidates) {
    try {
      const info = await navigator.mediaCapabilities.encodingInfo({
        type: 'webrtc',
        video: { contentType: mime, width: 3840, height: 2160, bitrate: 25_000_000, framerate: 60 },
      });
      if (info.supported && info.powerEfficient) return mime;
    } catch {
      // this browser can't answer for webrtc; try the next one
    }
  }
  return candidates.includes('video/H264') ? 'video/H264' : (candidates[0] ?? null);
}

/** Voice bitrate: Discord sends 64 kbps by default (96 on better servers); browsers default to ~32. */
export const VOICE_BITRATE = 96_000;
/** Ceiling for any Opus stream we receive (the mic sender sets its own target; screen audio is stereo). */
const OPUS_CAP = 128_000;

/**
 * Opus settings we ask the other side to send us with (the description we signal is what its
 * encoder reads): a higher bitrate ceiling, in-band error correction so a lost packet doesn't
 * become a gap, and no DTX (the voice gate already silences the mic; DTX's comfort noise sounds
 * worse). Only the copy we send is changed; our own local description stays as the browser made it.
 */
function tuneOpus(desc: RTCSessionDescription | null): RTCSessionDescriptionInit | null {
  if (!desc?.sdp) return desc;
  const want: Record<string, string> = { maxaveragebitrate: String(OPUS_CAP), useinbandfec: '1', usedtx: '0' };
  const fmt = (kv: Map<string, string>) => [...kv].map(([k, v]) => `${k}=${v}`).join(';');
  let sdp = desc.sdp;
  // Each audio section (mic, screen audio) has its own lines, often with the same payload type.
  for (const pt of new Set([...sdp.matchAll(/a=rtpmap:(\d+) opus\/48000/gi)].map((m) => m[1]))) {
    sdp = sdp.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`, 'g'), (_, params: string) => {
      const kv = new Map(
        params
          .split(';')
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => p.split('=') as [string, string]),
      );
      for (const [k, v] of Object.entries(want)) kv.set(k, v);
      return `a=fmtp:${pt} ${fmt(kv)}`;
    });
    // Browsers always write an fmtp line for Opus; if one ever didn't, add ours after the rtpmap.
    if (!sdp.includes(`a=fmtp:${pt} `)) {
      sdp = sdp.replace(new RegExp(`(a=rtpmap:${pt} opus/48000[^\\r\\n]*\\r\\n)`, 'gi'), `$1a=fmtp:${pt} ${fmt(new Map(Object.entries(want)))}\r\n`);
    }
  }
  return { type: desc.type, sdp };
}

/** The mic's encoder target and, with "alta prioridade de pacotes", DSCP marking so routers favour voice. */
async function tuneVoiceSender(sender: RTCRtpSender, qos: boolean) {
  if (sender.track?.kind !== 'audio') return;
  try {
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    const e = params.encodings[0];
    e.maxBitrate = VOICE_BITRATE;
    e.priority = qos ? 'high' : 'low';
    e.networkPriority = qos ? 'high' : 'low';
    await sender.setParameters(params);
  } catch {
    // not negotiated yet or not supported: the SDP settings still apply
  }
}

function preferCodec(t: RTCRtpTransceiver, mime: string | null) {
  if (!mime || !t.setCodecPreferences) return;
  const rank = (c: RTCRtpCodec) => {
    if (c.mimeType.toLowerCase() !== mime.toLowerCase()) return 2;
    // For H.264, High/Main profiles compress better than Baseline.
    return /profile-level-id=(64|4d)/i.test(c.sdpFmtpLine ?? '') ? 0 : 1;
  };
  for (const caps of [RTCRtpReceiver.getCapabilities('video'), RTCRtpSender.getCapabilities('video')]) {
    if (!caps) continue;
    try {
      t.setCodecPreferences([...caps.codecs].sort((a, b) => rank(a) - rank(b)));
      return;
    } catch {
      // try the other capability list
    }
  }
}

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
  /** Whether the server handed us a TURN relay (needed behind CGNAT / strict firewalls). */
  readonly relay = signal(false);
  /** Live mic level while in a call (for the sensitivity meter). */
  readonly micLevel = signal<MicLevel | null>(null);
  readonly pttDown = signal(false);
  /** Session id of the stream we're watching: like Discord, one at a time and only after clicking it. */
  readonly watching = signal<string | null>(null);

  readonly connectionLabel = computed(() => {
    if (!this.channelId()) return '';
    if (!this.active()) return 'Conectando...';
    const states = Object.values(this.peerStates());
    if (states.some((s) => s === 'failed' || s === 'disconnected')) return 'Falha na conexão';
    if (states.some((s) => s === 'connecting' || s === 'new')) return 'Conectando ao RTC';
    return 'Voz conectada';
  });

  private mic: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private iceServers: RTCIceServer[] = [];
  private audioCtx: AudioContext | null = null;
  private pipe: MicPipeline | null = null;
  private speakTimer: ReturnType<typeof setInterval> | null = null;
  private lastSpoke = new Map<number, number>();
  private streamCodec: string | null = null;
  private externalSpeakers = new Set<number>();
  /** Everyone else in our call at the last update, to tell who joined, left or went live. */
  private callPeers: Map<string, VoiceState> | null = null;

  constructor(
    private store: Store,
    private gateway: Gateway,
    private api: Api,
    private prefs: Prefs,
    private ui: Ui,
  ) {
    this.mute.set(prefs.get('mute'));
    this.deaf.set(prefs.get('deaf'));

    // Push-to-talk works while the app window has focus (a browser can't see keys elsewhere).
    window.addEventListener('keydown', (e) => {
      const key = this.prefs.get('mic').pttKey;
      if (key && e.code === key && !e.repeat) this.setPtt(true);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === this.prefs.get('mic').pttKey) this.setPtt(false);
    });
    window.addEventListener('blur', () => this.setPtt(false));

    // Keep one peer connection per other session in our channel.
    effect(() => {
      const states = this.store.voiceStates();
      const channelId = this.channelId();
      const active = this.active();
      const mySid = this.store.sessionId();
      const screen = this.localScreen();
      untracked(() => {
        if (!active || !channelId || !mySid) return;
        const wanted = new Map<string, number>();
        // Bots in the channel (like the music bot) don't take part in the WebRTC call.
        for (const v of Object.values(states)) if (v.channelId === channelId && v.sessionId !== mySid && !v.bot) wanted.set(v.sessionId, v.userId);
        for (const [sid, uid] of wanted) if (!this.peers.has(sid)) this.createPeer(sid, uid);
        for (const sid of [...this.peers.keys()]) if (!wanted.has(sid)) this.closePeer(sid);
        // Our stream only goes to the people watching it, so it costs no upload for the rest.
        for (const p of this.peers.values()) {
          const watches = states[p.sid]?.watching === mySid;
          if (screen && watches && p.localAttached && !p.screenSenders.length) this.addScreenTracks(p, screen);
          else if ((!screen || !watches) && p.screenSenders.length) this.removeScreenTracks(p);
        }
      });
    });

    effect(() => {
      const states = this.store.voiceStates();
      const channelId = this.active() ? this.channelId() : null;
      untracked(() => this.onCallChange(states, channelId));
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
      const res = await this.api.get<{ iceServers: RTCIceServer[]; relay?: boolean }>('/voice/ice');
      this.iceServers = res.iceServers;
      this.relay.set(!!res.relay);
    } catch {
      this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
      this.relay.set(false);
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
    this.afterAudioToggle(this.deaf(), true);
  }

  private afterAudioToggle(off: boolean, deafen = false) {
    this.prefs.set('mute', this.mute());
    this.prefs.set('deaf', this.deaf());
    this.applyMute();
    this.applyOutput();
    if (this.prefs.get('sounds')) (deafen ? (off ? sounds.deafen : sounds.undeafen) : off ? sounds.mute : sounds.unmute)();
    if (this.active()) this.sendState();
  }

  /** Starts watching someone's stream, joining their voice channel first if needed. */
  async watchStream(sessionId: string) {
    const v = this.store.voiceStates()[sessionId];
    if (!v?.stream || v.channelId == null || sessionId === this.store.sessionId()) return;
    if (this.channelId() !== v.channelId) await this.join(v.channelId, v.guildId);
    if (this.channelId() !== v.channelId || !this.active() || this.watching() === sessionId) return;
    this.watching.set(sessionId);
    this.sendState();
    if (this.prefs.get('sounds')) sounds.streamJoin();
  }

  stopWatching() {
    if (!this.watching()) return;
    this.watching.set(null);
    this.sendState();
    if (this.prefs.get('sounds')) sounds.streamLeave();
  }

  /** Discord-style call sounds (someone joined, left, went live…) and dropping a stream that ended. */
  private onCallChange(states: Record<string, VoiceState>, channelId: number | null) {
    const me = this.store.me()?.id;
    if (!channelId || me == null) {
      this.callPeers = null;
      return;
    }
    const now = new Map<string, VoiceState>();
    for (const v of Object.values(states)) if (v.channelId === channelId && v.userId !== me) now.set(v.sessionId, v);
    const watched = this.watching();
    if (watched && !now.get(watched)?.stream) {
      this.watching.set(null);
      this.sendState();
    }
    const prev = this.callPeers;
    this.callPeers = now;
    // The first look after joining only takes note of who is already here.
    if (!prev || !this.prefs.get('sounds')) return;
    const mySid = this.store.sessionId();
    const live = !!this.localScreen();
    let joined = false, left = false, wentLive = false, endedLive = false, viewerIn = false, viewerOut = false;
    for (const [sid, v] of now) {
      const before = prev.get(sid);
      if (!before) joined = true;
      else {
        if (!before.stream && v.stream) wentLive = true;
        if (before.stream && !v.stream) endedLive = true;
        if (live && before.watching !== mySid && v.watching === mySid) viewerIn = true;
        if (live && before.watching === mySid && v.watching !== mySid) viewerOut = true;
      }
    }
    for (const [sid, v] of prev) {
      if (now.has(sid)) continue;
      left = true;
      if (live && v.watching === mySid) viewerOut = true;
    }
    // One sound per update, the most important first.
    if (joined) sounds.join();
    else if (left) sounds.leave();
    else if (wentLive) sounds.streamStart();
    else if (endedLive) sounds.streamEnd();
    else if (viewerIn) sounds.streamJoin();
    else if (viewerOut) sounds.streamLeave();
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
        if (!p.localAttached) continue;
        for (const t of stream.getVideoTracks()) p.cameraSenders.push(p.pc.addTrack(t, stream));
      }
      this.broadcastMedia();
      this.sendState();
    } catch {
      this.ui.toast('Não foi possível acessar a câmera.', 'error');
    }
  }

  stopScreenShare() {
    this.stopScreen();
  }

  /** Goes live with the chosen quality (the "Transmitir tela" window calls this). */
  async startScreen(settings: StreamSettings) {
    if (this.localScreen()) this.stopScreen();
    this.prefs.set('stream', settings);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(displayOptions(settings));
      const video = stream.getVideoTracks()[0];
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.contentHint = settings.priority === 'quality' ? 'detail' : 'motion';
      video.addEventListener('ended', () => this.stopScreen());
      this.streamCodec ??= await pickStreamCodec();
      // Viewers get the tracks once they click "Assistir transmissão" (see the constructor).
      this.localScreen.set(stream);
      this.broadcastMedia();
      this.sendState();
    } catch (e) {
      if ((e as DOMException)?.name !== 'NotAllowedError') this.ui.toast('Não foi possível compartilhar a tela.', 'error');
    }
  }

  /** Changes the quality of a live stream without stopping it. */
  async updateStream(settings: StreamSettings) {
    this.prefs.set('stream', settings);
    const video = this.localScreen()?.getVideoTracks()[0];
    if (!video) return;
    try {
      await video.applyConstraints(videoConstraints(settings));
    } catch {
      // keep the current capture size
    }
    video.contentHint = settings.priority === 'quality' ? 'detail' : 'motion';
    for (const p of this.peers.values()) for (const s of p.screenSenders) if (s.track?.kind === 'video') void this.tuneStreamSender(s);
  }

  private addScreenTracks(p: Peer, stream: MediaStream) {
    const fps = this.prefs.get('stream').fps;
    for (const track of stream.getTracks()) {
      const video = track.kind === 'video';
      const t = p.pc.addTransceiver(track, {
        direction: 'sendonly',
        streams: [stream],
        sendEncodings: [
          video
            ? { maxBitrate: streamBitrate(track, fps), maxFramerate: fps, scaleResolutionDownBy: 1, priority: 'high', networkPriority: 'high' }
            : { maxBitrate: 192_000, priority: 'high' },
        ],
      });
      if (video) {
        preferCodec(t, this.streamCodec);
        // Encoder parameters only stick once the sender is negotiated, so apply them again shortly after.
        void this.tuneStreamSender(t.sender);
        setTimeout(() => void this.tuneStreamSender(t.sender), 3000);
      }
      p.screenSenders.push(t.sender);
    }
  }

  private removeScreenTracks(p: Peer) {
    for (const s of p.screenSenders) p.pc.removeTrack(s);
    p.screenSenders = [];
  }

  /** Full resolution, high bitrate and no downscaling: the stream should always look as sharp as possible. */
  private async tuneStreamSender(sender: RTCRtpSender) {
    const track = sender.track;
    if (!track) return;
    const s = this.prefs.get('stream');
    const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
    if (!params.encodings?.length) params.encodings = [{}];
    for (const e of params.encodings) {
      e.maxBitrate = streamBitrate(track, s.fps);
      e.maxFramerate = s.fps;
      e.scaleResolutionDownBy = 1;
    }
    params.degradationPreference = s.priority === 'quality' ? 'maintain-resolution' : 'maintain-framerate';
    try {
      await sender.setParameters(params);
    } catch {
      try {
        delete params.degradationPreference;
        await sender.setParameters(params);
      } catch {
        // not negotiated yet; the retry will apply it
      }
    }
  }

  /** Per-person connection details for the "Detalhes da conexão" window. */
  async diagnostics(): Promise<PeerInfo[]> {
    const out: PeerInfo[] = [];
    for (const p of this.peers.values()) {
      const info: PeerInfo = { userId: p.userId, state: p.pc.connectionState, route: null, rtt: null, received: 0, sent: 0 };
      try {
        const stats = await p.pc.getStats();
        let pairId: string | undefined;
        stats.forEach((r) => {
          if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
          if (r.type === 'inbound-rtp') info.received += r.bytesReceived ?? 0;
          if (r.type === 'outbound-rtp') info.sent += r.bytesSent ?? 0;
        });
        if (!pairId) stats.forEach((r) => r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && (pairId = r.id));
        const pair = pairId ? stats.get(pairId) : null;
        if (pair) {
          const local = stats.get(pair.localCandidateId)?.candidateType;
          const remote = stats.get(pair.remoteCandidateId)?.candidateType;
          info.route = local === 'relay' || remote === 'relay' ? 'relay' : local === 'host' && remote === 'host' ? 'lan' : 'direct';
          info.rtt = pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null;
        }
      } catch {
        // stats unavailable on a closing connection
      }
      out.push(info);
    }
    return out;
  }

  setUserVolume(userId: number, volume: number) {
    this.prefs.set('userVolumes', { ...this.prefs.get('userVolumes'), [userId]: volume });
    this.applyOutput();
  }

  userVolume(userId: number): number {
    return this.prefs.get('userVolumes')[userId] ?? 100;
  }

  /** Volume of someone's screen share audio (0–100), kept apart from their voice. */
  setStreamVolume(userId: number, volume: number) {
    this.prefs.set('streamVolumes', { ...this.prefs.get('streamVolumes'), [userId]: volume });
    this.applyOutput();
  }

  streamVolume(userId: number): number {
    return this.prefs.get('streamVolumes')[userId] ?? 100;
  }

  async changeInputDevice(deviceId: string) {
    this.prefs.set('inputDevice', deviceId);
    if (this.active()) await this.restartMic();
  }

  /** Applies Discord-style mic settings; processing changes reopen the mic, the rest is live. */
  async updateMicSettings(next: MicSettings) {
    const prev = this.prefs.get('mic');
    this.prefs.set('mic', next);
    if (prev.qos !== next.qos) for (const p of this.peers.values()) this.tuneSenders(p);
    if (!this.pipe) return;
    if (MicPipeline.needsRestart(prev, next)) await this.restartMic();
    else this.pipe.update(next);
  }

  /** Marks someone as speaking without call audio to analyse, e.g. the music bot while it plays. */
  setExternalSpeaking(userId: number | null, speaking: boolean) {
    if (userId == null) return;
    if (speaking) this.externalSpeakers.add(userId);
    else this.externalSpeakers.delete(userId);
  }

  clearExternalSpeaking() {
    this.externalSpeakers.clear();
  }

  /** Push-to-talk key state, also used by the settings screen's preview. */
  setPtt(down: boolean) {
    if (this.pttDown() === down) return;
    this.pttDown.set(down);
    this.pipe?.setPtt(down);
  }

  private async restartMic() {
    await this.startMic();
    const track = this.mic?.getAudioTracks()[0] ?? null;
    for (const p of this.peers.values()) {
      const sender = p.senders.find((s) => s.track?.kind === 'audio');
      if (sender) await sender.replaceTrack(track);
      else if (track && this.mic && p.localAttached) p.senders.push(p.pc.addTrack(track, this.mic));
      this.tuneSenders(p);
    }
    if (this.active()) this.sendState();
  }

  /** Voice bitrate and packet priority on this peer's mic sender. */
  private tuneSenders(peer: Peer) {
    const qos = this.prefs.get('mic').qos;
    for (const s of peer.senders) void tuneVoiceSender(s, qos);
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
      watching: this.watching(),
    });
  }

  private async startMic() {
    try {
      const pipe = await MicPipeline.create(this.prefs.get('inputDevice'), this.prefs.get('mic'));
      this.pipe?.destroy();
      this.pipe = pipe;
      this.mic = pipe.stream;
      pipe.onLevel = (l) => {
        this.micLevel.set({ ...l });
        this.updateSpeaking();
      };
      pipe.setPtt(this.pttDown());
      this.hasMic.set(true);
      this.applyMute();
    } catch {
      this.pipe?.destroy();
      this.pipe = null;
      this.mic = null;
      this.micLevel.set(null);
      this.hasMic.set(false);
      this.ui.toast('Não foi possível acessar o microfone. Você entrou só para ouvir.', 'error');
    }
  }

  private applyMute() {
    const on = !this.mute() && !this.deaf();
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = on));
  }

  private applyOutput() {
    const sink = this.prefs.get('outputDevice');
    const out = this.prefs.get('outputVolume') / 100;
    for (const p of this.peers.values()) {
      // Voice and screen-share audio have separate volumes, like Discord.
      const levels: [HTMLAudioElement, number][] = [
        [p.micAudio, this.userVolume(p.userId)],
        [p.screenAudio, this.streamVolume(p.userId)],
      ];
      for (const [el, level] of levels) {
        el.muted = this.deaf() || level === 0;
        el.volume = Math.min(1, (level / 100) * out);
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
      // ~43 ms of audio: each check of the speaking loop covers everything since the last one.
      node.fftSize = 2048;
      this.audioCtx.createMediaStreamSource(stream).connect(node);
      return { node, data: new Float32Array(node.fftSize) };
    } catch {
      return null;
    }
  }

  /** Loudness (dBFS) of the latest audio, unsmoothed so the ring follows the voice without lag. */
  private level(a: { node: AnalyserNode; data: Float32Array<ArrayBuffer> }): number {
    a.node.getFloatTimeDomainData(a.data);
    let sum = 0;
    for (let i = 0; i < a.data.length; i++) sum += a.data[i] * a.data[i];
    return 10 * Math.log10(sum / a.data.length + 1e-12);
  }

  private startSpeakingLoop() {
    if (this.speakTimer) return;
    this.speakTimer = setInterval(() => {
      const now = Date.now();
      for (const p of this.peers.values()) {
        if (p.analyser && this.level(p.analyser) > SPEAK_DB) this.lastSpoke.set(p.userId, now);
      }
      this.updateSpeaking();
    }, 40);
  }

  private updateSpeaking() {
    const now = Date.now();
    const next = new Set<number>();
    for (const [uid, t] of this.lastSpoke) if (now - t < SPEAK_HANG_MS) next.add(uid);
    for (const id of this.externalSpeakers) next.add(id);
    // Your own ring comes straight from the voice gate: only while your voice is really going out.
    const me = this.store.me()?.id;
    if (me != null && this.pipe?.level.speaking && !this.mute() && !this.deaf()) next.add(me);
    const cur = this.speaking();
    if (next.size !== cur.size || [...next].some((u) => !cur.has(u))) this.speaking.set(next);
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

  private attachLocalMedia(peer: Peer) {
    if (peer.localAttached) return;
    peer.localAttached = true;
    const pc = peer.pc;
    if (this.mic) for (const t of this.mic.getAudioTracks()) peer.senders.push(pc.addTrack(t, this.mic));
    else if (!peer.polite) pc.addTransceiver('audio', { direction: 'recvonly' });
    this.tuneSenders(peer);
    const cam = this.localCamera();
    if (cam) for (const t of cam.getVideoTracks()) peer.cameraSenders.push(pc.addTrack(t, cam));
    const screen = this.localScreen();
    if (screen && this.store.voiceStates()[peer.sid]?.watching === this.store.sessionId()) this.addScreenTracks(peer, screen);
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
      localAttached: false,
    };
    this.peers.set(sid, peer);

    // Only the impolite side starts the connection. If both offered at once, the polite
    // side's ICE candidates could be dropped by the other and the call stayed stuck.
    if (!peer.polite) this.attachLocalMedia(peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(sid, { description: tuneOpus(pc.localDescription) });
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
      // Some browsers only take sender settings once the connection is negotiated.
      if (pc.connectionState === 'connected') this.tuneSenders(peer);
      if (pc.connectionState === 'failed' && !peer.polite) pc.restartIce();
    };
    // If a connection never comes up (lost candidate, network change), the impolite side
    // restarts ICE after a few seconds; restarting on both sides would collide again.
    let since = Date.now();
    let lastRestart = Date.now();
    let warned = false;
    const watchdog = setInterval(() => {
      if (pc.connectionState === 'closed') return clearInterval(watchdog);
      if (pc.connectionState === 'connected') {
        since = Date.now();
        lastRestart = Date.now();
        return;
      }
      if (!peer.polite && pc.signalingState === 'stable' && Date.now() - lastRestart > 6000) {
        lastRestart = Date.now();
        pc.restartIce();
      }
      if (Date.now() - since > 15_000) {
        since = Date.now();
        if (!warned) {
          warned = true;
          const name = this.store.nameIn(this.guildId(), userId);
          this.ui.toast(
            this.relay()
              ? `Não foi possível conectar com ${name}. Tentando de novo...`
              : `Não foi possível conectar o áudio e o vídeo com ${name}: a rede está bloqueando a conexão direta. O servidor precisa de um retransmissor (TURN).`,
            'error',
          );
        }
      }
    }, 2000);
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
          this.attachLocalMedia(peer);
          await pc.setLocalDescription();
          this.signal(from, { description: tuneOpus(pc.localDescription) });
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
    for (const p of this.peers.values()) this.removeScreenTracks(p);
    this.localScreen.set(null);
    this.broadcastMedia();
    if (this.active()) this.sendState();
  }

  private teardown() {
    // First, so that stopping the camera / stream below doesn't announce us in the channel again.
    this.active.set(false);
    for (const sid of [...this.peers.keys()]) this.closePeer(sid);
    this.stopCamera();
    this.stopScreen();
    this.pipe?.destroy();
    this.pipe = null;
    this.mic = null;
    this.micLevel.set(null);
    if (this.speakTimer) clearInterval(this.speakTimer);
    this.speakTimer = null;
    this.lastSpoke.clear();
    this.externalSpeakers.clear();
    this.speaking.set(new Set());
    this.watching.set(null);
    this.callPeers = null;
    this.channelId.set(null);
    this.guildId.set(null);
  }
}
