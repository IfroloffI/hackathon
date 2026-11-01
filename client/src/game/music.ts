/**
 * Музыка эпох: один луп-трек на локацию, кроссфейд при смене мира.
 * Файлы — client/public/assets/music/<id>.mp3; у каждого трека свой trim (дБ),
 * выведенный из измеренного RMS, — треки звучат на одном фоновом уровне.
 * Источники/лицензии — client/public/assets/music/CREDITS.md.
 */

/** Идентификатор трека = идентификатор уровня (hub, alexandria, padua, woolsthorpe, bletchley, baikonur). */
type MusicId = string;

const FADE_IN = 1.2;
const FADE_OUT = 1.0;
const FADE_OVERLAP = 0.5;
/** Мастер-громкость = приглушённый фон: не заглушает голосовой чат и реплики. */
const MASTER_VOLUME = 0.35;
/** Целевой RMS трека после trim, dBFS — «приятная фоновая громкость». */
const TARGET_RMS_DB = -20;
const MUTE_KEY = 'chronolet-music';

/** Trim в дБ по каждому треку: измеренный RMS → TARGET_RMS_DB (заполняется анализатором громкости). */
const TRIM_DB = new Map<MusicId, number>([
  ['hub', 0],
  ['alexandria', 0],
  ['padua', 0],
  ['woolsthorpe', 0],
  ['bletchley', 0],
  ['baikonur', 0],
]);

const dbToGain = (db: number) => 10 ** (db / 20);

interface Voice {
  id: MusicId;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

class BackgroundMusic {
  private ctx?: AudioContext;
  private master?: GainNode;
  private buffers = new Map<MusicId, AudioBuffer>();
  private voices = new Set<Voice>();
  private currentId: MusicId | null = null;
  private desiredId: MusicId | null = null;
  private muted = false;
  private unlockBound = false;

  /** Переключить трек (id уровня из Game.ensureWorld). Идемпотентно: тот же трек не рестартует. */
  play(id: string) {
    if (!TRIM_DB.has(id)) return;
    this.desiredId = id;
    if (this.currentId === id) return;
    this.currentId = id;
    this.unlock();
    void this.start(id);
  }

  /** Остановить музыку (например, при выходе в лобби). Настройка mute сохраняется. */
  stop() {
    this.desiredId = null;
    this.currentId = null;
    this.fadeOutAll();
  }

  toggleMute() {
    this.setMuted(!this.muted);
  }

  isMuted() {
    return this.muted;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '0' : '1');
    } catch {
      // приватный режим: настройка просто не переживёт перезагрузку
    }
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.ctxTime(), 0.15);
    }
    if (!muted && this.desiredId) {
      this.unlock();
      if (this.voices.size === 0) void this.start(this.desiredId!);
    }
  }

  dispose() {
    this.stop();
    this.ctx?.close().catch(() => undefined);
    this.ctx = undefined;
    this.master = undefined;
    this.buffers.clear();
    this.voices.clear();
  }

  // ── внутреннее ──

  private ctxTime() {
    return this.ctx?.currentTime ?? 0;
  }

  /** Разлочить автоплей: браузер разрешает звук только после жеста пользователя. */
  private unlock() {
    if (!this.unlockBound) {
      this.unlockBound = true;
      const flush = () => {
        const ctx = this.ctx;
        if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
        if (this.desiredId && this.voices.size === 0) void this.start(this.desiredId);
      };
      addEventListener('pointerdown', flush, { once: true });
      addEventListener('keydown', flush, { once: true });
    }
    void this.ctx?.resume().catch(() => undefined);
  }

  private async start(id: string) {
    if (!this.ctx) await this.ensureCtx();
    const ctx = this.ctx;
    if (!ctx || this.desiredId !== id) return;
    if (ctx.state === 'suspended') return; // догоним из unlock-flush по первому жесту
    const buf = await this.buffer(id);
    if (!buf || this.desiredId !== id || this.hasVoice(id)) return;

    const gain = ctx.createGain();
    const target = this.muted ? 0 : dbToGain(TRIM_DB.get(id) ?? 0);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(target, 0.0002), ctx.currentTime + FADE_IN);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain).connect(this.master!);
    const voice: Voice = { id, src, gain };
    this.voices.add(voice);
    src.onended = () => {
      src.onended = null;
      this.voices.delete(voice);
      gain.disconnect();
    };
    src.start(ctx.currentTime + FADE_OVERLAP, Math.random() * Math.min(buf.duration, 30));
  }

  private hasVoice(id: string) {
    for (const v of this.voices) if (v.id === id) return true;
    return false;
  }

  /** Плавно заглушить активные голоса (кроссфейд при смене трека или stop()). */
  private fadeOutAll() {
    const ctx = this.ctx;
    if (!ctx || this.voices.size === 0) return;
    for (const v of this.voices) {
      try {
        v.gain.gain.cancelScheduledValues(ctx.currentTime);
        v.gain.gain.setValueAtTime(v.gain.gain.value, ctx.currentTime + 0.01);
        v.gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + FADE_OUT);
        v.src.stop(ctx.currentTime + FADE_OUT + 0.2);
      } catch (err) {
        console.warn('[music] fadeout failed', err);
      }
    }
  }

  private async ensureCtx() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
      this.master.connect(this.ctx.destination);
    } catch (err) {
      console.warn('[music] AudioContext недоступен', err);
    }
  }

  private async buffer(id: string) {
    const cached = this.buffers.get(id);
    if (cached) return cached;
    if (!this.ctx) return undefined;
    try {
      const res = await fetch(`/assets/music/${id}.mp3`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(id, buf);
      return buf;
    } catch (err) {
      console.warn(`[music] не загрузился трек ${id}`, err);
      return undefined;
    }
  }
}

export const music = new BackgroundMusic();

try {
  if (localStorage.getItem(MUTE_KEY) === '0') music.setMuted(true);
} catch {
  // нет localStorage — стартуем с включённой музыкой
}
