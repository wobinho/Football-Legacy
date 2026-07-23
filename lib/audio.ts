// Audio playback (background music + UI sound effects).
//
// Framework-free, exactly like the rest of lib/: a single module-level manager
// owns the <audio> elements and every setting, React only subscribes to it. That
// keeps the soundtrack alive across screen changes and re-renders — mounting an
// <audio> element inside a component would restart the track every time the
// Continue button bumped `rev`.
//
// Two constraints shape the design:
//
//  • Browsers block autoplay until the user has interacted with the page. The
//    manager therefore ARMS itself on the first pointer/key event and starts the
//    music then, rather than throwing on load.
//  • Sound effects fire far more often than a single element can handle (a click
//    while the previous click is still ringing). The SFX side keeps a small pool
//    of pre-loaded elements and rotates through it.
//
// Settings persist to localStorage so a manager's choice survives a reload.

import {
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SFX_VOLUME,
  MUSIC,
  SFX,
  trackUrl,
  type SfxName,
  type Track,
} from "./config/audio";

const STORAGE_KEY = "fl.audio";

export interface AudioSettings {
  musicEnabled: boolean;
  musicVolume: number; // 0..1
  sfxEnabled: boolean;
  sfxVolume: number; // 0..1
}

const DEFAULTS: AudioSettings = {
  musicEnabled: true,
  musicVolume: DEFAULT_MUSIC_VOLUME,
  sfxEnabled: true,
  sfxVolume: DEFAULT_SFX_VOLUME,
};

/** What the UI renders: the settings plus the live playback state. */
export interface AudioState extends AudioSettings {
  /** The track currently loaded, or null before the player has started. */
  current: Track | null;
  playing: boolean;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function loadSettings(): AudioSettings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const saved = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      musicEnabled: saved.musicEnabled ?? DEFAULTS.musicEnabled,
      musicVolume: clamp01(saved.musicVolume ?? DEFAULTS.musicVolume),
      sfxEnabled: saved.sfxEnabled ?? DEFAULTS.sfxEnabled,
      sfxVolume: clamp01(saved.sfxVolume ?? DEFAULTS.sfxVolume),
    };
  } catch {
    // Unreadable or corrupt (private mode, hand-edited) — the defaults stand.
    return { ...DEFAULTS };
  }
}

/**
 * The audio manager. One instance per page, created lazily on first use so the
 * module stays import-safe on the server (no `new Audio()` at module scope).
 */
class AudioManager {
  private settings: AudioSettings = loadSettings();
  private music: HTMLAudioElement | null = null;
  private sfxPool: HTMLAudioElement[] = [];
  private sfxIndex = 0;
  /** Shuffled playlist order and the cursor into it. */
  private order: number[] = [];
  private cursor = 0;
  private playing = false;
  private armed = false;
  private listeners = new Set<() => void>();
  /** Cached immutable snapshot — useSyncExternalStore requires a stable
   * reference between notifications, or React re-renders forever. */
  private snapshot: AudioState | null = null;

  // ── Subscription (React binds through useSyncExternalStore) ──────────────

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): AudioState => {
    if (!this.snapshot) {
      this.snapshot = {
        ...this.settings,
        current: this.order.length ? MUSIC[this.order[this.cursor]] : null,
        playing: this.playing,
      };
    }
    return this.snapshot;
  };

  /** Server render: the defaults, with nothing playing. */
  getServerSnapshot = (): AudioState => ({ ...DEFAULTS, current: null, playing: false });

  private emit() {
    this.snapshot = null; // invalidate; next getSnapshot rebuilds
    for (const fn of this.listeners) fn();
  }

  private persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Storage unavailable — the setting still applies for this session.
    }
  }

  // ── Playlist ────────────────────────────────────────────────────────────

  /** Fisher-Yates over the track indices. Uses Math.random deliberately: the
   * soundtrack is presentation, not simulation, so it is exempt from the
   * determinism rule that governs lib/rng.ts. */
  private shuffle() {
    const idx = MUSIC.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    this.order = idx;
    this.cursor = 0;
  }

  // ── Boot ────────────────────────────────────────────────────────────────

  /**
   * Prepare the elements and, if music is enabled, try to start. Safe to call
   * repeatedly. Autoplay rejection is expected on a cold load and is handled by
   * arming a one-shot gesture listener instead of surfacing an error.
   */
  init() {
    if (typeof window === "undefined" || this.music) return;

    this.shuffle();

    const el = new Audio();
    el.preload = "auto";
    el.volume = this.settings.musicVolume;
    // Advance the playlist when a track finishes; wrap by reshuffling so the
    // same order never repeats back-to-back.
    el.addEventListener("ended", () => this.next());
    // A missing/corrupt file must not kill the soundtrack — skip to the next.
    el.addEventListener("error", () => {
      if (this.playing) this.next();
    });
    this.music = el;

    // SFX pool: four elements is plenty for click-rate interaction.
    this.sfxPool = Array.from({ length: 4 }, () => {
      const s = new Audio(SFX.click);
      s.preload = "auto";
      s.volume = this.settings.sfxVolume;
      return s;
    });

    this.loadCurrent();
    if (this.settings.musicEnabled) void this.play();
    this.arm();
  }

  /** Start (or resume) on the first user gesture, which is the only moment a
   * browser will honour an unmuted play(). Removes itself once it fires. */
  private arm() {
    if (this.armed || typeof window === "undefined") return;
    this.armed = true;
    const onGesture = () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      this.armed = false;
      if (this.settings.musicEnabled && !this.playing) void this.play();
    };
    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });
  }

  private loadCurrent() {
    if (!this.music || !this.order.length) return;
    this.music.src = trackUrl(MUSIC[this.order[this.cursor]]);
  }

  // ── Transport ───────────────────────────────────────────────────────────

  private async play() {
    if (!this.music) return;
    try {
      await this.music.play();
      this.playing = true;
      this.emit();
    } catch {
      // Autoplay blocked. Stay silent and wait for a gesture; `arm()` is
      // already listening (or will be re-armed by the caller).
      this.playing = false;
      this.emit();
      this.arm();
    }
  }

  pause() {
    if (!this.music) return;
    this.music.pause();
    this.playing = false;
    this.emit();
  }

  /** Skip to the next track, reshuffling when the playlist wraps. */
  next() {
    if (!this.music || !this.order.length) return;
    this.cursor += 1;
    if (this.cursor >= this.order.length) this.shuffle();
    this.loadCurrent();
    this.emit();
    if (this.settings.musicEnabled) void this.play();
  }

  prev() {
    if (!this.music || !this.order.length) return;
    // Standard media behaviour: restart the track unless we're near its start.
    if (this.music.currentTime > 3) {
      this.music.currentTime = 0;
      return;
    }
    this.cursor = this.cursor > 0 ? this.cursor - 1 : this.order.length - 1;
    this.loadCurrent();
    this.emit();
    if (this.settings.musicEnabled) void this.play();
  }

  toggleMusic() {
    this.setMusicEnabled(!this.settings.musicEnabled);
  }

  // ── Settings ────────────────────────────────────────────────────────────

  setMusicEnabled(on: boolean) {
    this.settings.musicEnabled = on;
    this.persist();
    if (on) {
      this.init();
      void this.play();
    } else {
      this.pause();
    }
    this.emit();
  }

  setMusicVolume(v: number) {
    this.settings.musicVolume = clamp01(v);
    if (this.music) this.music.volume = this.settings.musicVolume;
    this.persist();
    this.emit();
  }

  setSfxEnabled(on: boolean) {
    this.settings.sfxEnabled = on;
    this.persist();
    this.emit();
  }

  setSfxVolume(v: number) {
    this.settings.sfxVolume = clamp01(v);
    for (const s of this.sfxPool) s.volume = this.settings.sfxVolume;
    this.persist();
    this.emit();
  }

  // ── Sound effects ───────────────────────────────────────────────────────

  /**
   * Fire a one-shot effect. Rotates through the pool so overlapping plays don't
   * cut each other off, and never throws — a blocked or unloaded sound is not
   * worth interrupting the game for.
   */
  playSfx(_name: SfxName = "click") {
    if (!this.settings.sfxEnabled || !this.sfxPool.length) return;
    const el = this.sfxPool[this.sfxIndex];
    this.sfxIndex = (this.sfxIndex + 1) % this.sfxPool.length;
    try {
      el.currentTime = 0;
      const p = el.play();
      if (p) void p.catch(() => {});
    } catch {
      // Ignore — an effect that can't play is a non-event.
    }
  }
}

/** The single manager instance for the page. */
export const audio = new AudioManager();

/** Convenience for call sites that only want the click. */
export function playClick() {
  audio.playSfx("click");
}
