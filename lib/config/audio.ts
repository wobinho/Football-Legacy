// Audio manifest. Pure data — the soundtrack and the UI sound effects, listed
// once so no component ever hard-codes a filename.
//
// The files themselves live in /public/audio and are served statically. Track
// titles are "Artist - Title" as shipped; the display name is derived from the
// same pair so the now-playing line and the credits never drift apart.

export interface Track {
  /** Filename (no directory, no extension) under /public/audio/music. */
  file: string;
  artist: string;
  title: string;
}

/** The background soundtrack, in its authored order. The player shuffles from a
 * seed of its own, so this order is only the fallback. */
export const MUSIC: Track[] = [
  { file: "aventure-cassette-groove", artist: "Aventure", title: "Cassette Groove" },
  { file: "aylex-coffee-and-streets", artist: "Aylex", title: "Coffee & Streets" },
  { file: "aylex-good-days", artist: "Aylex", title: "Good Days" },
  { file: "burgundy-x-back-alley", artist: "Burgundy X", title: "Back Alley" },
  { file: "dagored-urban-pulse", artist: "Dagored", title: "Urban Pulse" },
  { file: "moavii-sunshine", artist: "Moavii", title: "Sunshine" },
  { file: "tetuano-b-reel", artist: "Tetuano", title: "B Reel" },
  { file: "unheard-back-to-promise", artist: "Unheard", title: "Back To Promise" },
];

export function trackUrl(t: Track): string {
  return `/audio/music/${t.file}.mp3`;
}

export function trackLabel(t: Track): string {
  return `${t.artist} — ${t.title}`;
}

/** UI sound effects. One entry per sound; the click is the only one today. */
export const SFX = {
  click: "/audio/sfx/click.mp3",
} as const;

export type SfxName = keyof typeof SFX;

// ── Defaults ───────────────────────────────────────────────────────────────
// Music starts quiet and OFF-by-default is deliberately NOT the choice: the
// soundtrack is part of the game's feel. But browsers block autoplay until the
// user interacts, so the player waits for the first gesture rather than
// failing loudly (see lib/audio.ts).

export const DEFAULT_MUSIC_VOLUME = 0.35;
export const DEFAULT_SFX_VOLUME = 0.5;
