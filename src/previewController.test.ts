// src/previewController.test.ts
// Controller wiring against fakes only — no Spicetify global.
import { describe, it, expect, vi } from "vitest";
import { createPreviewController, type ControllerDeps } from "./previewController";
import type { PreviewEngine } from "./previewEngine";
import type { PlayerCoordinator } from "./playerCoordinator";
import type { CollectionType, EngineEvent, PanelView, PlaylistMetadata, TrackRef } from "./types/domain";

const P = "spotify:playlist:P";
const ALBUM = "spotify:album:A";
const ARTIST = "spotify:artist:R";
const LIKED = "spotify:collection:tracks";

const a: TrackRef = { uri: "spotify:track:a", name: "Alpha", artist: "Ann", artworkUrl: "art-a" };
const b: TrackRef = { uri: "spotify:track:b", name: "Bravo", artist: "Bob", artworkUrl: "art-b" };
const c: TrackRef = { uri: "spotify:track:c", name: "Charlie", artist: "Cy", artworkUrl: "art-c" };
const queue = [a, b, c];

function classify(uri: string): CollectionType | null {
  if (uri.startsWith("spotify:playlist:")) return "playlist";
  if (uri.startsWith("spotify:album:")) return "album";
  if (uri.startsWith("spotify:artist:")) return "artist";
  if (uri === LIKED) return "likedSongs";
  return null;
}

function setup(overrides: Partial<ControllerDeps> = {}) {
  let active = false;
  let current: TrackRef | null = null;
  const engine = {
    start: vi.fn((q: TrackRef[], i = 0) => {
      active = true;
      current = q[i] ?? null;
    }),
    skip: vi.fn(),
    stop: vi.fn(),
    isActive: vi.fn(() => active),
    currentIndex: vi.fn(() => 0),
    currentTrack: vi.fn(() => (active ? current : null)),
  };
  const coordinator = { acquire: vi.fn(), release: vi.fn(), isActive: vi.fn(() => false) };
  const panel = { open: vi.fn<(v: PanelView) => void>(), update: vi.fn<(v: PanelView) => void>(), close: vi.fn() };
  const notify = { info: vi.fn(), error: vi.fn() };
  const highlight = { set: vi.fn(), clear: vi.fn() };
  const pendingRemovals = {
    schedule: vi.fn(() => 1),
    marker: vi.fn(() => 7),
    isExcluded: vi.fn(() => true),
  };
  const playlistMetadata = vi.fn(async (_uri: string): Promise<PlaylistMetadata> => ({ canRemove: true }));
  const collectionLabel = vi.fn(async (_uri: string, _type: CollectionType) => "Chill Mix");
  const deps: ControllerDeps = {
    engine: engine as unknown as PreviewEngine,
    coordinator: coordinator as unknown as PlayerCoordinator,
    enumerate: vi.fn(async () => queue),
    fetchTrackRef: vi.fn(async (uri: string) => ({ uri, name: "Solo", artist: "Sam" })),
    collectionTypeForUri: classify,
    notify,
    highlight,
    onActiveCollection: vi.fn(),
    panel,
    collectionLabel,
    playlistMetadata,
    pendingRemovals,
    ...overrides,
  };
  const controller = createPreviewController(deps);
  const emit = (e: EngineEvent) => controller.onEvent(e);
  const setActive = (v: boolean, t: TrackRef | null = current) => {
    active = v;
    current = t;
  };
  return { controller, deps, engine, coordinator, panel, notify, highlight, pendingRemovals, playlistMetadata, collectionLabel, emit, setActive };
}

const lastUpdate = (panel: { update: { mock: { calls: [PanelView][] } } }) => panel.update.mock.calls.at(-1)![0];

describe("previewController", () => {
  it("AC46: start opens the panel on the starting entry, then starts the engine", async () => {
    const t = setup();
    await t.controller.startCollection(P, 0);
    expect(t.panel.open).toHaveBeenCalledTimes(1);
    expect(t.panel.open.mock.calls[0]![0]).toMatchObject({
      state: "playing",
      heading: "Alpha — Ann",
      sourceText: "From: Chill Mix · 1/3",
      progress: "empty",
    });
    expect(t.engine.start).toHaveBeenCalledWith(queue, 0);
    expect(t.panel.open.mock.invocationCallOrder[0]!).toBeLessThan(t.engine.start.mock.invocationCallOrder[0]!);
    expect(t.coordinator.acquire).toHaveBeenCalledTimes(1);
  });

  it("AC46: empty queue → notice, no panel, no acquire", async () => {
    const t = setup({ enumerate: vi.fn(async () => []) });
    await t.controller.startCollection(P, 0);
    expect(t.notify.info).toHaveBeenCalledWith("Nothing to preview");
    expect(t.panel.open).not.toHaveBeenCalled();
    expect(t.coordinator.acquire).not.toHaveBeenCalled();
    expect(t.engine.start).not.toHaveBeenCalled();
  });

  it("AC49/AC56: trackStarted updates in place with live progress, highlights, no per-track notice", async () => {
    const t = setup();
    await t.controller.startCollection(P, 0);
    t.emit({ type: "trackStarted", index: 1, total: 3, track: b });
    expect(t.panel.open).toHaveBeenCalledTimes(1);
    expect(t.panel.close).not.toHaveBeenCalled();
    expect(lastUpdate(t.panel)).toMatchObject({
      state: "playing",
      heading: "Bravo — Bob",
      artworkUrl: "art-b",
      sourceText: "From: Chill Mix · 2/3",
      progress: "live",
    });
    expect(t.highlight.set).toHaveBeenCalledWith(b.uri);
    expect(t.notify.info).not.toHaveBeenCalled();
  });

  it("AC61: trackSkipped updates with the skipping view", async () => {
    const t = setup();
    await t.controller.startCollection(P, 0);
    t.emit({ type: "trackSkipped", index: 2, total: 3, track: c, reason: "missing" });
    expect(lastUpdate(t.panel)).toMatchObject({
      state: "skipping",
      heading: "Charlie — Cy",
      artworkUrl: null,
      indicator: "No preview — skipping",
      sourceText: "From: Chill Mix · 3/3",
      progress: "empty",
    });
  });

  it("AC53: trackCompleted re-emits the last view with progress full", async () => {
    const t = setup();
    await t.controller.startCollection(P, 0);
    t.emit({ type: "trackStarted", index: 0, total: 3, track: a });
    const started = lastUpdate(t.panel);
    t.emit({ type: "trackCompleted", index: 0, total: 3, track: a });
    expect(lastUpdate(t.panel)).toEqual({ ...started, progress: "full" });
    expect(t.engine.skip).not.toHaveBeenCalled();
    expect(t.engine.stop).not.toHaveBeenCalled();
  });

  it("AC55: completed/stopped/aborted close the panel and release; replaced does neither", async () => {
    for (const reason of ["completed", "stopped", "aborted"] as const) {
      const t = setup();
      await t.controller.startCollection(P, 0);
      t.emit({ type: "sessionEnded", skipped: 0, reason });
      expect(t.panel.close).toHaveBeenCalledTimes(1);
      expect(t.coordinator.release).toHaveBeenCalledTimes(1);
      expect(t.highlight.clear).toHaveBeenCalledTimes(1);
      expect(t.deps.onActiveCollection).toHaveBeenLastCalledWith(null);
    }
    const t = setup();
    await t.controller.startCollection(P, 0);
    t.emit({ type: "sessionEnded", skipped: 0, reason: "replaced" });
    expect(t.panel.close).not.toHaveBeenCalled();
    expect(t.coordinator.release).not.toHaveBeenCalled();
    expect(t.highlight.clear).not.toHaveBeenCalled();
  });

  it("AC55: a replacement re-opens (focus) on its starting entry", async () => {
    const t = setup();
    await t.controller.startCollection(ALBUM, 0);
    await t.controller.startFromHere(c.uri, P);
    t.emit({ type: "sessionEnded", skipped: 0, reason: "replaced" });
    expect(t.panel.open).toHaveBeenCalledTimes(2);
    expect(t.panel.open.mock.calls[1]![0]).toMatchObject({
      heading: "Charlie — Cy",
      sourceText: "From: Chill Mix · 3/3",
      progress: "empty",
    });
    expect(t.engine.start).toHaveBeenLastCalledWith(queue, 2);
    expect(t.panel.close).not.toHaveBeenCalled();
  });

  it("AC50: stop() stops the engine once; the stopped sessionEnded releases the coordinator", async () => {
    const t = setup();
    await t.controller.startCollection(P, 0);
    t.controller.stop();
    expect(t.engine.stop).toHaveBeenCalledTimes(1);
    t.emit({ type: "sessionEnded", skipped: 0, reason: "stopped" });
    expect(t.coordinator.release).toHaveBeenCalledTimes(1);
    expect(t.panel.close).toHaveBeenCalledTimes(1);
  });

  it("AC51: a controller-driven close never stops the engine", async () => {
    const t = setup();
    await t.controller.startCollection(P, 0);
    t.emit({ type: "sessionEnded", skipped: 0, reason: "completed" });
    t.emit({ type: "sessionEnded", skipped: 0, reason: "stopped" });
    expect(t.panel.close).toHaveBeenCalled();
    expect(t.engine.stop).not.toHaveBeenCalled();
  });

  it("AC52: next() empties the bar then skips; idle → nothing", async () => {
    const t = setup();
    t.controller.next();
    expect(t.engine.skip).not.toHaveBeenCalled();
    expect(t.panel.update).not.toHaveBeenCalled();

    await t.controller.startCollection(P, 0);
    t.emit({ type: "trackStarted", index: 0, total: 3, track: a });
    const started = lastUpdate(t.panel);
    t.controller.next();
    expect(lastUpdate(t.panel)).toEqual({ ...started, progress: "empty" });
    expect(t.engine.skip).toHaveBeenCalledTimes(1);
    expect(t.panel.update.mock.invocationCallOrder.at(-1)!).toBeLessThan(t.engine.skip.mock.invocationCallOrder[0]!);
  });

  it("R1: literal true canRemove gives a Remove label; metadata read once per session", async () => {
    const t = setup();
    await t.controller.startCollection(P, 0);
    expect(t.panel.open.mock.calls[0]![0].removeLabel).toBe("Remove from Chill Mix");
    t.emit({ type: "trackStarted", index: 0, total: 3, track: a });
    t.emit({ type: "trackStarted", index: 1, total: 3, track: b });
    t.controller.next();
    expect(lastUpdate(t.panel).removeLabel).toBe("Remove from Chill Mix");
    expect(t.playlistMetadata).toHaveBeenCalledTimes(1);
    expect(t.playlistMetadata).toHaveBeenCalledWith(P);
  });

  it("R2: 'true', 1, undefined, Liked Songs, album, artist, single track, from-here fallback → no Remove", async () => {
    for (const canRemove of ["true", 1, undefined]) {
      const t = setup({ playlistMetadata: vi.fn(async () => ({ canRemove })) });
      await t.controller.startCollection(P, 0);
      expect(t.panel.open.mock.calls[0]![0].removeLabel).toBeNull();
    }
    for (const uri of [LIKED, ALBUM, ARTIST]) {
      const t = setup();
      await t.controller.startCollection(uri, 0);
      expect(t.panel.open.mock.calls[0]![0].removeLabel).toBeNull();
      expect(t.playlistMetadata).not.toHaveBeenCalled();
    }
    const single = setup();
    await single.controller.startTrack(a.uri);
    expect(single.panel.open.mock.calls[0]![0]).toMatchObject({ removeLabel: null, sourceText: "Single track" });

    const fallback = setup();
    await fallback.controller.startFromHere("spotify:track:zzz", P); // not in P's queue → single track
    expect(fallback.panel.open.mock.calls[0]![0]).toMatchObject({ removeLabel: null, sourceText: "Single track" });
    fallback.controller.removeCurrent();
    expect(fallback.pendingRemovals.schedule).not.toHaveBeenCalled();
  });

  it("R3: metadata rejection → session starts, no Remove", async () => {
    const t = setup({ playlistMetadata: vi.fn(async () => Promise.reject(new Error("boom"))) });
    await t.controller.startCollection(P, 0);
    expect(t.engine.start).toHaveBeenCalledWith(queue, 0);
    expect(t.panel.open.mock.calls[0]![0].removeLabel).toBeNull();
    expect(t.notify.error).not.toHaveBeenCalled();
  });

  it("R4: Preview from here inside P starts at the selected entry and removes from P", async () => {
    const t = setup();
    await t.controller.startFromHere(b.uri, P);
    expect(t.playlistMetadata).toHaveBeenCalledWith(P);
    expect(t.engine.start).toHaveBeenCalledWith(queue, 1);
    expect(t.panel.open.mock.calls[0]![0]).toMatchObject({ heading: "Bravo — Bob", removeLabel: "Remove from Chill Mix" });
    t.controller.removeCurrent();
    expect(t.pendingRemovals.schedule).toHaveBeenCalledWith(P, "Chill Mix", b);
  });

  it("R5: removeCurrent in a non-removable session schedules nothing and does not skip", async () => {
    const t = setup({ playlistMetadata: vi.fn(async () => ({ canRemove: false })) });
    await t.controller.startCollection(P, 0);
    t.controller.removeCurrent();
    expect(t.pendingRemovals.schedule).not.toHaveBeenCalled();
    expect(t.engine.skip).not.toHaveBeenCalled();

    const idle = setup();
    idle.controller.removeCurrent();
    expect(idle.pendingRemovals.schedule).not.toHaveBeenCalled();
    expect(idle.engine.skip).not.toHaveBeenCalled();
  });

  it("R6: removeCurrent schedules the current entry on P with the label, then skips, synchronously", async () => {
    const t = setup();
    await t.controller.startCollection(P, 0);
    t.emit({ type: "trackStarted", index: 0, total: 3, track: a });
    const started = lastUpdate(t.panel);
    t.controller.removeCurrent();
    expect(t.pendingRemovals.schedule).toHaveBeenCalledWith("spotify:playlist:P", "Chill Mix", a);
    expect(t.engine.skip).toHaveBeenCalledTimes(1);
    expect(t.pendingRemovals.schedule.mock.invocationCallOrder[0]!).toBeLessThan(t.engine.skip.mock.invocationCallOrder[0]!);
    expect(lastUpdate(t.panel)).toEqual({ ...started, progress: "empty" });
  });

  it("R15 name: a playlist with no name uses the generic label for removals", async () => {
    const t = setup({ collectionLabel: vi.fn(async () => "Playlist") });
    await t.controller.startCollection(P, 0);
    t.controller.removeCurrent();
    expect(t.pendingRemovals.schedule).toHaveBeenCalledWith(P, "Playlist", a);
  });

  it("R13: isExcluded binds to the source playlist and the session marker", async () => {
    const idle = setup();
    expect(idle.controller.isExcluded(a.uri)).toBe(false);
    expect(idle.pendingRemovals.isExcluded).not.toHaveBeenCalled();

    const album = setup();
    await album.controller.startCollection(ALBUM, 0);
    expect(album.controller.isExcluded(a.uri)).toBe(false);
    expect(album.pendingRemovals.isExcluded).not.toHaveBeenCalled();

    const t = setup();
    await t.controller.startCollection(P, 0);
    expect(t.controller.isExcluded(a.uri)).toBe(true);
    expect(t.pendingRemovals.isExcluded).toHaveBeenCalledWith(P, a.uri, 7);
  });

  it("R13: the session is bound before engine.start so the first entry can be excluded", async () => {
    const t = setup();
    let seen: boolean | null = null;
    t.engine.start.mockImplementation(() => {
      seen = t.controller.isExcluded(a.uri);
    });
    await t.controller.startCollection(P, 0);
    expect(seen).toBe(true);
  });

  it("Review focus 1: the later of two overlapping starts wins", async () => {
    let resolveA!: (m: PlaylistMetadata) => void;
    const metadata = vi.fn((uri: string) =>
      uri === P ? new Promise<PlaylistMetadata>((r) => (resolveA = r)) : Promise.resolve({ canRemove: true }),
    );
    const t = setup({
      playlistMetadata: metadata,
      enumerate: vi.fn(async (uri: string) => (uri === P ? queue : [c, b])),
    });
    const startA = t.controller.startCollection(P, 0);
    await vi.waitFor(() => expect(metadata).toHaveBeenCalledWith(P));
    await t.controller.startCollection("spotify:playlist:B", 0);
    resolveA({ canRemove: true });
    await startA;
    expect(t.engine.start).toHaveBeenCalledTimes(1);
    expect(t.engine.start).toHaveBeenCalledWith([c, b], 0);
    expect(t.panel.open).toHaveBeenCalledTimes(1);
    expect(t.coordinator.acquire).toHaveBeenCalledTimes(1);
  });
  it("Review focus 1: a slow earlier enumeration loses to a later start that finished first", async () => {
    let resolveA!: (q: TrackRef[]) => void;
    const enumerate = vi.fn((uri: string) =>
      uri === ARTIST ? new Promise<TrackRef[]>((r) => (resolveA = r)) : Promise.resolve([c, b]),
    );
    const t = setup({ enumerate });
    const startA = t.controller.startCollection(ARTIST, 0);
    await t.controller.startCollection("spotify:playlist:B", 0);
    expect(t.engine.start).toHaveBeenCalledTimes(1);
    resolveA(queue);
    await startA;
    expect(t.engine.start).toHaveBeenCalledTimes(1);
    expect(t.engine.start).toHaveBeenCalledWith([c, b], 0);
    expect(t.panel.open).toHaveBeenCalledTimes(1);
  });

  it("Review focus 1: an empty-queue start supersedes an in-flight earlier start", async () => {
    let resolveA!: (q: TrackRef[]) => void;
    const enumerate = vi.fn((uri: string) =>
      uri === ARTIST ? new Promise<TrackRef[]>((r) => (resolveA = r)) : Promise.resolve([]),
    );
    const t = setup({ enumerate });
    const startA = t.controller.startCollection(ARTIST, 0);
    await t.controller.startCollection(ALBUM, 0);
    expect(t.notify.info).toHaveBeenCalledWith("Nothing to preview");
    resolveA(queue);
    await startA;
    expect(t.engine.start).not.toHaveBeenCalled();
    expect(t.panel.open).not.toHaveBeenCalled();
    expect(t.coordinator.acquire).not.toHaveBeenCalled();
  });

  it("stop() cancels a pending start", async () => {
    let resolveB!: (m: PlaylistMetadata) => void;
    const B = "spotify:playlist:B";
    const metadata = vi.fn((uri: string) =>
      uri === B ? new Promise<PlaylistMetadata>((r) => (resolveB = r)) : Promise.resolve({ canRemove: true }),
    );
    const t = setup({ playlistMetadata: metadata });
    await t.controller.startCollection(P, 0); // A playing
    expect(t.engine.start).toHaveBeenCalledTimes(1);
    const startB = t.controller.startCollection(B, 0);
    await vi.waitFor(() => expect(metadata).toHaveBeenCalledWith(B));
    t.controller.stop();
    expect(t.engine.stop).toHaveBeenCalledTimes(1);
    resolveB({ canRemove: true });
    await startB;
    expect(t.engine.start).toHaveBeenCalledTimes(1);
    expect(t.panel.open).toHaveBeenCalledTimes(1);
  });
});
