import { DEFAULT_SETTINGS, type PreviewSettings, type CollectionType } from "./types/domain";

export interface StoragePort {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const KEY = "track-playlist-preview:settings";

export function createSettings(storage: StoragePort) {
  let current = load();

  function load(): PreviewSettings {
    const raw = storage.get(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    try {
      const parsed = JSON.parse(raw) as Partial<PreviewSettings>;
      return {
        durationMs: typeof parsed.durationMs === "number" ? parsed.durationMs : DEFAULT_SETTINGS.durationMs,
        gapMs: typeof parsed.gapMs === "number" ? parsed.gapMs : DEFAULT_SETTINGS.gapMs,
        enabled: { ...DEFAULT_SETTINGS.enabled, ...(parsed.enabled ?? {}) },
      };
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  function persist(): void {
    storage.set(KEY, JSON.stringify(current));
  }

  return {
    getDurationMs: (): number => current.durationMs,
    getGapMs: (): number => current.gapMs,
    isEnabled: (type: CollectionType): boolean => current.enabled[type],
    setDurationMs(ms: number): void {
      current.durationMs = ms;
      persist();
    },
    setGapMs(ms: number): void {
      current.gapMs = ms;
      persist();
    },
    setEnabled(type: CollectionType, on: boolean): void {
      current.enabled[type] = on;
      persist();
    },
    snapshot: (): PreviewSettings => structuredClone(current),
  };
}

export type Settings = ReturnType<typeof createSettings>;
