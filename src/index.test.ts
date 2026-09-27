import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./waitForClient", () => ({
  READY_TIMEOUT_MS: 10_000,
  waitForClient: vi.fn(() => Promise.reject(new Error("not ready"))),
}));
vi.mock("./ui/settingsSection", () => ({ registerSettingsSection: vi.fn() }));
vi.mock("./ui/contextMenus", () => ({ createContextMenus: vi.fn(() => ({ register: vi.fn() })) }));
vi.mock("./ui/previewPanel", () => ({ createPreviewPanel: vi.fn() }));
vi.mock("./ui/actionBarButton", () => ({
  createActionBarButton: vi.fn(() => ({ start: vi.fn(), refresh: vi.fn() })),
}));
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

const ctx = () => ({ identifier: "track-playlist-preview", defer: vi.fn() });

beforeEach(() => vi.clearAllMocks());

describe("load", () => {
  it("S18/S4: rejects with the readiness error and registers nothing", async () => {
    await expect(load(ctx())).rejects.toThrow("not ready");
    expect(registerSettingsSection).not.toHaveBeenCalled();
    expect(createContextMenus).not.toHaveBeenCalled();
  });

  it("a second load (module re-enabled) re-registers only the settings section", async () => {
    vi.mocked(waitForClient).mockResolvedValue(undefined);
    const first = ctx();
    const second = ctx();

    await load(first);
    await load(second);

    expect(createContextMenus).toHaveBeenCalledTimes(1);
    expect(registerSettingsSection).toHaveBeenCalledTimes(2);
    expect(vi.mocked(registerSettingsSection).mock.calls[1]![0]).toBe(second);
  });
});
