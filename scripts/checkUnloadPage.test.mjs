// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { START_PREVIEW, restoreExpression } from "./checkUnloadPage.mjs";

const ID = "track-playlist-preview";
const run = (expr) => (0, eval)(expr);

afterEach(() => {
  delete globalThis.Spicetify;
  delete window.__tppCheck;
  document.body.innerHTML = "";
});

/** A Preview all / Stop preview toggle like the action-bar button. */
function renderButton(active) {
  const button = document.createElement("button");
  button.id = "tpp-action-bar-button";
  button.textContent = active ? "Stop preview" : "Preview all";
  const starts = vi.fn();
  button.addEventListener("click", () => {
    if (button.textContent === "Stop preview") button.textContent = "Preview all";
    else {
      starts();
      button.textContent = "Stop preview";
    }
  });
  document.body.appendChild(button);
  return { button, starts };
}

describe("START_PREVIEW (U26)", () => {
  it("starts a session when none is running", async () => {
    const { button, starts } = renderButton(false);
    await run(START_PREVIEW);
    expect(starts).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe("Stop preview");
  });

  it("stops a preview already running on the page, then starts a new one", async () => {
    const { button, starts } = renderButton(true);
    await run(START_PREVIEW);
    expect(starts).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe("Stop preview");
  });
});

describe("restoreExpression (U27)", () => {
  function install() {
    const orig = { play: vi.fn(), reg: vi.fn(), unreg: vi.fn() };
    const push = vi.fn();
    globalThis.Spicetify = {
      Modules: { report: { loaded: [] }, enable: vi.fn(async () => { throw new Error("enable failed"); }) },
      ContextMenuV2: { registerItem: vi.fn(), unregisterItem: vi.fn() },
      Platform: { History: { push } },
    };
    const realPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = vi.fn();
    window.__tppCheck = { orig, path: "/start" };
    return { orig, push, realPlay };
  }

  it("restores the functions and pathname even when enable rejects, and reports the error", async () => {
    const { orig, push, realPlay } = install();
    try {
      const result = await run(restoreExpression(ID));
      expect(HTMLMediaElement.prototype.play).toBe(orig.play);
      expect(Spicetify.ContextMenuV2.registerItem).toBe(orig.reg);
      expect(Spicetify.ContextMenuV2.unregisterItem).toBe(orig.unreg);
      expect(push).toHaveBeenCalledWith("/start");
      expect(window.__tppCheck).toBeUndefined();
      expect(result).toContain("enable failed");
    } finally {
      HTMLMediaElement.prototype.play = realPlay;
    }
  });

  it("returns true when every step succeeds", async () => {
    const { realPlay } = install();
    Spicetify.Modules.report.loaded = [ID];
    try {
      expect(await run(restoreExpression(ID))).toBe(true);
    } finally {
      HTMLMediaElement.prototype.play = realPlay;
    }
  });
});
