// src/ui/settingsSection.tsx
// This module's section on the Spicetify Settings page (S5, S6, S9, S15; Panel position P3).
// The only file that imports stdlib (S16); its items unload with the registrar.
import React from "react";
import { createRegistrar, type ModuleRuntimeContext } from "/modules/stdlib/mod.js";
import {
  Select,
  SettingsRow,
  SettingsSection,
  SettingsTextInputRow,
  SettingsToggleRow,
} from "/modules/stdlib/lib/primitives.js";
import { MIN_DURATION_MS, type Settings } from "../settings";
import type { CollectionType } from "../types/domain";
import { formatSeconds, parseSeconds, PANEL_POSITION_OPTIONS } from "./settingsSection.view";

export type { ModuleRuntimeContext };

const TYPES: { key: CollectionType; label: string }[] = [
  { key: "playlist", label: "Playlists" },
  { key: "likedSongs", label: "Liked Songs" },
  { key: "album", label: "Albums" },
  { key: "artist", label: "Artists" },
];

interface SecondsRowProps {
  label: string;
  get(): number;
  set(ms: number): void;
  minMs: number;
}

/**
 * A seconds field over a ms setting. The row is controlled by `value`, so the
 * typed text lives here: a rejected keystroke stays visible and saves nothing (S9).
 */
function SecondsRow({ label, get, set, minMs }: SecondsRowProps) {
  const [text, setText] = React.useState(() => formatSeconds(get()));
  return (
    <SettingsTextInputRow
      label={label}
      value={text}
      ariaLabel={label}
      onInput={(value) => {
        setText(value);
        const ms = parseSeconds(value, minMs);
        if (ms !== null) set(ms);
      }}
    />
  );
}

/** The Panel position select. Local state keeps the `<select>` controlled and mirrors the store (P3). */
function PositionRow({ settings }: { settings: Settings }) {
  const [value, setValue] = React.useState(() => settings.getPanelPosition());
  return (
    <SettingsRow label="Panel position">
      <Select
        options={PANEL_POSITION_OPTIONS}
        value={value}
        ariaLabel="Panel position"
        onChange={(v) => {
          settings.setPanelPosition(v);
          setValue(settings.getPanelPosition());
        }}
      />
    </SettingsRow>
  );
}

function Section({ settings }: { settings: Settings }) {
  return (
    <SettingsSection title="Track & Playlist Preview">
      <SecondsRow
        label="Preview duration (seconds)"
        get={() => settings.getDurationMs()}
        set={(ms) => settings.setDurationMs(ms)}
        minMs={MIN_DURATION_MS}
      />
      <SecondsRow
        label="Gap between tracks (seconds)"
        get={() => settings.getGapMs()}
        set={(ms) => settings.setGapMs(ms)}
        minMs={0}
      />
      <PositionRow settings={settings} />
      {TYPES.map((t) => (
        <SettingsToggleRow
          key={t.key}
          label={t.label}
          getValue={() => settings.isEnabled(t.key)}
          onChange={(on) => settings.setEnabled(t.key, on)}
        />
      ))}
    </SettingsSection>
  );
}

export function registerSettingsSection(ctx: ModuleRuntimeContext, settings: Settings): void {
  createRegistrar(ctx).register("settingsSection", <Section settings={settings} />);
}
