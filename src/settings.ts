import { DEFAULT_SETTINGS, type PreviewSettings, type CollectionType } from "./types/domain";

export interface StoragePort {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const KEY = "track-playlist-preview:settings";

/** The shortest preview duration the store accepts (Q8). */
export const MIN_DURATION_MS = 1000;
const MIN_GAP_MS = 0;

/** A finite number at or above `min`; anything else is rejected (S10, S11). */
function isValid(v: unknown, min: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min;
}

export function createSettings(storage: StoragePort) {
  let current = load();
  const listeners = new Set<() => void>();

  function load(): PreviewSettings {
    const raw = storage.get(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    try {
      const parsed = JSON.parse(raw) as { durationMs?: unknown; gapMs?: unknown; enabled?: PreviewSettings["enabled"] };
      return {
        durationMs: isValid(parsed.durationMs, MIN_DURATION_MS) ? parsed.durationMs : DEFAULT_SETTINGS.durationMs,
        gapMs: isValid(parsed.gapMs, MIN_GAP_MS) ? parsed.gapMs : DEFAULT_SETTINGS.gapMs,
        enabled: { ...DEFAULT_SETTINGS.enabled, ...(parsed.enabled ?? {}) },
      };
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  /** Persist, then notify — a listener always sees the stored value (S10). */
  function commit(): void {
    storage.set(KEY, JSON.stringify(current));
    for (const listener of listeners) listener();
  }

  return {
    getDurationMs: (): number => current.durationMs,
    getGapMs: (): number => current.gapMs,
    isEnabled: (type: CollectionType): boolean => current.enabled[type],
    setDurationMs(ms: number): void {
      if (!isValid(ms, MIN_DURATION_MS)) return;
      current.durationMs = ms;
      commit();
    },
    setGapMs(ms: number): void {
      if (!isValid(ms, MIN_GAP_MS)) return;
      current.gapMs = ms;
      commit();
    },
    setEnabled(type: CollectionType, on: boolean): void {
      current.enabled[type] = on;
      commit();
    },
    /** Called after every accepted change; returns an unsubscribe function. */
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    snapshot: (): PreviewSettings => structuredClone(current),
  };
}

export type Settings = ReturnType<typeof createSettings>;
