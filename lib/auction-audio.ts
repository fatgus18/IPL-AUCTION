/** Original stereo foley, rendered locally. No recordings, network requests, or autoplay. */
export type AuctionSound = "bid" | "sold" | "lock" | "navigate";
export type SoundActivity = { id: string; type: string; text: string; at: number };
export type SoundPreferences = { enabled: boolean; volume: number };
export const DEFAULT_SOUND_PREFERENCES: SoundPreferences = { enabled: false, volume: 0.35 };
export const SOUND_STORAGE_KEY = "pavilion-sound-v1";

export function parseSoundPreferences(value: string | null): SoundPreferences {
  try {
    const parsed: unknown = value ? JSON.parse(value) : null;
    if (parsed && typeof parsed === "object") {
      const settings = parsed as Record<string, unknown>;
      return { enabled: settings.enabled === true, volume: typeof settings.volume === "number" && Number.isFinite(settings.volume) ? Math.max(0, Math.min(1, settings.volume)) : DEFAULT_SOUND_PREFERENCES.volume };
    }
  } catch { /* A blocked or outdated preference must never break the room. */ }
  return { ...DEFAULT_SOUND_PREFERENCES };
}

function activitySound(event: SoundActivity): AuctionSound | null {
  if (event.type === "sold") return "sold";
  if (event.type === "bid") return "bid";
  if (event.type === "lock" || event.type === "auction" && /^Bidding locked\b/i.test(event.text)) return "lock";
  return null;
}

/**
 * Feed confirmed snapshots, including while muted. Initial room state, a reconnect,
 * an old snapshot and history backfill are silent. IDs are bounded to 512 entries.
 */
export class LiveAuctionSoundTracker {
  private roomId: string | null = null;
  private ready = false;
  private watermark = -Infinity;
  private seen = new Set<string>();

  observe(roomId: string, activity: readonly SoundActivity[], connected = true): AuctionSound[] {
    if (roomId !== this.roomId) {
      this.roomId = roomId;
      this.ready = false;
      this.watermark = -Infinity;
      this.seen.clear();
    }
    const baseline = !this.ready || !connected;
    const previousWatermark = this.watermark;
    const sounds: AuctionSound[] = [];
    for (const event of activity) {
      if (!event.id || !Number.isFinite(event.at)) continue;
      if (!baseline && !this.seen.has(event.id) && event.at >= previousWatermark) {
        const sound = activitySound(event);
        if (sound) sounds.push(sound);
      }
      this.seen.add(event.id);
      this.watermark = Math.max(this.watermark, event.at);
    }
    this.ready = connected;
    while (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
    // A delayed poll should not produce a volley of clicks. A sale takes priority.
    if (sounds.includes("sold")) return ["sold"];
    if (sounds.includes("lock")) return ["lock"];
    return sounds.includes("bid") ? ["bid"] : [];
  }
}

const CUE_DURATIONS: Record<AuctionSound, number> = { bid: 0.32, lock: 0.24, navigate: 0.25, sold: 1.85 };
export type RenderedAuctionSound = { sampleRate: number; channels: [Float32Array, Float32Array] };

/**
 * Render original foley into a short stereo sample. Inharmonic, rapidly decaying
 * modes model wooden impacts; filtered transients model handclaps and brushed air.
 * A fixed seed makes the cue testable and avoids network or decoding latency.
 */
export function renderAuctionSound(sound: AuctionSound, sampleRate = 48000): RenderedAuctionSound {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError("Unsupported audio sample rate.");
  const size = Math.ceil(CUE_DURATIONS[sound] * sampleRate);
  const channels: [Float32Array, Float32Array] = [new Float32Array(size), new Float32Array(size)];
  let seed = { bid: 1379, lock: 2657, navigate: 6043, sold: 8123 }[sound];
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const add = (index: number, value: number, pan: number) => {
    if (index >= size) return;
    channels[0][index] += value * Math.cos((pan + 1) * Math.PI / 4);
    channels[1][index] += value * Math.sin((pan + 1) * Math.PI / 4);
  };

  const wood = (start: number, level: number, heavy: boolean, pan = 0) => {
    const frequencies = heavy ? [115, 247, 511, 1019, 1847, 3311] : [213, 527, 1091, 1933, 3203, 4871];
    const decays = heavy ? [0.058, 0.043, 0.025, 0.015, 0.009, 0.005] : [0.032, 0.026, 0.016, 0.01, 0.006, 0.003];
    const weights = [0.28, 0.32, 0.26, 0.19, 0.13, 0.08];
    const offset = Math.floor(start * sampleRate);
    let lowNoise = 0;
    for (let index = 0; index < Math.floor((heavy ? 0.24 : 0.16) * sampleRate); index++) {
      const t = index / sampleRate;
      const noise = random() * 2 - 1;
      lowNoise += 0.37 * (noise - lowNoise);
      let sample = (noise - lowNoise) * Math.exp(-t / 0.0028) * 1.15;
      for (let mode = 0; mode < frequencies.length; mode++) {
        sample += Math.sin(2 * Math.PI * frequencies[mode] * t) * Math.exp(-t / decays[mode]) * weights[mode];
      }
      // A sub-millisecond rounded attack retains the crack without a digital click.
      add(offset + index, sample * (1 - Math.exp(-t / 0.00022)) * level, pan);
    }
  };

  const brush = (start: number, duration: number, level: number, direction: number) => {
    const offset = Math.floor(start * sampleRate);
    const count = Math.floor(duration * sampleRate);
    let low = 0, body = 0;
    for (let index = 0; index < count; index++) {
      const progress = index / count;
      const noise = random() * 2 - 1;
      const cutoff = 2200 - 1600 * progress;
      low += (1 - Math.exp(-2 * Math.PI * cutoff / sampleRate)) * (noise - low);
      body += (1 - Math.exp(-2 * Math.PI * 260 / sampleRate)) * (noise - body);
      const envelope = Math.pow(Math.sin(Math.PI * progress), 2.3);
      add(offset + index, (low - body) * envelope * level, (progress * 1.4 - 0.7) * direction);
    }
  };

  const clap = (start: number, level: number, pan: number) => {
    const offset = Math.floor(start * sampleRate);
    const count = Math.floor(0.11 * sampleRate);
    let low = 0, bass = 0;
    const tail = 0.012 + random() * 0.018;
    for (let index = 0; index < count; index++) {
      const t = index / sampleRate;
      const noise = random() * 2 - 1;
      low += 0.48 * (noise - low);
      bass += 0.075 * (noise - bass);
      // The palm and fingers contact at slightly different times.
      const envelope = Math.exp(-t / tail)
        + (t > 0.008 ? 0.6 * Math.exp(-(t - 0.008) / 0.006) : 0)
        + (t > 0.016 ? 0.3 * Math.exp(-(t - 0.016) / 0.004) : 0);
      add(offset + index, (low - bass) * envelope * Math.min(1, t / 0.0005) * level, pan);
    }
  };

  if (sound === "bid") {
    wood(0.008, 0.92, false, -0.04);
  } else if (sound === "lock") {
    wood(0.006, 0.39, false, -0.1);
    wood(0.052, 0.23, true, 0.1);
    brush(0.017, 0.072, 0.075, -1);
  } else if (sound === "navigate") {
    brush(0.006, 0.18, 0.28, 1);
    brush(0.045, 0.14, 0.075, -1);
  } else {
    wood(0.01, 1, true);
    wood(0.108, 0.19, true, 0.08);
    // A brief, irregular stereo applause burst, never a sustained ambient loop.
    for (let index = 0; index < 64; index++) {
      const progress = index / 64;
      const start = 0.2 + progress * 1.12 + random() * 0.05;
      const level = (0.075 + random() * 0.065) * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * progress)), 1.3);
      clap(start, level, random() * 1.8 - 0.9);
    }
  }

  // Sparse early reflections give body and width without a long, muddy reverb.
  const dry = channels.map(channel => channel.slice());
  const reflections = sound === "sold" ? [[0.031, 0.12], [0.057, 0.085], [0.093, 0.045]] : [[0.019, 0.09], [0.037, 0.045]];
  for (const [delay, level] of reflections) {
    const offset = Math.round(delay * sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      for (let index = offset; index < size; index++) channels[channel][index] += dry[1 - channel][index - offset] * level;
    }
  }
  // Remove DC, reserve headroom, and fade both boundaries to guarantee clean stops.
  let peak = 0;
  for (const channel of channels) {
    let previousInput = 0, previousOutput = 0;
    for (let index = 0; index < size; index++) {
      const input = channel[index];
      const output = input - previousInput + 0.995 * previousOutput;
      previousInput = input;
      previousOutput = output;
      channel[index] = output * Math.min(1, index / (sampleRate * 0.002), (size - 1 - index) / (sampleRate * 0.018));
      peak = Math.max(peak, Math.abs(channel[index]));
    }
  }
  const level = { bid: 0.71, lock: 0.42, navigate: 0.13, sold: 0.82 }[sound] / Math.max(peak, 0.001);
  for (const channel of channels) for (let index = 0; index < size; index++) channel[index] *= level;
  return { sampleRate, channels };
}

/** One AudioContext and at most six sample voices; unlock only from a user gesture. */
export class AuctionAudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private samples = new Map<AuctionSound, AudioBuffer>();
  private active = new Set<AudioBufferSourceNode>();
  private preferences = { ...DEFAULT_SOUND_PREFERENCES };
  private lastPlayed: Partial<Record<AuctionSound, number>> = {};

  setPreferences(preferences: SoundPreferences) {
    this.preferences = { enabled: preferences.enabled, volume: Number.isFinite(preferences.volume) ? Math.max(0, Math.min(1, preferences.volume)) : DEFAULT_SOUND_PREFERENCES.volume };
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(preferences.enabled ? this.preferences.volume : 0, this.context.currentTime, 0.018);
    }
  }

  async unlock(): Promise<boolean> {
    if (typeof window === "undefined" || !this.preferences.enabled) return false;
    try {
      const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) return false;
      if (!this.context || this.context.state === "closed") {
        this.context = new AudioContextConstructor({ latencyHint: "interactive" });
        this.master = this.context.createGain();
        this.master.gain.value = this.preferences.volume;
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -8;
        limiter.knee.value = 8;
        limiter.ratio.value = 8;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.12;
        this.master.connect(limiter);
        limiter.connect(this.context.destination);
      }
      if (this.context.state === "suspended") await this.context.resume();
      return this.context.state === "running";
    } catch { return false; }
  }

  play(sound: AuctionSound): boolean {
    const context = this.context;
    if (!context || context.state !== "running" || !this.master || !this.preferences.enabled || this.preferences.volume === 0 || this.active.size >= 6) return false;
    if (context.currentTime - (this.lastPlayed[sound] ?? -Infinity) < (sound === "navigate" ? 0.12 : 0.09)) return false;
    let buffer = this.samples.get(sound);
    if (!buffer) {
      // Generate only the cue that is actually used, then keep that one sample.
      const rendered = renderAuctionSound(sound, context.sampleRate);
      buffer = context.createBuffer(2, rendered.channels[0].length, rendered.sampleRate);
      rendered.channels.forEach((channel, index) => buffer!.getChannelData(index).set(channel));
      this.samples.set(sound, buffer);
    }
    const time = context.currentTime;
    this.lastPlayed[sound] = time;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    this.active.add(source);
    source.onended = () => { this.active.delete(source); source.disconnect(); };
    source.start(time);
    return true;
  }

  dispose() {
    this.active.forEach(source => { try { source.stop(); } catch { /* Already ended. */ } });
    this.active.clear();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
    this.samples.clear();
    this.lastPlayed = {};
  }
}
