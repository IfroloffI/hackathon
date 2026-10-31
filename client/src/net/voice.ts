import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import { net } from './connection.ts';

export type VoiceState = 'off' | 'connecting' | 'live' | 'reconnecting' | 'error';

export interface VoiceSnapshot {
  state: VoiceState;
  /** Микрофон выключен (но соединение живо). */
  muted: boolean;
  /** Сколько человек в голосовой комнате, включая себя. */
  participants: number;
  /** Имена (не identity) тех, кто сейчас говорит. */
  speakers: string[];
  /** Браузер заблокировал автовоспроизведение — нужен клик «включить звук». */
  audioBlocked: boolean;
  error: string | null;
}

const INITIAL: VoiceSnapshot = {
  state: 'off',
  muted: true,
  participants: 0,
  speakers: [],
  audioBlocked: false,
  error: null,
};

/** Понятные сообщения вместо стектрейсов WebRTC. */
function humanError(e: unknown): string {
  const err = e as { name?: string; message?: string };
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || /permission|denied/i.test(err?.message ?? '')) {
    return 'доступ к микрофону запрещён (разреши в настройках сайта)';
  }
  if (name === 'NotFoundError' || /requested device not found/i.test(err?.message ?? '')) {
    return 'микрофон не найден';
  }
  if (name === 'NotReadableError' || /could not start/i.test(err?.message ?? '')) {
    return 'микрофон занят другим приложением';
  }
  if (/websocket|failed to connect|connection/i.test(err?.message ?? '')) {
    return 'LiveKit недоступен — запусти npm run livekit';
  }
  return err?.message ?? String(e);
}

/**
 * Голосовой чат на LiveKit: публикует микрофон локального игрока и
 * проигрывает аудио остальных участников. Состояние отдаётся наружу
 * через onChange, чтобы HUD явно показывал «в эфире / подключение / ошибка».
 */
export class VoiceChat {
  private room: Room | null = null;
  private snapshot: VoiceSnapshot = { ...INITIAL };
  private listeners = new Set<(s: VoiceSnapshot) => void>();
  private audio: HTMLElement;

  constructor(private roomId: string) {
    this.audio = document.getElementById('voice-audio') ?? (() => {
      const el = document.createElement('div');
      el.id = 'voice-audio';
      document.body.append(el);
      return el;
    })();
  }

  get enabled(): boolean {
    return this.room !== null;
  }

  onChange(fn: (s: VoiceSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<VoiceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const fn of this.listeners) fn(this.snapshot);
  }

  async enable(): Promise<void> {
    if (this.room !== null || this.snapshot.state === 'connecting') return;
    if (!window.isSecureContext) {
      this.emit({
        state: 'error',
        error: 'микрофон доступен только на https:// или localhost',
      });
      return;
    }
    this.emit({ state: 'connecting', error: null, muted: true, participants: 0, speakers: [] });

    let room: Room | null = null;
    try {
      const { url, token } = await net.voiceToken(this.roomId);
      room = new Room({
        adaptiveStream: false,
        dynacast: false,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.room = room;
      this.bind(room);
      await room.connect(url, token, { autoSubscribe: true });
      await room.localParticipant.setMicrophoneEnabled(true);
      // Клик по кнопке — пользовательский жест, самое время разрешить звук.
      await room.startAudio().catch(() => undefined);
      this.emit({
        state: 'live',
        muted: !room.localParticipant.isMicrophoneEnabled,
        participants: room.remoteParticipants.size + 1,
      });
    } catch (e) {
      if (room !== null) {
        try { await room.disconnect(); } catch { /* уже отключены */ }
      }
      this.room = null;
      this.emit({ state: 'error', error: humanError(e), muted: true, participants: 0, speakers: [] });
    }
  }

  async disable(): Promise<void> {
    const room = this.room;
    this.room = null;
    if (room !== null) {
      try { await room.disconnect(); } catch { /* ignore */ }
    }
    this.clearAudio();
    this.emit({ ...INITIAL });
  }

  async toggleMute(): Promise<void> {
    const room = this.room;
    if (room === null) return;
    const next = !room.localParticipant.isMicrophoneEnabled;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      this.emit({ muted: !next });
    } catch (e) {
      this.emit({ error: humanError(e) });
    }
  }

  /** Автовоспроизведение заблокировано — включаем звук по клику. */
  async resumeAudio(): Promise<void> {
    const room = this.room;
    if (room === null) return;
    try {
      await room.startAudio();
      this.emit({ audioBlocked: false });
    } catch {
      this.emit({ audioBlocked: true });
    }
  }

  destroy(): void {
    void this.disable();
    this.listeners.clear();
  }

  private bind(room: Room): void {
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, _p: RemoteParticipant) => {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      el.autoplay = true;
      this.audio.append(el);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      for (const el of track.detach()) el.remove();
    });
    room.on(RoomEvent.ParticipantConnected, () => {
      this.emit({ participants: room.remoteParticipants.size + 1 });
    });
    room.on(RoomEvent.ParticipantDisconnected, () => {
      this.emit({ participants: room.remoteParticipants.size + 1 });
    });
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      this.emit({ speakers: speakers.map((p) => p.name || p.identity) });
    });
    room.on(RoomEvent.LocalTrackPublished, () => {
      this.emit({ muted: !room.localParticipant.isMicrophoneEnabled });
    });
    room.on(RoomEvent.LocalTrackUnpublished, () => {
      this.emit({ muted: !room.localParticipant.isMicrophoneEnabled });
    });
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      this.emit({ audioBlocked: !room.canPlaybackAudio });
    });
    room.on(RoomEvent.Reconnecting, () => this.emit({ state: 'reconnecting' }));
    room.on(RoomEvent.Reconnected, () => this.emit({ state: 'live' }));
    room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      if (state === ConnectionState.Reconnecting) this.emit({ state: 'reconnecting' });
      if (state === ConnectionState.Connected && this.snapshot.state === 'reconnecting') {
        this.emit({ state: 'live' });
      }
    });
    room.on(RoomEvent.MediaDevicesError, (e: Error) => {
      this.emit({ state: 'error', error: humanError(e), muted: true });
    });
    room.on(RoomEvent.Disconnected, () => {
      this.room = null;
      this.clearAudio();
      this.emit({ ...INITIAL });
    });
  }

  private clearAudio(): void {
    this.audio.replaceChildren();
  }
}
