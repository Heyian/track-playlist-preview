// src/types/stdlib.d.ts
// Types for the stdlib module's public entry points, covering only what
// ui/settingsSection.tsx uses. stdlib is served by the client at runtime
// (build.ts leaves these imports external), so there is no package to type from.
// The names carry a leading `*`: TypeScript treats a rooted name like
// "/modules/…" as a relative path and never matches it to a plain declaration.

declare module "*/modules/stdlib/mod.js" {
  /** The context the v3 loader passes to a module's `load(ctx)`. */
  export interface ModuleRuntimeContext {
    identifier: string;
    defer(fn: () => void): void;
  }

  export interface Registrar {
    register(type: "settingsSection", element: import("react").ReactElement): void;
  }

  /** A registrar whose items are removed when the module unloads. */
  export function createRegistrar(ctx: ModuleRuntimeContext): Registrar;
}

declare module "*/modules/stdlib/lib/primitives.js" {
  import type { ReactElement, ReactNode } from "react";

  export function SettingsSection(props: { title?: string; children?: ReactNode }): ReactElement;
  export function SettingsToggleRow(props: {
    label: string;
    getValue: () => boolean;
    onChange(value: boolean): void;
  }): ReactElement;
  export function SettingsTextInputRow(props: {
    label: string;
    description?: string;
    value: string;
    placeholder?: string;
    ariaLabel?: string;
    onInput(value: string): void;
  }): ReactElement;
}
