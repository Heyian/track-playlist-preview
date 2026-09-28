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

/** Sort and filter passed to PlaylistAPI.getContents to reproduce a page's view order. */
export interface ViewOptions {
  sort?: { field: string; order?: "ASC" | "DESC" };
  filter?: string;
}

/** Metadata returned by PlaylistAPI.getMetadata; only `name` and `canRemove` are used here. */
export interface PlaylistMetadata {
  name?: unknown;
  canRemove?: unknown;
}

export type PlaylistMetadataPort = (uri: string) => Promise<PlaylistMetadata>;

/** Commits a single track's removal from a playlist (removes every copy; see R9). */
export type RemovePort = (playlistUri: string, trackUri: string) => Promise<void>;

/** Where the preview panel and the pending-removals stack are placed (panel-position spec). */
export type PanelPosition = "right" | "playbar" | "centre";

export const PANEL_POSITIONS: readonly PanelPosition[] = ["right", "playbar", "centre"];

export function isPanelPosition(v: unknown): v is PanelPosition {
  return (PANEL_POSITIONS as readonly unknown[]).includes(v);
}

export interface PreviewSettings {
  durationMs: number;
  gapMs: number;
  enabled: Record<CollectionType, boolean>;
  panelPosition: PanelPosition;
}

export const DEFAULT_SETTINGS: PreviewSettings = {
  durationMs: 15000,
  gapMs: 0,
  enabled: { playlist: true, likedSongs: true, album: true, artist: true },
  panelPosition: "right",
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
  | { type: "trackCompleted"; index: number; total: number; track: TrackRef }
  | { type: "sessionEnded"; skipped: number; reason: EndReason };

export type EngineListener = (event: EngineEvent) => void;

/** How the panel's progress bar should render (AC53/AC61). */
export type ProgressMode = "live" | "full" | "empty";

/** Everything the preview panel needs to render one entry. */
export interface PanelView {
  state: "playing" | "skipping";
  heading: string; // "Title — Artist", or "Title" when artist is ""
  artworkUrl: string | null; // null → placeholder (always null when skipping)
  sourceText: string; // "From: Chill Mix · 4/37" or "Single track"
  indicator: string | null; // "No preview — skipping" when skipping
  nextDisabled: boolean; // current entry is the last queue entry
  removeLabel: string | null; // "Remove from Chill Mix"; null → no Remove button
  progress: ProgressMode;
}

/** Adapter surface for the panel UI. Never "modal" / "popup" / "player". */
export interface PanelPort {
  open(view: PanelView): void;
  update(view: PanelView): void;
  close(): void;
}

/** A single elapsed/duration reading from the audio element. */
export interface ProgressSample {
  elapsedMs: number;
  clipDurationMs: number;
}

/** Reads current playback progress. `sample()` is null while no clip is loaded. */
export interface ProgressSource {
  sample(): ProgressSample | null;
}
