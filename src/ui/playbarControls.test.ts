import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPlaybarControls } from "./playbarControls";

const SVG_ICONS = { "skip-forward": '<path d="skip"/>', x: '<path d="x"/>' };

let constructed: { label: string; icon: string; register: ReturnType<typeof vi.fn>; deregister: ReturnType<typeof vi.fn> }[];

beforeEach(() => {
  constructed = [];
  class Button {
    register = vi.fn();
    deregister = vi.fn();
    constructor(
      public label: string,
      public icon: string,
    ) {
      constructed.push(this);
    }
  }
  (globalThis as unknown as { Spicetify: unknown }).Spicetify = {
    Playbar: { Button },
    SVGIcons: SVG_ICONS,
  };
});

describe("playbarControls", () => {
  it("passes icons as SVG markup, not icon names", () => {
    // Spicetify v3's Playbar.Button compat shim injects the icon string verbatim
    // as SVG innerHTML, so a bare name renders an empty button.
    createPlaybarControls({ onSkip: vi.fn(), onStop: vi.fn() }).register();
    const icons = Object.fromEntries(constructed.map((b) => [b.label, b.icon]));
    expect(icons["Skip preview"]).toMatch(/^<svg[^>]*viewBox="0 0 16 16"[^>]*>.*<\/svg>$/);
    expect(icons["Skip preview"]).toContain(SVG_ICONS["skip-forward"]);
    expect(icons["Stop preview"]).toContain(SVG_ICONS.x);
  });

  it("registers once across repeated calls and deregisters both", () => {
    const controls = createPlaybarControls({ onSkip: vi.fn(), onStop: vi.fn() });
    controls.register();
    controls.register();
    expect(constructed).toHaveLength(2);
    controls.deregister();
    for (const b of constructed) expect(b.deregister).toHaveBeenCalledOnce();
  });
});
