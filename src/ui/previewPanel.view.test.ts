import { describe, it, expect } from "vitest";
import { toPanelView, panelKeyAction, progressFraction, panelPlacement, placementStyle, PANEL_KEYS } from "./previewPanel.view";
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

describe("panelPlacement", () => {
  // Live rects from the global-nav-centered layout (task 11 S9/S9b).
  const topDockedBar = { top: 56, bottom: 472, left: 844, right: 1264 };
  const nav = { bottom: 64 };

  it("AC70: no Playbar element → bottom 104, right 16, top-bar clearance", () => {
    expect(panelPlacement({ position: "right", bar: null, nav, innerWidth: 1280, innerHeight: 800 })).toEqual({
      position: "right",
      rightPx: 16,
      bottomPx: 104,
      topClearancePx: 72,
    });
  });

  it("AC70: bottom-docked Playbar → panel 16 px above it", () => {
    const bar = { top: 712, bottom: 800, left: 0, right: 1280 };
    expect(panelPlacement({ position: "right", bar, nav, innerWidth: 1280, innerHeight: 800 })).toEqual({
      position: "right",
      rightPx: 16,
      bottomPx: 104,
      topClearancePx: 72,
    });
  });

  it("AC70: top-docked Playbar with room below → right column, stack ceiling under the Playbar", () => {
    const bar = { top: 56, bottom: 472, left: 514, right: 934 };
    expect(panelPlacement({ position: "right", bar, nav, innerWidth: 950, innerHeight: 1143 })).toEqual({
      position: "right",
      rightPx: 16,
      bottomPx: 16,
      topClearancePx: 480,
    });
  });

  it("AC70/AC67: the fit check leaves one stack row: 472 + 8 + 64 + 8 + 384 + 16 = 952", () => {
    const rightPx = (innerHeight: number) => {
      const p = panelPlacement({ position: "right", bar: topDockedBar, nav, innerWidth: 1280, innerHeight });
      if (p.position !== "right") throw new Error("expected right");
      return p.rightPx;
    };
    expect(rightPx(952)).toBe(16);
    expect(rightPx(951)).not.toBe(16);
    // Room for the panel alone (880) is not enough: the stack would get no height.
    expect(rightPx(880)).not.toBe(16);
  });

  it("AC70: top-docked Playbar without room below → left of its column, above the notice area", () => {
    expect(panelPlacement({ position: "right", bar: topDockedBar, nav, innerWidth: 1280, innerHeight: 800 })).toEqual({
      position: "right",
      rightPx: 1280 - 844 + 16,
      bottomPx: 104,
      topClearancePx: 72,
    });
  });

  it("AC70: top-bar clearance falls back to 72 px without a global nav", () => {
    expect(panelPlacement({ position: "right", bar: topDockedBar, nav: null, innerWidth: 1280, innerHeight: 800 }).topClearancePx).toBe(72);
    expect(panelPlacement({ position: "right", bar: topDockedBar, nav: { bottom: 80 }, innerWidth: 1280, innerHeight: 800 }).topClearancePx).toBe(88);
  });

  it("P6: Over the Playbar, live layout → right 86, top 72, stack below", () => {
    const bar = { left: 1473, top: 56, right: 1893, bottom: 472 };
    expect(panelPlacement({ position: "playbar", bar, nav, innerWidth: 1909, innerHeight: 1143 })).toEqual({
      position: "playbar",
      rightPx: 86,
      topPx: 72,
      stack: "below",
      topClearancePx: 72,
    });
  });

  it("P16: the live-layout panel box lies inside the Playbar box", () => {
    const bar = { left: 1473, top: 56, right: 1893, bottom: 472 };
    const p = panelPlacement({ position: "playbar", bar, nav, innerWidth: 1909, innerHeight: 1143 });
    if (p.position !== "playbar") throw new Error("expected playbar");
    const left = 1909 - p.rightPx - 280;
    expect(left).toBe(1543);
    expect(left).toBeGreaterThanOrEqual(bar.left);
    expect(left + 280).toBeLessThanOrEqual(bar.right);
    expect(p.topPx).toBeGreaterThanOrEqual(bar.top);
    expect(p.topPx + 384).toBeLessThanOrEqual(bar.bottom);
  });

  it("P7: bottom strip, 1280×800 → left 500, top clamped to 400, stack above", () => {
    const bar = { left: 0, top: 720, right: 1280, bottom: 800 };
    expect(panelPlacement({ position: "playbar", bar, nav, innerWidth: 1280, innerHeight: 800 })).toEqual({
      position: "playbar",
      rightPx: 500,
      topPx: 400,
      stack: "above",
      topClearancePx: 72,
    });
  });

  describe("Over the Playbar in a 1280×1143 window", () => {
    const at = (bar: { left: number; right: number; top: number; bottom: number }, innerHeight = 1143) => {
      const p = panelPlacement({ position: "playbar", bar, nav, innerWidth: 1280, innerHeight });
      if (p.position !== "playbar") throw new Error("expected playbar");
      return { left: 1280 - p.rightPx - 280, ...p };
    };
    const centredAt = (cx: number, cy: number) => ({ left: cx - 100, right: cx + 100, top: cy - 100, bottom: cy + 100 });

    it("P8: stack above exactly when panelTop − 8 − ceiling ≥ 64", () => {
      const above = at({ left: 0, right: 420, top: 336 - 100, bottom: 336 + 100 });
      expect([above.topPx, above.stack]).toEqual([144, "above"]);
      const below = at({ left: 0, right: 420, top: 335 - 100, bottom: 335 + 100 });
      expect([below.topPx, below.stack]).toEqual([143, "below"]);
    });

    it("P8: unclamped panel is centred on the Playbar", () => {
      const p = at({ left: 400, right: 800, top: 300, bottom: 700 });
      expect([p.left, p.rightPx, p.topPx]).toEqual([460, 540, 308]);
    });

    it("P8: horizontal clamp to 16 px from either side", () => {
      expect(at(centredAt(155, 500)).left).toBe(16);
      expect(at(centredAt(1280 - 155, 500)).rightPx).toBe(16);
      expect(at(centredAt(156, 500)).left).toBe(16);
    });

    it("P8: vertical clamp — centre within 208 px of the top or bottom", () => {
      expect(at(centredAt(640, 207)).topPx).toBe(16);
      expect(at(centredAt(640, 1143 - 207)).topPx).toBe(1143 - 400);
    });
  });

  it("Review focus 2: window smaller than panel plus gaps keeps top/left at 16", () => {
    const bar = { left: 0, top: 0, right: 250, bottom: 300 };
    const p = panelPlacement({ position: "playbar", bar, nav, innerWidth: 250, innerHeight: 300 });
    if (p.position !== "playbar") throw new Error("expected playbar");
    expect(p.topPx).toBe(16);
    expect(p.rightPx).toBe(250 - 16 - 280);
    expect(250 - p.rightPx - 280).toBe(16);
  });

  it.each([{ bottom: 64 }, null])("P9: Over the Playbar without a Playbar element → the Right edge result (nav %j)", (n) => {
    const base = { bar: null, nav: n, innerWidth: 1280, innerHeight: 800 };
    expect(panelPlacement({ ...base, position: "playbar" })).toEqual(panelPlacement({ ...base, position: "right" }));
  });

  it("Window centre → ceiling only", () => {
    const bar = { left: 1473, top: 56, right: 1893, bottom: 472 };
    const centre = (n: { bottom: number } | null) =>
      panelPlacement({ position: "centre", bar, nav: n, innerWidth: 1280, innerHeight: 800 });
    expect(centre(nav)).toEqual({ position: "centre", topClearancePx: 72 });
    expect(centre(null).topClearancePx).toBe(72);
    expect(centre({ bottom: 80 }).topClearancePx).toBe(88);
  });
});

describe("placementStyle", () => {
  it("right → right/bottom/ceiling vars, stack above", () => {
    expect(placementStyle({ position: "right", rightPx: 16, bottomPx: 104, topClearancePx: 72 })).toEqual({
      position: "right",
      stack: "above",
      vars: { "--tpp-panel-right": "16px", "--tpp-panel-bottom": "104px", "--tpp-top-clearance": "72px" },
    });
  });

  it("playbar (P6 result) → right/top/ceiling vars, stack below", () => {
    expect(
      placementStyle({ position: "playbar", rightPx: 86, topPx: 72, stack: "below", topClearancePx: 72 }),
    ).toEqual({
      position: "playbar",
      stack: "below",
      vars: { "--tpp-panel-right": "86px", "--tpp-panel-top": "72px", "--tpp-top-clearance": "72px" },
    });
  });

  it("centre → ceiling var only, stack above", () => {
    expect(placementStyle({ position: "centre", topClearancePx: 72 })).toEqual({
      position: "centre",
      stack: "above",
      vars: { "--tpp-top-clearance": "72px" },
    });
  });
});
