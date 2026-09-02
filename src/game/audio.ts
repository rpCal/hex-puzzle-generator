/**
 * Sound, synthesised on the fly.
 *
 * There are no audio files. Every sound the game makes is a few oscillators through an envelope,
 * which means: nothing to download, nothing to licence, no asset budget, and the pitch can vary
 * with the size of the cluster that just snapped — something a fixed sample cannot do.
 *
 * The context starts suspended until a real gesture unlocks it, because browsers require that and
 * because a game that makes noise before you touch it is a game people mute.
 */

export interface AudioOptions {
  volume?: number;
  muted?: boolean;
}

export class GameAudio {
  #context: AudioContext | null = null;
  #master: GainNode | null = null;
  #volume: number;
  #muted: boolean;
  #unlocked = false;

  constructor(options: AudioOptions = {}) {
    this.#volume = options.volume ?? 0.6;
    this.#muted = options.muted ?? false;
  }

  get isAvailable(): boolean {
    return typeof globalThis.AudioContext === 'function';
  }

  get volume(): number {
    return this.#volume;
  }

  setVolume(value: number): void {
    this.#volume = Math.min(1, Math.max(0, value));
    if (this.#master !== null) this.#master.gain.value = this.#muted ? 0 : this.#volume;
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    if (this.#master !== null) this.#master.gain.value = muted ? 0 : this.#volume;
  }

  /** Create or resume the context. Must be called from inside a user gesture. */
  unlock(): void {
    if (!this.isAvailable) return;
    try {
      if (this.#context === null) {
        this.#context = new AudioContext();
        this.#master = this.#context.createGain();
        this.#master.gain.value = this.#muted ? 0 : this.#volume;
        this.#master.connect(this.#context.destination);
      }
      void this.#context.resume();
      this.#unlocked = true;
    } catch {
      // An unavailable audio device is not a reason to stop the game.
      this.#context = null;
      this.#master = null;
    }
  }

  get isUnlocked(): boolean {
    return this.#unlocked && this.#context !== null;
  }

  #tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    detune = 0,
    delay = 0,
  ): void {
    const context = this.#context;
    const master = this.#master;
    if (context === null || master === null || this.#muted) return;

    const start = context.currentTime + delay;
    const osc = context.createOscillator();
    const env = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    osc.detune.setValueAtTime(detune, start);

    // A very short attack and an exponential tail. Linear decay sounds synthetic; exponential is
    // what a physical object hitting another physical object actually does.
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(env);
    env.connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /**
   * The snap. Two detuned sines a fifth apart, plus a click transient.
   *
   * Pitch rises with the size of the cluster that just formed, so joining two pieces and closing a
   * forty-piece region sound different — the feedback carries information, not just confirmation.
   */
  snap(clusterSize = 2): void {
    const lift = Math.min(1, Math.log2(Math.max(2, clusterSize)) / 6);
    const base = 420 + lift * 260;
    this.#tone(base, 0.16, 'sine', 0.22);
    this.#tone(base * 1.5, 0.12, 'sine', 0.12, 7);
    this.#tone(base * 3.1, 0.045, 'triangle', 0.07);
  }

  /** Pick-up: a soft low thud, so grabbing a piece has weight. */
  pickup(): void {
    this.#tone(180, 0.09, 'sine', 0.12);
  }

  /** A rejected drop. Deliberately quiet and low: a nudge, not a buzzer. */
  reject(): void {
    this.#tone(140, 0.08, 'triangle', 0.05);
  }

  /** Hint: a rising two-note figure. */
  hint(): void {
    this.#tone(660, 0.1, 'sine', 0.1);
    this.#tone(880, 0.14, 'sine', 0.1, 0, 0.09);
  }

  /** Completion: a major triad, arpeggiated, then a held root. */
  complete(): void {
    const root = 523.25;
    this.#tone(root, 0.5, 'sine', 0.16);
    this.#tone(root * 1.26, 0.45, 'sine', 0.13, 0, 0.1);
    this.#tone(root * 1.5, 0.5, 'sine', 0.13, 0, 0.2);
    this.#tone(root * 2, 0.85, 'sine', 0.1, 0, 0.32);
  }

  close(): void {
    try {
      void this.#context?.close();
    } catch {
      // Already closed, or never opened.
    }
    this.#context = null;
    this.#master = null;
    this.#unlocked = false;
  }
}
