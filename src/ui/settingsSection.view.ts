// src/ui/settingsSection.view.ts
// Pure seconds <-> ms conversion for the Settings-page text rows (S7, S8).

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
