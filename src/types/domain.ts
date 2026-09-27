// src/types/domain.ts
// Shared, framework-free domain types. No Spicetify/DOM references — these must
// compile and run under Vitest.

export interface TrackRef {
  uri: string;
  name: string;
  artist: string;
  artworkUrl?: string;
}

export type CollectionType = "playlist" | "likedSongs" | "album" | "artist";

export interface PreviewSettings {
  durationMs: number;
  gapMs: number;
  enabled: Record<CollectionType, boolean>;
}

export const DEFAULT_SETTINGS: PreviewSettings = {
  durationMs: 15000,
  gapMs: 0,
  enabled: { playlist: true, likedSongs: true, album: true, artist: true },
};

/** Callbacks the engine hands to the audio port for one clip. */
export interface AudioHandlers {
  /** Fired when the clip reaches its natural end. */
  onEnded: () => void;
  /** Fired when the clip URL 404s or the element raises an error. */
  onError: () => void;
}

/** Plays and stops a single preview clip. The engine owns no <Audio>. */
export interface AudioPort {
  play(url: string, handlers: AudioHandlers): void;
  stop(): void;
}

export type TimerId = number;

/** Timer access, injected so the engine stays pure and testable. */
export interface TimerPort {
  setTimeout(callback: () => void, ms: number): TimerId;
  clearTimeout(id: TimerId): void;
}

/** Resolve one track URI to a clip URL, or null when no clip exists. */
export type ResolvePort = (uri: string) => Promise<string | null>;

/** Live settings read per-track so mid-session changes take effect (AC45). */
export interface EngineConfigPort {
  getDurationMs(): number;
  getGapMs(): number;
}

export type SkipReason = "missing" | "error";
export type EndReason = "completed" | "stopped" | "replaced" | "aborted";

export type EngineEvent =
  | { type: "trackStarted"; index: number; total: number; track: TrackRef }
  | { type: "trackSkipped"; index: number; total: number; track: TrackRef; reason: SkipReason }
  | { type: "sessionEnded"; skipped: number; reason: EndReason };

export type EngineListener = (event: EngineEvent) => void;
