// src/ui/settingsSection.view.ts
// Pure seconds <-> ms conversion for the Settings-page text rows (S7, S8),
// and the Panel position options (P3).
import type { PanelPosition } from "../types/domain";

/** The Panel position `<select>`'s options, in display order (P3). */
export const PANEL_POSITION_OPTIONS: readonly { value: PanelPosition; label: string }[] = [
  { value: "right", label: "Right edge" },
  { value: "playbar", label: "Over the Playbar" },
  { value: "centre", label: "Window centre" },
];

/** A stored ms value shown as seconds, with no trailing zeros: 500 → "0.5". */
export function formatSeconds(ms: number): string {
  return String(ms / 1000);
}

/**
 * Typed seconds → ms, or null when the text is not a plain non-negative
 * decimal or rounds below `minMs`. A comma is accepted as the decimal point.
 */
export function parseSeconds(text: string, minMs: number): number | null {
  const s = text.trim();
  if (!/^\d+([.,]\d+)?$/.test(s)) return null;
  const ms = Math.round(Number(s.replace(",", ".")) * 1000);
  return ms < minMs ? null : ms;
}
