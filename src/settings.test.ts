import { describe, it, expect, vi } from "vitest";
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

const KEY = "track-playlist-preview:settings";

describe("setter limits (S10)", () => {
  it.each([
    ["setDurationMs", 999],
    ["setDurationMs", NaN],
    ["setDurationMs", Infinity],
    ["setGapMs", -1],
    ["setGapMs", NaN],
    ["setGapMs", Infinity],
  ] as const)("%s(%d) changes nothing and notifies no one", (setter, value) => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ durationMs: 8000, gapMs: 500 }) });
    const s = createSettings(storage);
    const before = storage.get(KEY);
    const listener = vi.fn();
    s.onChange(listener);

    s[setter](value);

    expect(storage.get(KEY)).toBe(before);
    expect(s.getDurationMs()).toBe(8000);
    expect(s.getGapMs()).toBe(500);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ["setDurationMs", 1000, "durationMs"],
    ["setGapMs", 0, "gapMs"],
  ] as const)("%s(%d) is accepted, persisted before one notification", (setter, value, field) => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ durationMs: 8000, gapMs: 500 }) });
    const s = createSettings(storage);
    const seen: unknown[] = [];
    s.onChange(() => seen.push(JSON.parse(storage.get(KEY)!)[field]));

    s[setter](value);

    expect(seen).toEqual([value]);
  });
});

describe("onChange (S17)", () => {
  it("setEnabled calls each listener once, after persisting", () => {
    const storage = memoryStorage();
    const s = createSettings(storage);
    const seenA: unknown[] = [];
    const b = vi.fn();
    s.onChange(() => seenA.push(JSON.parse(storage.get(KEY)!).enabled.album));
    s.onChange(b);

    s.setEnabled("album", false);

    expect(seenA).toEqual([false]);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("an unsubscribed listener is no longer called; others still are", () => {
    const s = createSettings(memoryStorage());
    const a = vi.fn();
    const b = vi.fn();
    const unsubscribeA = s.onChange(a);
    s.onChange(b);

    unsubscribeA();
    s.setGapMs(100);

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("load-time fallback (S11)", () => {
  const load = (stored: object) => createSettings(memoryStorage({ [KEY]: JSON.stringify(stored) }));

  it("out-of-limit duration and gap fall back to defaults; enabled flags are kept", () => {
    const s = load({ durationMs: 0, gapMs: -5, enabled: { album: false } });
    expect(s.getDurationMs()).toBe(15000);
    expect(s.getGapMs()).toBe(0);
    expect(s.isEnabled("album")).toBe(false);
  });

  it("each field falls back on its own", () => {
    const a = load({ durationMs: 0, gapMs: 2000 });
    expect([a.getDurationMs(), a.getGapMs()]).toEqual([15000, 2000]);
    const b = load({ durationMs: 8000, gapMs: "x" });
    expect([b.getDurationMs(), b.getGapMs()]).toEqual([8000, 0]);
  });

  it("a duration stored as a string falls back to the default", () => {
    expect(load({ durationMs: "8000" }).getDurationMs()).toBe(15000);
  });

  it("a stored object with no enabled map keeps all four types on", () => {
    const s = load({ durationMs: 3000 });
    for (const t of ["playlist", "likedSongs", "album", "artist"] as const) {
      expect(s.isEnabled(t)).toBe(true);
    }
  });
});
