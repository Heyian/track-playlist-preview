// src/ui/settingsModal.ts
// Profile-menu entry → settings modal. Uses Spicetify.React so it is bundled
// against Spotify's own React (see build.ts alias).
import type { Settings } from "../settings";
import type { CollectionType } from "../types/domain";

const react = Spicetify.React;

const TYPES: { key: CollectionType; label: string }[] = [
  { key: "playlist", label: "Playlists" },
  { key: "likedSongs", label: "Liked Songs" },
  { key: "album", label: "Albums" },
  { key: "artist", label: "Artists" },
];

function SettingsPanel({ settings }: { settings: Settings }): unknown {
  const [, force] = react.useReducer((n: number) => n + 1, 0);
  const numberRow = (labelText: string, value: number, onChange: (n: number) => void) =>
    react.createElement(
      "label",
      { style: { display: "flex", justifyContent: "space-between", gap: "1rem", margin: "0.5rem 0" } },
      labelText,
      react.createElement("input", {
        type: "number",
        min: 0,
        defaultValue: value,
        onChange: (e: any) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 0) onChange(n);
        },
      }),
    );

  return react.createElement(
    "div",
    null,
    numberRow("Preview duration (ms)", settings.getDurationMs(), (n) => {
      settings.setDurationMs(n);
      force();
    }),
    numberRow("Gap between tracks (ms)", settings.getGapMs(), (n) => {
      settings.setGapMs(n);
      force();
    }),
    ...TYPES.map((t) =>
      react.createElement(
        "label",
        { key: t.key, style: { display: "flex", justifyContent: "space-between", gap: "1rem", margin: "0.5rem 0" } },
        t.label,
        react.createElement("input", {
          type: "checkbox",
          defaultChecked: settings.isEnabled(t.key),
          onChange: (e: any) => {
            settings.setEnabled(t.key, Boolean(e.target.checked));
            force();
          },
        }),
      ),
    ),
  );
}

export function registerSettingsMenu(settings: Settings): void {
  const item = new Spicetify.Menu.Item("Track & Playlist Preview", false, () => {
    Spicetify.PopupModal.display({
      title: "Track & Playlist Preview",
      content: react.createElement(SettingsPanel, { settings }),
    });
  });
  item.register();
}
