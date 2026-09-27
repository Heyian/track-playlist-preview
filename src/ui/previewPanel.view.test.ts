import { describe, it, expect } from "vitest";
import { toPanelView, panelKeyAction, progressFraction, PANEL_KEYS } from "./previewPanel.view";
import type { TrackRef } from "../types/domain";

const song: TrackRef = { uri: "spotify:track:s", name: "Song", artist: "Band", artworkUrl: "u" };
const coll = { label: "Chill Mix", removable: true };

describe("toPanelView", () => {
  it("AC47/AC48/AC68: playing view in a removable collection session", () => {
    expect(
      toPanelView({ state: "playing", track: song, index: 3, total: 37, session: coll, progress: "live" }),
    ).toEqual({
      state: "playing",
      heading: "Song — Band",
      artworkUrl: "u",
      sourceText: "From: Chill Mix · 4/37",
      indicator: null,
      nextDisabled: false,
      removeLabel: "Remove from Chill Mix",
      progress: "live",
    });
  });

  it("AC48: single-track session shows the indicator and no counter", () => {
    const v = toPanelView({
      state: "playing",
      track: song,
      index: 0,
      total: 1,
      session: { label: null, removable: false },
      progress: "live",
    });
    expect(v.sourceText).toBe("Single track");
    expect(v.sourceText).not.toMatch(/\d+\/\d+/);
    expect(v.nextDisabled).toBe(true);
  });

  it("AC52: Next disabled on the last entry only", () => {
    const last = toPanelView({ state: "playing", track: song, index: 36, total: 37, session: coll, progress: "live" });
    expect(last.nextDisabled).toBe(true);
    const notLast = toPanelView({ state: "playing", track: song, index: 35, total: 37, session: coll, progress: "live" });
    expect(notLast.nextDisabled).toBe(false);
  });

  it("AC68/R2: not removable → no Remove label", () => {
    const v = toPanelView({
      state: "playing",
      track: song,
      index: 3,
      total: 37,
      session: { label: "Chill Mix", removable: false },
      progress: "live",
    });
    expect(v.removeLabel).toBeNull();
  });

  it("AC47: absent artwork → null", () => {
    const noArt: TrackRef = { uri: "spotify:track:x", name: "Song", artist: "Band" };
    const v = toPanelView({ state: "playing", track: noArt, index: 0, total: 1, session: coll, progress: "live" });
    expect(v.artworkUrl).toBeNull();
  });

  it("AC61: skipping view — indicator, placeholder, empty bar, counter only for collections", () => {
    const collView = toPanelView({ state: "skipping", track: song, index: 3, total: 37, session: coll, progress: "empty" });
    expect(collView).toEqual({
      state: "skipping",
      heading: "Song — Band",
      artworkUrl: null,
      sourceText: "From: Chill Mix · 4/37",
      indicator: "No preview — skipping",
      nextDisabled: false,
      removeLabel: "Remove from Chill Mix",
      progress: "empty",
    });

    const singleView = toPanelView({
      state: "skipping",
      track: song,
      index: 0,
      total: 1,
      session: { label: null, removable: false },
      progress: "empty",
    });
    expect(singleView.sourceText).toBe("Single track");
    expect(singleView.artworkUrl).toBeNull();
    expect(singleView.indicator).toBe("No preview — skipping");
  });

  it("Review focus 4: empty artist → heading is the title alone", () => {
    const noArtist: TrackRef = { uri: "spotify:track:y", name: "Song", artist: "" };
    const v = toPanelView({ state: "playing", track: noArtist, index: 0, total: 1, session: coll, progress: "live" });
    expect(v.heading).toBe("Song");
  });
});

describe("panelKeyAction", () => {
  const playableView = toPanelView({ state: "playing", track: song, index: 3, total: 37, session: coll, progress: "live" });
  const lastView = toPanelView({ state: "playing", track: song, index: 36, total: 37, session: coll, progress: "live" });
  const notRemovableView = toPanelView({
    state: "playing",
    track: song,
    index: 3,
    total: 37,
    session: { label: "Chill Mix", removable: false },
    progress: "live",
  });

  it("AC66: key mapping", () => {
    expect(panelKeyAction({ key: "ArrowRight", repeat: false }, playableView)).toBe("next");
    expect(panelKeyAction({ key: "ArrowRight", repeat: false }, lastView)).toBeNull();
    expect(panelKeyAction({ key: "Delete", repeat: false }, playableView)).toBe("remove");
    expect(panelKeyAction({ key: "Delete", repeat: false }, notRemovableView)).toBeNull();
    expect(panelKeyAction({ key: "Escape", repeat: false }, playableView)).toBe("close");
    expect(panelKeyAction({ key: "a", repeat: false }, playableView)).toBeNull();
    expect(PANEL_KEYS.size).toBe(3);
    expect(PANEL_KEYS.has("ArrowRight")).toBe(true);
    expect(PANEL_KEYS.has("Delete")).toBe(true);
    expect(PANEL_KEYS.has("Escape")).toBe(true);
  });

  it("Review focus 2: auto-repeated Delete does nothing", () => {
    expect(panelKeyAction({ key: "Delete", repeat: true }, playableView)).toBeNull();
  });
});

describe("progressFraction", () => {
  it("AC53: progress against the effective preview window", () => {
    expect(progressFraction({ elapsedMs: 5000, clipDurationMs: 30000 }, 15000)).toBeCloseTo(1 / 3);
    expect(progressFraction({ elapsedMs: 3000, clipDurationMs: 10000 }, 15000)).toBeCloseTo(0.3);
    expect(progressFraction({ elapsedMs: 3000, clipDurationMs: NaN }, 15000)).toBeCloseTo(0.2);
    expect(progressFraction({ elapsedMs: 99999, clipDurationMs: 30000 }, 15000)).toBe(1);
    expect(progressFraction(null, 15000)).toBe(0);
  });
});
