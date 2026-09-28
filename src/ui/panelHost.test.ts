// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountPanelHost, ROOT_ID, type PanelHostDeps } from "./panelHost";

beforeEach(() => {
  document.body.innerHTML = "";
});

function setup() {
  const listeners = new Set<() => void>();
  const unmount = vi.fn();
  const deps = {
    mount: vi.fn((_host: HTMLElement) => ({ unmount })),
    onSettingsChange: vi.fn((l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    }),
    place: vi.fn((_host: HTMLElement) => {}),
  } satisfies PanelHostDeps;
  const fire = () => {
    for (const l of listeners) l();
  };
  return { deps, listeners, unmount, fire };
}

describe("mountPanelHost", () => {
  it("U16: dispose unmounts the root and removes the host", () => {
    const t = setup();
    const { host, dispose } = mountPanelHost(t.deps);
    expect(document.getElementById(ROOT_ID)).toBe(host);
    expect(t.deps.mount).toHaveBeenCalledExactlyOnceWith(host);
    dispose();
    expect(t.unmount).toHaveBeenCalledTimes(1);
    expect(document.getElementById(ROOT_ID)).toBeNull();
  });

  it("U17: after dispose a settings change does not place", () => {
    const t = setup();
    const { host, dispose } = mountPanelHost(t.deps);
    t.fire();
    expect(t.deps.place).toHaveBeenCalledExactlyOnceWith(host);
    dispose();
    expect(t.listeners.size).toBe(0);
    t.fire();
    expect(t.deps.place).toHaveBeenCalledTimes(1);
  });

  it("dispose twice unmounts once", () => {
    const t = setup();
    const { dispose } = mountPanelHost(t.deps);
    dispose();
    dispose();
    expect(t.unmount).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing #tpp-preview-root", () => {
    const existing = document.createElement("div");
    existing.id = ROOT_ID;
    document.body.appendChild(existing);
    const t = setup();
    const { host } = mountPanelHost(t.deps);
    expect(host).toBe(existing);
    expect(document.querySelectorAll(`#${ROOT_ID}`)).toHaveLength(1);
  });

  it("U22: a throwing mount removes the host it created and re-throws", () => {
    const t = setup();
    const boom = new Error("boom");
    t.deps.mount.mockImplementationOnce(() => {
      throw boom;
    });
    expect(() => mountPanelHost(t.deps)).toThrow(boom);
    expect(document.getElementById(ROOT_ID)).toBeNull();
    expect(t.deps.onSettingsChange).not.toHaveBeenCalled();
  });
});
