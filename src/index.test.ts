import { describe, it, expect, vi } from "vitest";

vi.mock("./waitForClient", () => ({
  READY_TIMEOUT_MS: 10_000,
  waitForClient: vi.fn(() => Promise.reject(new Error("not ready"))),
}));
vi.mock("./ui/settingsSection", () => ({ registerSettingsSection: vi.fn() }));
vi.mock("./ui/contextMenus", () => ({ createContextMenus: vi.fn(() => ({ register: vi.fn() })) }));
vi.mock("./ui/previewPanel", () => ({ createPreviewPanel: vi.fn() }));

import { load } from "./index";
import { registerSettingsSection } from "./ui/settingsSection";
import { createContextMenus } from "./ui/contextMenus";

describe("load", () => {
  it("S18/S4: rejects with the readiness error and registers nothing", async () => {
    await expect(load({ identifier: "track-playlist-preview", defer: vi.fn() })).rejects.toThrow("not ready");
    expect(registerSettingsSection).not.toHaveBeenCalled();
    expect(createContextMenus).not.toHaveBeenCalled();
  });
});
