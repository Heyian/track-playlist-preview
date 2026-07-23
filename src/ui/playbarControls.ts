// src/ui/playbarControls.ts
// Skip and Stop buttons live in the Playbar only while a session is active.
export interface PlaybarControlsDeps {
  onSkip(): void;
  onStop(): void;
}

export function createPlaybarControls(deps: PlaybarControlsDeps) {
  let skip: Spicetify.Playbar.Button | null = null;
  let stop: Spicetify.Playbar.Button | null = null;

  return {
    register(): void {
      if (skip || stop) return; // idempotent (AC33 across replacement)
      skip = new Spicetify.Playbar.Button("Skip preview", "skip-forward", () => deps.onSkip(), false, false);
      stop = new Spicetify.Playbar.Button("Stop preview", "x", () => deps.onStop(), false, false);
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
