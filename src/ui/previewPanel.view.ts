// src/ui/previewPanel.view.ts
// Pure view-model for the preview panel: no Spicetify, no DOM. Turns engine
// state into a PanelView, maps keyboard events to panel actions, and computes
// the progress-bar fraction from a raw ProgressSample.
import type { TrackRef, PanelView, ProgressMode, ProgressSample } from "../types/domain";

/** Describes the session the current entry belongs to. */
export interface SessionContext {
  /** null = single-track session (no collection). */
  label: string | null;
  removable: boolean;
}

export function toPanelView(i: {
  state: "playing" | "skipping";
  track: TrackRef;
  index: number;
  total: number;
  session: SessionContext;
  progress: ProgressMode;
}): PanelView {
  const { state, track, index, total, session, progress } = i;
  const heading = track.artist === "" ? track.name : `${track.name} — ${track.artist}`;
  const sourceText =
    session.label === null ? "Single track" : `From: ${session.label} · ${index + 1}/${total}`;
  const artworkUrl = state === "skipping" ? null : track.artworkUrl ?? null;
  const indicator = state === "skipping" ? "No preview — skipping" : null;
  const nextDisabled = index >= total - 1;
  const removeLabel = session.removable ? `Remove from ${session.label}` : null;

  return {
    state,
    heading,
    artworkUrl,
    sourceText,
    indicator,
    nextDisabled,
    removeLabel,
    progress,
  };
}

/** Keys the panel always consumes; a keydown handler should preventDefault() on these. */
export const PANEL_KEYS: ReadonlySet<string> = new Set(["ArrowRight", "Delete", "Escape"]);

export function panelKeyAction(
  e: { key: string; repeat: boolean },
  view: PanelView,
): "next" | "remove" | "close" | null {
  if (e.repeat) return null;
  switch (e.key) {
    case "ArrowRight":
      return view.nextDisabled ? null : "next";
    case "Delete":
      return view.removeLabel === null ? null : "remove";
    case "Escape":
      return "close";
    default:
      return null;
  }
}

/**
 * Fraction (0..1) of the effective preview window that has elapsed. The
 * effective window is the clip's own duration capped by `durationCapMs`;
 * when the clip duration isn't a finite positive number, the cap alone is
 * the window. A null sample (no clip loaded) is 0.
 */
export function progressFraction(sample: ProgressSample | null, durationCapMs: number): number {
  if (sample === null) return 0;
  const { elapsedMs, clipDurationMs } = sample;
  const effectiveWindowMs =
    Number.isFinite(clipDurationMs) && clipDurationMs > 0
      ? Math.min(clipDurationMs, durationCapMs)
      : durationCapMs;
  const fraction = elapsedMs / effectiveWindowMs;
  return Math.min(1, Math.max(0, fraction));
}
