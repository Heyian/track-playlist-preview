// src/previewController.unload.test.ts
// Unload (controller.dispose) against the real engine and coordinator, so the
// playback and audio effects are the ones the live wiring would produce.
import { describe, it, expect, vi } from "vitest";
import { createPreviewController, type ControllerDeps } from "./previewController";
import { createPreviewEngine } from "./previewEngine";
import { createPlayerCoordinator } from "./playerCoordinator";
import { fakeTimer } from "./testing/fakeTimer";
import type { AudioHandlers, CollectionType, PanelView, TrackRef } from "./types/domain";

const P = "spotify:playlist:P";
const ALBUM = "spotify:album:A";

const a: TrackRef = { uri: "spotify:track:a", name: "Alpha", artist: "Ann" };
const b: TrackRef = { uri: "spotify:track:b", name: "Bravo", artist: "Bob" };
const c: TrackRef = { uri: "spotify:track:c", name: "Charlie", artist: "Cy" };

const tick = () => new Promise((r) => setTimeout(r, 0));

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20 && !predicate(); i++) await tick();
  expect(predicate()).toBe(true);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function classify(uri: string): CollectionType | null {
  if (uri.startsWith("spotify:playlist:")) return "playlist";
  if (uri.startsWith("spotify:album:")) return "album";
  return null;
}

function setup(opts: { playing: boolean; gap?: number; resolve?: (uri: string) => Promise<string | null> }) {
  let playing = opts.playing;
  const player = { isPlaying: vi.fn(() => playing), pause: vi.fn(), resume: vi.fn() };
  const timer = fakeTimer();
  let handlers: AudioHandlers | null = null;
  const audio = {
    play: vi.fn((_url: string, h: AudioHandlers) => void (handlers = h)),
    stop: vi.fn(() => void (handlers = null)),
  };
  const panel = { open: vi.fn<(v: PanelView) => void>(), update: vi.fn<(v: PanelView) => void>(), close: vi.fn() };
  const notify = { info: vi.fn(), error: vi.fn() };
  let controller: ReturnType<typeof createPreviewController> | null = null;
  const engine = createPreviewEngine({
    audio,
    timer: timer.port,
    resolve: opts.resolve ?? (async (uri) => `url-${uri}`),
    config: { getDurationMs: () => 15000, getGapMs: () => opts.gap ?? 0 },
    emit: (e) => controller?.onEvent(e),
  });
  const deps: ControllerDeps = {
    engine,
    coordinator: createPlayerCoordinator(player),
    enumerate: vi.fn(async () => [a, b, c]),
    fetchTrackRef: vi.fn(async (uri: string) => ({ uri, name: "Solo", artist: "Sam" })),
    collectionTypeForUri: classify,
    notify,
    highlight: { set: vi.fn(), clear: vi.fn() },
    onActiveCollection: vi.fn(),
    panel,
    collectionLabel: vi.fn(async () => "Chill Mix"),
    playlistMetadata: vi.fn(async () => ({ canRemove: true })),
    pendingRemovals: { schedule: vi.fn(() => 1), marker: vi.fn(() => 0), isExcluded: vi.fn(() => false) },
  };
  controller = createPreviewController(deps);
  return {
    controller,
    player,
    timer,
    audio,
    panel,
    notify,
    setPlaying: (v: boolean) => void (playing = v),
    ended: () => handlers?.onEnded(),
  };
}

describe("previewController unload", () => {
  it("U1: unload while Spotify was playing resumes once and stops the clip", async () => {
    const t = setup({ playing: true });
    await t.controller.startCollection(ALBUM);
    await until(() => t.audio.play.mock.calls.length > 0);
    t.controller.dispose();
    expect(t.audio.stop).toHaveBeenCalled();
    expect(t.player.resume).toHaveBeenCalledTimes(1);
    expect(t.panel.close).toHaveBeenCalled();
  });

  it("U1: a replacement session keeps the first acquire's decision", async () => {
    const t = setup({ playing: true });
    await t.controller.startCollection(ALBUM);
    t.setPlaying(false); // Spotify now reports paused, because we paused it
    await t.controller.startCollection(P);
    t.controller.dispose();
    expect(t.player.pause).toHaveBeenCalledTimes(1);
    expect(t.player.resume).toHaveBeenCalledTimes(1);
  });

  it("U2: unload when Spotify was already paused does not resume", async () => {
    const t = setup({ playing: false });
    await t.controller.startCollection(ALBUM);
    t.controller.dispose();
    expect(t.player.resume).not.toHaveBeenCalled();
  });

  it("U29: the skipped summary still shows on unload", async () => {
    const t = setup({ playing: false, resolve: async (uri) => (uri === a.uri ? null : `url-${uri}`) });
    await t.controller.startCollection(ALBUM);
    await until(() => t.audio.play.mock.calls.some(([url]) => url === `url-${b.uri}`));
    t.controller.dispose();
    expect(t.notify.info).toHaveBeenCalledExactlyOnceWith("Skipped 1 track with no preview");
  });

  it("Review Focus 1: unload during the gap plays nothing when the gap timer fires", async () => {
    const t = setup({ playing: false, gap: 2000 });
    await t.controller.startCollection(ALBUM);
    await until(() => t.audio.play.mock.calls.length > 0);
    for (const id of t.timer.ids()) t.timer.fire(id); // the duration timer: a completes, gap begins
    const plays = t.audio.play.mock.calls.length;
    t.controller.dispose();
    for (const id of t.timer.ids()) t.timer.fire(id);
    await tick();
    expect(t.audio.play).toHaveBeenCalledTimes(plays);
  });

  it("Review Focus 2: unload while resolving plays nothing when it settles", async () => {
    const pending = deferred<string | null>();
    const t = setup({ playing: true, resolve: () => pending.promise });
    await t.controller.startCollection(ALBUM);
    t.controller.dispose();
    pending.resolve("url-late");
    await tick();
    await tick();
    expect(t.audio.play).not.toHaveBeenCalled();
    expect(t.player.resume).toHaveBeenCalledTimes(1);
  });
});
