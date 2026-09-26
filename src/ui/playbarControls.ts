// src/ui/playbarControls.ts
// Skip and Stop buttons live in the Playbar only while a session is active.
export interface PlaybarControlsDeps {
  onSkip(): void;
  onStop(): void;
}

/**
 * Full SVG markup for a built-in icon. Spicetify v2 resolves bare icon names,
 * but v3's Playbar.Button compat shim injects the string verbatim as SVG
 * innerHTML, so a bare name renders an empty button. Markup works in both.
 */
function iconSvg(name: Spicetify.Icon): string {
  return `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">${Spicetify.SVGIcons[name]}</svg>`;
}

export function createPlaybarControls(deps: PlaybarControlsDeps) {
  let skip: Spicetify.Playbar.Button | null = null;
  let stop: Spicetify.Playbar.Button | null = null;

  return {
    register(): void {
      if (skip || stop) return; // idempotent (AC33 across replacement)
      skip = new Spicetify.Playbar.Button("Skip preview", iconSvg("skip-forward"), () => deps.onSkip(), false, false);
      stop = new Spicetify.Playbar.Button("Stop preview", iconSvg("x"), () => deps.onStop(), false, false);
      skip.register();
      stop.register();
    },
    deregister(): void {
      skip?.deregister();
      stop?.deregister();
      skip = null;
      stop = null;
    },
  };
}
