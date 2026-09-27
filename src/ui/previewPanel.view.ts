// src/ui/previewPanel.view.ts
// Pure view-model for the preview panel: no Spicetify, no DOM. Turns engine
// state into a PanelView, maps keyboard events to panel actions, and computes
// the progress-bar fraction from a raw ProgressSample.
import type { TrackRef, PanelView, ProgressMode, ProgressSample, PanelPosition } from "../types/domain";

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

/** Fixed panel height; the stack's anchor is computed from it (previewPanel.css). */
export const PANEL_HEIGHT_PX = 384;
/** Fixed panel and stack width (previewPanel.css). */
export const PANEL_WIDTH_PX = 280;
const EDGE_GAP_PX = 16;
const STACK_GAP_PX = 8;
const BOTTOM_DOCK_TOLERANCE_PX = 8;
/** One pending-removal row (live height 62 px), so the stack never collapses to zero (AC67). */
const MIN_STACK_ROOM_PX = 64;
/** Clears a bottom Playbar-sized strip and the bottom-centre notice area. */
const FALLBACK_BOTTOM_PX = 104;
/** Spotify's 64 px top bar plus a gap, when `.Root__globalNav` isn't measurable. */
const DEFAULT_TOP_CLEARANCE_PX = 72;

/** Where the stack sits relative to the panel. */
export type StackSide = "above" | "below";

/**
 * Right edge: panel anchored by `right` + `bottom`, stack 8 px above it.
 * Over the Playbar: panel anchored by `right` + `top`, stack above or below it.
 * Window centre: panel and stack placed by CSS; only the ceiling is measured.
 * `topClearancePx` is the lowest y the stack may grow up to (the stack ceiling).
 */
export type PanelPlacement =
  | { position: "right"; rightPx: number; bottomPx: number; topClearancePx: number }
  | { position: "playbar"; rightPx: number; topPx: number; stack: StackSide; topClearancePx: number }
  | { position: "centre"; topClearancePx: number };

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));

/**
 * Where the panel and stack go for a Panel position, from the Playbar
 * (`.Root__now-playing-bar`) and global-nav rects measured at the moment of
 * placement (panel spec: Layering → Placement, AC70; panel-position spec: Geometry).
 */
export function panelPlacement(i: {
  position: PanelPosition;
  bar: { top: number; bottom: number; left: number; right: number } | null;
  nav: { bottom: number } | null;
  innerWidth: number;
  innerHeight: number;
}): PanelPlacement {
  const { position, bar, nav, innerWidth, innerHeight } = i;
  const topBar = nav === null ? DEFAULT_TOP_CLEARANCE_PX : nav.bottom + STACK_GAP_PX;
  if (position === "centre") return { position, topClearancePx: topBar };
  if (position === "playbar") {
    if (bar === null) return panelPlacement({ ...i, position: "right" });
    // Lower bound wins when the window is smaller than the panel plus gaps.
    const left = clamp((bar.left + bar.right) / 2 - PANEL_WIDTH_PX / 2, EDGE_GAP_PX, innerWidth - EDGE_GAP_PX - PANEL_WIDTH_PX);
    const top = clamp((bar.top + bar.bottom) / 2 - PANEL_HEIGHT_PX / 2, EDGE_GAP_PX, innerHeight - EDGE_GAP_PX - PANEL_HEIGHT_PX);
    const stack: StackSide = top - STACK_GAP_PX - topBar >= MIN_STACK_ROOM_PX ? "above" : "below";
    return { position, rightPx: innerWidth - left - PANEL_WIDTH_PX, topPx: top, stack, topClearancePx: topBar };
  }
  if (bar === null) {
    return { position, rightPx: EDGE_GAP_PX, bottomPx: FALLBACK_BOTTOM_PX, topClearancePx: topBar };
  }
  if (bar.bottom >= innerHeight - BOTTOM_DOCK_TOLERANCE_PX) {
    return { position, rightPx: EDGE_GAP_PX, bottomPx: innerHeight - bar.top + EDGE_GAP_PX, topClearancePx: topBar };
  }
  // Not bottom-docked (e.g. the top-right dock of global-nav-centered).
  const roomBelow = innerHeight - bar.bottom - STACK_GAP_PX - EDGE_GAP_PX;
  if (roomBelow >= PANEL_HEIGHT_PX + STACK_GAP_PX + MIN_STACK_ROOM_PX) {
    return { position, rightPx: EDGE_GAP_PX, bottomPx: EDGE_GAP_PX, topClearancePx: bar.bottom + STACK_GAP_PX };
  }
  // Left of the Playbar's column; raised clear of the bottom-centre notice.
  return { position, rightPx: innerWidth - bar.left + EDGE_GAP_PX, bottomPx: FALLBACK_BOTTOM_PX, topClearancePx: topBar };
}
