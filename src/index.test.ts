import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("./waitForClient", () => ({
  READY_TIMEOUT_MS: 10_000,
  waitForClient: vi.fn(() => Promise.reject(new Error("not ready"))),
}));
vi.mock("./ui/settingsSection", () => ({ registerSettingsSection: vi.fn() }));
vi.mock("./ui/contextMenus", () => ({
  createContextMenus: vi.fn(() => ({ register: vi.fn(), dispose: vi.fn() })),
}));
vi.mock("./ui/previewPanel", () => ({
  createPreviewPanel: vi.fn(() => ({ open: vi.fn(), update: vi.fn(), close: vi.fn(), dispose: vi.fn() })),
}));
vi.mock("./ui/actionBarButton", () => ({
  createActionBarButton: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), refresh: vi.fn() })),
}));
vi.mock("./previewController", () => ({
  createPreviewController: vi.fn(() => ({
    dispose: vi.fn(),
    startCollection: vi.fn(),
    startTrack: vi.fn(),
    startFromHere: vi.fn(),
    toggleCollection: vi.fn(),
    stop: vi.fn(),
    next: vi.fn(),
    removeCurrent: vi.fn(),
    onEvent: vi.fn(),
    isExcluded: vi.fn(),
    isActiveFor: vi.fn(),
  })),
}));
vi.mock("./ui/rowHighlight", () => ({ rowHighlight: { set: vi.fn(), clear: vi.fn() } }));
vi.mock("./spotify/ports", () => {
  const store = new Map<string, string>();
  return {
    createAudioPort: vi.fn(() => ({})),
    realTimer: { setTimeout: vi.fn(), clearTimeout: vi.fn() },
    createPlayerPort: vi.fn(() => ({})),
    localStorageAdapter: { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) },
    trackPreviewRequest: vi.fn(),
    createCollectionDeps: vi.fn(() => ({})),
    spicetifyUriMatcher: {},
    playlistMetadata: vi.fn(),
    playlistRemove: vi.fn(),
    artistOverviewRequest: vi.fn(),
  };
});

import { load } from "./index";
import { waitForClient } from "./waitForClient";
import { registerSettingsSection } from "./ui/settingsSection";
import { createContextMenus } from "./ui/contextMenus";
import { createActionBarButton } from "./ui/actionBarButton";
import { createPreviewPanel } from "./ui/previewPanel";
import { createPreviewController } from "./previewController";
import { rowHighlight } from "./ui/rowHighlight";
import type { Settings } from "./settings";

const ctx = () => ({ spotifyVersion: "1.2.96.518", identifier: "track-playlist-preview", defer: vi.fn() });
type Ctx = ReturnType<typeof ctx>;

/** Runs every function load() passed to ctx.defer, in reverse order, as the loader does. */
function unload(c: Ctx): void {
  for (const [fn] of [...c.defer.mock.calls].reverse()) (fn as () => void)();
}

/** The value the n-th call (0-based) of a mocked factory returned. */
function built<T>(factory: unknown, n: number): T {
  return (factory as Mock).mock.results[n]!.value as T;
}
const menus = (n: number) => built<{ register: Mock; dispose: Mock }>(createContextMenus, n);
const bar = (n: number) => built<{ start: Mock; stop: Mock }>(createActionBarButton, n);
const panel = (n: number) => built<{ dispose: Mock }>(createPreviewPanel, n);
const controller = (n: number) => built<{ dispose: Mock; startCollection: Mock }>(createPreviewController, n);

/** Every teardown mock of the n-th wiring. */
const teardowns = (n: number): Mock[] => [controller(n).dispose, menus(n).dispose, bar(n).stop, panel(n).dispose];

const order = (m: Mock): number => m.mock.invocationCallOrder[0]!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(waitForClient).mockImplementation(() => Promise.reject(new Error("not ready")));
});

describe("load", () => {
  it("S18/S4: rejects with the readiness error and registers nothing", async () => {
    await expect(load(ctx())).rejects.toThrow("not ready");
    expect(registerSettingsSection).not.toHaveBeenCalled();
    expect(createContextMenus).not.toHaveBeenCalled();
  });

  it("S4: readiness waits for ReactDOM when the other globals are present", async () => {
    (globalThis as { Spicetify?: unknown }).Spicetify = { React: {}, ContextMenu: {}, Platform: {} };
    try {
      await expect(load(ctx())).rejects.toThrow("not ready");
      const { missing } = vi.mocked(waitForClient).mock.calls[0]![0];
      expect(missing()).toEqual(["Spicetify.ReactDOM"]);
    } finally {
      delete (globalThis as { Spicetify?: unknown }).Spicetify;
    }
  });
});

describe("load and unload (U20–U24, U31)", () => {
  beforeEach(() => {
    vi.mocked(waitForClient).mockResolvedValue(undefined);
  });

  it("load registers dispose with ctx.defer before the settings section", async () => {
    const c = ctx();
    await load(c);
    expect(c.defer).toHaveBeenCalledTimes(1);
    expect(c.defer.mock.calls[0]![0]).toBeTypeOf("function");
    expect(order(c.defer)).toBeLessThan(order(vi.mocked(registerSettingsSection)));
  });

  it("dispose tears down in order", async () => {
    const c = ctx();
    await load(c);
    unload(c);
    const steps = [controller(0).dispose, menus(0).dispose, bar(0).stop, panel(0).dispose, vi.mocked(rowHighlight.clear)];
    const calls = steps.map(order);
    expect(calls).toEqual([...calls].sort((x, y) => x - y));
  });

  it("U20: a second load builds a new wiring", async () => {
    const first = ctx();
    await load(first);
    unload(first);
    await load(ctx());
    expect(createContextMenus).toHaveBeenCalledTimes(2);
    expect(createActionBarButton).toHaveBeenCalledTimes(2);
    expect(createPreviewPanel).toHaveBeenCalledTimes(2);
    expect(menus(1).register).toHaveBeenCalledTimes(1);
    expect(bar(1).start).toHaveBeenCalledTimes(1);
    for (const m of teardowns(0)) expect(m).toHaveBeenCalledTimes(1);
    for (const m of teardowns(1)) expect(m).not.toHaveBeenCalled();
  });

  it("U21: settings stored before unload are read by the next wiring", async () => {
    const first = ctx();
    await load(first);
    const settings1 = vi.mocked(registerSettingsSection).mock.calls[0]![1] as Settings;
    settings1.setDurationMs(5000);
    unload(first);
    await load(ctx());
    const settings2 = vi.mocked(registerSettingsSection).mock.calls[1]![1] as Settings;
    expect(settings2.getDurationMs()).toBe(5000);
  });

  it("U22: a throwing wire step disposes what was built and defers nothing", async () => {
    const boom = new Error("boom");
    vi.mocked(createContextMenus).mockReturnValueOnce({
      register: vi.fn(() => {
        throw boom;
      }),
      dispose: vi.fn(),
    } as never);
    const c = ctx();
    await expect(load(c)).rejects.toBe(boom);
    for (const m of teardowns(0)) expect(m).toHaveBeenCalledTimes(1);
    expect(c.defer).not.toHaveBeenCalled();
    expect(registerSettingsSection).not.toHaveBeenCalled();
  });

  it("U22: a throwing settings registration disposes the wiring", async () => {
    const boom = new Error("boom");
    vi.mocked(registerSettingsSection).mockImplementationOnce(() => {
      throw boom;
    });
    await expect(load(ctx())).rejects.toBe(boom);
    for (const m of [...teardowns(0), vi.mocked(rowHighlight.clear)]) expect(m).toHaveBeenCalledTimes(1);
  });

  it("U24: running the deferred dispose twice tears down once", async () => {
    const c = ctx();
    await load(c);
    unload(c);
    expect(() => unload(c)).not.toThrow();
    for (const m of [...teardowns(0), vi.mocked(rowHighlight.clear)]) expect(m).toHaveBeenCalledTimes(1);
  });

  it("U31: the new wiring routes to a fresh controller", async () => {
    const first = ctx();
    await load(first);
    unload(first);
    await load(ctx());
    const deps = vi.mocked(createContextMenus).mock.calls[1]![0];
    deps.onPreviewCollection("spotify:album:x");
    expect(controller(1).startCollection).toHaveBeenCalledWith("spotify:album:x", 0);
    expect(controller(0).startCollection).not.toHaveBeenCalled();
    expect(controller(1).dispose).not.toHaveBeenCalled();
  });

  it("Review Focus 4: two full cycles leave one live wiring", async () => {
    for (let i = 0; i < 2; i++) {
      const c = ctx();
      await load(c);
      unload(c);
    }
    await load(ctx());
    expect(createContextMenus).toHaveBeenCalledTimes(3);
    for (const n of [0, 1]) for (const m of teardowns(n)) expect(m).toHaveBeenCalledTimes(1);
    for (const m of teardowns(2)) expect(m).not.toHaveBeenCalled();
    expect(menus(2).register).toHaveBeenCalledTimes(1);
  });
});
