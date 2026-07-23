import { describe, it, expect } from "vitest";
import { createSettings, type StoragePort } from "./settings";
import { DEFAULT_SETTINGS } from "./types/domain";

function memoryStorage(seed: Record<string, string> = {}): StoragePort {
  const store = new Map(Object.entries(seed));
  return {
    get: (k) => store.get(k) ?? null,
    set: (k, v) => void store.set(k, v),
  };
}

describe("settings", () => {
  it("AC44: applies defaults when storage is empty", () => {
    const s = createSettings(memoryStorage());
    expect(s.getDurationMs()).toBe(15000);
    expect(s.getGapMs()).toBe(0);
    for (const t of ["playlist", "likedSongs", "album", "artist"] as const) {
      expect(s.isEnabled(t)).toBe(true);
    }
  });

  it("AC43: persists changes across a fresh instance over the same storage", () => {
    const storage = memoryStorage();
    const a = createSettings(storage);
    a.setDurationMs(8000);
    a.setGapMs(500);
    a.setEnabled("album", false);

    const b = createSettings(storage); // simulates a Spotify restart
    expect(b.getDurationMs()).toBe(8000);
    expect(b.getGapMs()).toBe(500);
    expect(b.isEnabled("album")).toBe(false);
    expect(b.isEnabled("playlist")).toBe(true);
  });

  it("falls back to defaults on corrupt stored JSON", () => {
    const s = createSettings(memoryStorage({ "track-playlist-preview:settings": "{not json" }));
    expect(s.snapshot()).toEqual(DEFAULT_SETTINGS);
  });

  it("merges partial stored settings onto defaults", () => {
    const s = createSettings(
      memoryStorage({ "track-playlist-preview:settings": JSON.stringify({ durationMs: 3000 }) }),
    );
    expect(s.getDurationMs()).toBe(3000);
    expect(s.getGapMs()).toBe(0);
    expect(s.isEnabled("artist")).toBe(true);
  });
});
