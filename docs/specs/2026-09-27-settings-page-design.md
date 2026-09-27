# Settings on the Spicetify Settings Page — Design Spec

**Date:** 2026-09-27
**Status:** Approved design — spec pending review
**Builds on:** [`2026-07-22-track-playlist-preview-design.md`](2026-07-22-track-playlist-preview-design.md)
(the shipped module, whose AC42 put settings in a profile-menu modal) and
[`2026-07-25-preview-modal-design.md`](2026-07-25-preview-modal-design.md) (the preview panel, whose
layering note mentions that modal). Criteria here are numbered **S1…** so they cannot collide with
AC1–AC70 or R1–R16.

---

## Problem

Settings open from a **Track & Playlist Preview** item in Spotify's profile menu, which shows a
`Spicetify.PopupModal`. Under Spicetify v3, the first-party module guidance says not to do this:

- `spicetify/modules` → `BEST_PRACTICES.md`, "Put settings where their effect is clear": durable
  module-wide preferences belong on the Spicetify Settings page via stdlib's `settingsSection`
  register. "**Do not put settings in the account dropdown.**"
- `spicetify/modules` → `docs/module-standard.md`: "Durable behavior, provider/integration choices,
  credentials, caches, and defaults belong in Spicetify Settings … Do not use the account menu as a
  settings drawer." Settings UI is built from stdlib's `SettingsSection` / `Settings*Row` components.

This change moves the settings to that page, which makes the module a standard v3 module with a
`load(ctx)` entry and a declared stdlib dependency.

## Terms

Spec-local (no `CONTEXT.md` glossary exists). Extends the Terms of the prior specs.

| Term | Meaning |
| --- | --- |
| **Spicetify Settings page** | The page stdlib serves at route `/bespoke/settings` (`SPICETIFY_SETTINGS_ROUTE`). Users reach it from the profile menu → **Spicetify Settings**, an item added by the `manager` module. |
| **Settings section** | This module's named group on the Spicetify Settings page, registered through stdlib's `settingsSection` register. |
| **Registrar** | The object `createRegistrar(ctx)` returns. Everything registered through it is removed when the module unloads. |
| **Client readiness** | `Spicetify.React`, `Spicetify.ContextMenu` and `Spicetify.Platform` all present — the globals `load()` touches before any user interaction. |

_Avoid:_ "settings modal" and "settings menu" for the new surface; there is no modal and no menu
item.

## Investigation Findings

Verified 2026-09-27 against Spotify 1.2.96.518, Spicetify CLI 3.0.0-beta.19, stdlib 1.13.0 (the
current upstream stdlib version), by source reading and over CDP (`scripts/cdp-eval.mjs`).

- **Module entry.** CLI `docs/v3-modules.md` (tag `v3.0.0-beta.19`): `entries.js` is an ES module
  exporting any of `mixin`, `preload`, `load(ctx)`. The first-party `manager` module ends with
  `export { load }`. The current bundle is a self-running IIFE with no exports, so it never
  receives `ctx`.
- **Registrar.** stdlib `src/registers/index.js`: `createRegistrar(ctx)` builds a `Registrar` with
  `ctx.identifier` and calls `ctx.defer(() => registrar.dispose())`. `register(type, el)` adds to
  `registers[type]`; `dispose()` removes every ledgered item. `registers` is not exported from
  `mod.js`; the registrar is the public path.
- **Settings page.** stdlib `src/registers/settingsSection.js` registers the route
  `/bespoke/settings` and renders "Spicetify Settings", then each registered section, then the
  CORS proxy section, then settings actions. `manager` adds the profile-menu item **Spicetify
  Settings** that pushes that route.
- **Components.** `/modules/stdlib/lib/primitives.js` exports `SettingsSection` (`title`,
  `children`), `SettingsToggleRow` (`label`, `getValue`, `onChange`), `SettingsTextInputRow`
  (`label`, `description`, `value`, `placeholder`, `ariaLabel`, `onInput`), `Select`, `TextInput`,
  `Toggle`. There is no numeric input; `SettingsTextInputRow` is controlled by `value`.
- **React identity.** stdlib's `React` export is a proxy over the client's React:
  `createElement` and `useState` are identical to `Spicetify.React`'s (both 18.3.1). No second
  React is introduced.
- **Readiness at `load()`.** CLI `src/jsHelper/modularLoader/index.ts` `waitForClient(15000)` waits
  for `main` + `Spicetify.Platform`, then for `Spicetify.Events.webpackLoaded`, bounded by the same
  deadline. On timeout it logs "client did not come up in time; running module loads anyway" and
  runs `load()` regardless. `Spicetify.URI` is completed by a separate un-awaited retry loop
  (`webpack/uri.js` `waitForURI`). `ContextMenu.Item` construction needs React.
  `LocalStorage` and `SVGIcons` are set synchronously. First-party modules do not poll in `load()`;
  stdlib's authoring guide says to cap any wait.
- **Context-menu label.** `Spicetify.ContextMenu.Item.prototype` has a `name` setter, so a
  registered item's label can change without re-registering.
- **Storage.** stdlib `createStorage(ctx)` prefixes keys as `module:<identifier>:<key>`. The
  current key `track-playlist-preview:settings` already starts with the module id.

## Design

### Decisions

| # | Decision |
| --- | --- |
| Q1 | Become a standard v3 module: ES-module bundle exporting `load(ctx)`, `createRegistrar(ctx)`, `metadata.json` declares `"stdlib": "^1.13.0"`. |
| Q2 | Remove the profile-menu item and the `PopupModal`. |
| Q3 | Duration and gap are entered in seconds; storage stays in ms. |
| Q4 | Fix the stale *Preview track (Ns)* label in this change. |
| Q5 | Keep the storage key and `Spicetify.LocalStorage`; no migration. |
| Q6 | Only the registrar's items are removed on unload in this change; full teardown is #8. |
| Q7 | One client-readiness wait, capped at `READY_TIMEOUT_MS` (10 000 ms); on timeout `load()` throws. |
| Q8 | Duration ≥ `MIN_DURATION_MS` (1000 ms), gap ≥ 0 ms, no upper bound; other values are ignored. |

### Behaviour

**Entry.** The bundle is an ES module whose only export is `load(ctx)`. `load` first awaits
`waitForClient()`. When client readiness already holds, it resolves without waiting on a timer.
Otherwise it re-checks until readiness holds or `READY_TIMEOUT_MS` passes; on timeout it rejects
with an `Error` naming each missing global, and `load` rethrows so the loader records the module
as failed in `Spicetify.Modules.report`. After readiness, `load` wires everything exactly as
today's `main()` does, minus the profile-menu item, plus the settings section.

**Settings section.** Registered through the registrar as `settingsSection`, titled
**Track & Playlist Preview**, rows in this order:

1. **Preview duration (seconds)** — `SettingsTextInputRow`.
2. **Gap between tracks (seconds)** — `SettingsTextInputRow`.
3. **Playlists**, **Liked Songs**, **Albums**, **Artists** — `SettingsToggleRow` each.

The text rows open showing the stored value in seconds (`formatSeconds(ms)`: ms / 1000 with no
trailing zeros, e.g. 15000 → `15`, 500 → `0.5`). Each keystroke keeps the typed text in the input
and passes it to `parseSeconds(text, minMs)`:

- Leading/trailing whitespace is ignored; a comma is treated as a decimal point.
- The text must be digits with an optional fractional part (`^\d+([.,]\d+)?$`). Anything else —
  empty, negative, exponent, `Infinity`, letters — returns `null`.
- The value is converted to ms and rounded to the nearest integer; below `minMs` returns `null`.

A non-null result is saved immediately; `null` saves nothing, and the last valid value stays in
effect. Revisiting the page shows the stored value, not the rejected text.

**Limits in the store.** `settings.setDurationMs(ms)` accepts only finite `ms ≥ MIN_DURATION_MS`;
`setGapMs(ms)` only finite `ms ≥ 0`. A rejected value changes nothing, persists nothing and
notifies no one. On load, a stored duration or gap that is not a finite number within its limit
falls back to its default (`DEFAULT_SETTINGS`), field by field.

**Change notification.** `settings.onChange(listener)` returns an unsubscribe function. Every
accepted setter call (duration, gap, collection toggle) calls each listener once, after persisting.

**Live label.** `contextMenus` subscribes to settings changes and sets the *Preview track* item's
`name` to `Preview track (${Math.round(durationMs / 1000)}s)` whenever the duration changes.

**Unload.** Disabling the module (`Spicetify.Modules.disable("track-playlist-preview")`) removes the
settings section via the registrar. Everything else stays mounted until #8.

### Modules

| Module | Change | Notes |
| --- | --- | --- |
| `build.ts` | change | `format: "esm"`; drop the IIFE readiness wrapper; keep the `<style>` injection at module top level; mark `/modules/stdlib/*` external; `metadata()` copies `package.json` `spicetify.dependencies`. |
| `package.json` | change | Add `"spicetify": { "dependencies": { "stdlib": "^1.13.0" } }`. |
| `src/index.ts` | change | `export async function load(ctx)`; call `waitForClient`; drop the `Spicetify.Menu` wait and `registerSettingsMenu`; `createRegistrar(ctx)`; register the settings section. |
| `src/waitForClient.ts` | **new** | Pure: `waitForClient({ missing, timer, timeoutMs })` where `missing()` returns the names of absent globals. `index.ts` supplies the Spicetify probe. |
| `src/settings.ts` | change | Setter limits, load-time fallback, `onChange`. Exports `MIN_DURATION_MS`. |
| `src/ui/settingsSection.view.ts` | **new** | Pure: `parseSeconds`, `formatSeconds`. |
| `src/ui/settingsSection.tsx` | **new** | The only file importing `/modules/stdlib/…`. Builds and registers the section. |
| `src/ui/settingsModal.ts` | **deleted** | Replaced by `settingsSection`. |
| `src/ui/contextMenus.ts` | change | Subscribe to settings; update the *Preview track* label. |
| `src/types/stdlib.d.ts` | **new** | `declare module` for `/modules/stdlib/mod.js` and `/modules/stdlib/lib/primitives.js`, typing only what we use (`createRegistrar`, `ModuleRuntimeContext`, `SettingsSection`, `SettingsToggleRow`, `SettingsTextInputRow`). |
| `src/types/spicetify.d.ts` | change | Drop `Menu` and `PopupModal` typings if nothing else uses them. |

### Testing

Vitest (`bun run test`), tests beside the module:

- `settingsSection.view.test.ts` — `parseSeconds` and `formatSeconds` cases from S7–S8.
- `settings.test.ts` — limits, load-time fallback, `onChange` (S10, S11, S17).
- `waitForClient.test.ts` — immediate resolve, late resolve, timeout message (S3–S4), with an
  injected timer.
- `contextMenus.test.ts` — label follows duration changes (S13).
- `index.test.ts` — `load()` registers nothing when readiness fails (S18), with the registrar and
  context-menu modules mocked.

After `bun run build`: S1 (read the written `metadata.json`). Over CDP after `spicetify apply`: S2,
S5, S6, S9, S12, S14 and S15.

## Acceptance Criteria

**Packaging**

- **S1** — `bun run build` writes `metadata.json` whose `dependencies` equals
  `{ "stdlib": "^1.13.0" }` and whose `version` equals `package.json`'s `version`.
- **S2** — The built `index.js` is an ES module with a single export, `load`. It contains no
  readiness polling loop at module top level, and imports stdlib only from `/modules/stdlib/mod.js`
  and `/modules/stdlib/lib/primitives.js` (not bundled). Given stdlib satisfying `^1.13.0` is
  installed and enabled, after `spicetify apply` `Spicetify.Modules.report.loaded` contains both `stdlib` and `track-playlist-preview`, `stdlib`
  first, and `failed` has no `track-playlist-preview` entry.

**Readiness**

- **S3** — Given client readiness already holds, `waitForClient` resolves without scheduling any
  timer. Given readiness first holds after some delay shorter than `READY_TIMEOUT_MS`, it resolves.
- **S4** — Given readiness never holds, `waitForClient` rejects once `READY_TIMEOUT_MS` has passed,
  with an `Error` whose message names each missing global (e.g. `Spicetify.ContextMenu`), and
  `load()` rejects with that error.

**Settings page**

- **S5** — On `/bespoke/settings`, a section titled **Track & Playlist Preview** is present with
  exactly these rows in order: *Preview duration (seconds)*, *Gap between tracks (seconds)*,
  *Playlists*, *Liked Songs*, *Albums*, *Artists*.
- **S6** — With stored settings `durationMs 15000`, `gapMs 500`, the two text inputs show `15` and
  `0.5`, and each toggle shows its stored state.
- **S7** — `formatSeconds`: 15000 → `"15"`, 500 → `"0.5"`, 1250 → `"1.25"`, 0 → `"0"`.
- **S8** — `parseSeconds(text, 1000)`: `"15"` → 15000; `" 2 "` → 2000; `"0,5"` with min 0 → 500;
  `"1.5"` → 1500; `"0.9"` → `null` (below min); `""`, `"abc"`, `"-1"`, `"1e3"`, `"Infinity"`,
  `".5"` → `null`. With min 0, `"0"` → 0. Rounding happens before the minimum check:
  `"1.2345"` → 1235; `"0.9996"` → 1000.
- **S9** — Given the duration input, the input keeps showing every typed string, valid or
  rejected. When the text parses to a valid value, `getDurationMs()` returns it immediately; when it
  parses to `null`, `getDurationMs()` is unchanged. Leaving and reopening the Spicetify Settings page
  shows the stored value via `formatSeconds`, not the rejected text. The same holds for the gap
  input with minimum 0.
- **S10** — `setDurationMs` with a value below `MIN_DURATION_MS`, `NaN` or `Infinity`, and `setGapMs`
  with a negative value, `NaN` or `Infinity`, leave the stored JSON and getters unchanged and call
  no `onChange` listener. Every accepted setter call persists and then calls each listener exactly
  once; when a listener runs, the stored JSON already holds the new value.
- **S11** — Given stored JSON with `durationMs 0` and `gapMs -5`, loading settings yields
  `durationMs 15000` and `gapMs 0` (defaults), while the stored `enabled` flags are kept. Each field
  falls back on its own: given `durationMs 0` and `gapMs 2000`, loading yields `durationMs 15000`
  and `gapMs 2000`; given `durationMs 8000` and `gapMs "x"`, it yields `durationMs 8000` and
  `gapMs 0`.
- **S12** — The profile menu contains no *Track & Playlist Preview* item, and `src/` contains no
  reference to `Spicetify.Menu` or `Spicetify.PopupModal` (grep).

**Live label**

- **S13** — After the duration is set to 10000 ms, the track context-menu item reads
  *Preview track (10s)* without a restart, and *Preview from here* is unchanged. The label uses
  `Math.round(durationMs / 1000)`: after 10500 ms it reads *Preview track (11s)*.

**Compatibility and unload**

- **S14** — Settings stored before this change (same key, ms values within limits) load unchanged,
  and AC29, AC30, AC35, AC43, AC44 and AC45 still hold with settings changed from the new section.
- **S15** — After `Spicetify.Modules.disable("track-playlist-preview")`, the Spicetify Settings page
  no longer shows the **Track & Playlist Preview** section.
- **S16** — Only `src/ui/settingsSection.tsx` imports a `/modules/stdlib/` path (grep).

**Change notification and readiness failure**

- **S17** — `setEnabled` with any collection type calls each `onChange` listener exactly once, after
  persisting. After the function returned by `onChange(listener)` is called, no later accepted
  setter call invokes that listener; other listeners are still called.
- **S18** — Given `waitForClient` rejects, `load()` rejects without registering the settings
  section or any context-menu item.

## Deferred Items

- #8 — Remove everything the module mounted when it is unloaded
- #9 — Setting to choose where the preview panel opens (follow-up that adds a `Select` row to this
  section)

## Glossary Updates & ADRs

None to a glossary file — no `CONTEXT.md` exists; terms are spec-local (see **Terms**). No ADR: the
move to `load(ctx)` is easy to reverse and follows the platform's documented default, so it fails
the "hard to reverse" and "surprising" criteria. No conflict with ADR 0001.

## Config & Infrastructure Impact

| File | Change |
| --- | --- |
| `build.ts` | ES-module output, drop IIFE wrapper, externalise `/modules/stdlib/*`, metadata dependencies from `package.json`. |
| `package.json` | Add `spicetify.dependencies`. |
| `metadata.json` (generated) | Gains `dependencies.stdlib`. Not committed; produced by the build. |
| `tsconfig.json` | No change: `src/types/stdlib.d.ts` is covered by `include: ["src/**/*"]`. |
| CI | None — no `.github/` directory. |
| Env / secrets | None. |
| `scripts/cdp-eval.mjs` | No change. |

## Manual Operator Steps

None beyond the usual: after `bun run build`, run `spicetify apply` (restarts Spotify).

stdlib needs no manual install. Verified in CLI source (tag `v3.0.0-beta.19`):

- `commands/apply.rs` `stage_modules` calls `pkg::ensure_system_modules` on every apply.
  `SYSTEM_MODULES = ["stdlib", "store", "manager"]` are installed when absent and refreshed to the
  registry's latest when outdated. This is best-effort: with the registry unreachable it warns and
  continues, and a system module the user disabled while installed stays off.
- The `dependencies` field is not what installs stdlib; apply never reads it. The loader
  (`modularLoader/registry.ts` `checkDependencies`) enforces it at boot: a missing dependency fails
  the module with "`track-playlist-preview needs stdlib, which is not installed`", and a version
  outside the range fails with "`… needs stdlib@^1.13.0, installed is X`", both visible in
  `Spicetify.Modules.report.failed`.

So the README states the dependency and the one situation that breaks it (stdlib disabled), not an
install step.

## Documentation Updates

| Doc | Change |
| --- | --- |
| `README.md` | Settings: profile menu → **Spicetify Settings** → **Track & Playlist Preview**; table units in seconds, duration minimum 1 s; under Install, note the module depends on stdlib ≥ 1.13.0, which `spicetify apply` installs and keeps current, and that disabling stdlib stops this module loading. |
| `CLAUDE.md` | Build items 3 (readiness wrapper replaced by capped `waitForClient` in `load()`) and 4 (metadata declares stdlib); add a Documentation pointer row to this spec; replace the `ui/` architecture mention of settings if it names the modal. |
| `docs/specs/2026-07-22-track-playlist-preview-design.md` | Mark AC42 superseded by S5/S12, and the "Settings: opened from a `Spicetify.Menu.Item`" line and the `ui/settingsModal` module row, each pointing here. |
| `docs/specs/2026-07-25-preview-modal-design.md` | Annotate the Layering note "so the settings modal covers them when opened mid-session (AC42)" as moot, pointing here. |

## Implementation Plan Guidance

Spikes to run before the build task that depends on them:

- (s1) Confirm Bun's `external` accepts the absolute `/modules/stdlib/*` pattern with
  `format: "esm"` and leaves the import specifiers verbatim in `index.js`.
- (s2) Confirm the loader accepts an ES-module `index.js` exporting only `load` and that the
  top-level `<style>` injection runs once.

Required Task 2 (glossary) and Task 3 (ADRs) do not apply: no `CONTEXT.md`, no ADRs listed.

> **For the plan author (`superpowers:writing-plans`):**
>
> Before writing tasks, read the repo's agent index (`CLAUDE.md`/`AGENTS.md`) for architecture, commands, and conventions.
>
> The plan must include the tasks described under **Required Tasks** below, AND must apply every rule under **Per-Task Policies** to every implementation task.
>
> ---
>
> ### Required Tasks (each item produces explicit numbered tasks in the plan)
>
> 1. **Isolated workspace** — IF the session is not already isolated, add as the first task: *"Create an isolated workspace via `superpowers:using-git-worktrees`."*
> 2. **Glossary application** — IF the spec's "Glossary Updates & ADRs" section lists new or changed terms, add an early task: *"Apply terms to `CONTEXT.md` (using the existing file's format) before any code, test, issue title, or commit message references them."* Code must use the canonical terms; never the synonyms listed under `_Avoid_`.
> 3. **ADR creation** — FOR EACH ADR listed in the spec, add a task: *"Create `docs/adr/NNNN-<slug>.md` following sequential numbering (start at `0001-` if the directory is empty)."* IF the spec lists ADR conflicts surfaced, also add a task: *"Update the conflicting ADR's status (superseded / amended) and link to the new ADR."*
> 4. **Deferred-item verification** — Add a task: *"Confirm every issue referenced in the 'Deferred Items' section exists and has all four required body sections (Context, Required, Integration Points, Priority)."* Run `gh issue view <#> --json body | jq -r .body` and grep for the four headings.
> 5. **Config file tasks** — FOR EACH file listed in the spec's "Config & Infrastructure Impact" section, add one explicit task: *"Update `<path>`."*
> 6. **Manual Operator Steps** — IF the spec's "Manual Operator Steps" section is non-empty, add a task ahead of every task that depends on those values existing: *"Hand the operator the Manual Operator Steps and wait for confirmation; if a wizard-generation skill is available, generate the script first."* The agent never performs these steps itself and never substitutes a placeholder credential to unblock itself.
> 7. **Docs update tasks** — FOR EACH entry in the spec's "Documentation Updates" section, add one explicit task: *"Update `<doc-path>`."* Design content goes in the docs dir, not the agent index; the index gets at most a 1-line pointer, a ≤3-sentence area summary, or a 1-line command/env-var entry.
> 8. **Post-implementation check** — Add as the second-to-last task: *"Verify every Required Task above was actually executed — config files updated, docs written, glossary entries applied, ADRs created."* Read the diff; don't trust plan markings.
> 9. **Final build task** — Add as the last task: *"Run `bun run build` and fix any issues until it builds successfully."* Non-negotiable — type-checks and tests alone do not catch all build-time failures.
>
> ---
>
> ### Per-Task Policies (apply to every implementation task)
>
> These are not separate tasks; they are rules every task must follow.
>
> - **Testing (TDD)** — Follow `superpowers:test-driven-development`, using the repo's test runner and file-name conventions.
> - **Verification before completion** — Before claiming a task done, invoke `superpowers:verification-before-completion`. Do not rely on type-checks alone for UI features.
> - **Commit hygiene** — One focused commit per task, matching the commit-message convention visible in this repo's history. Commit frequently.
> - **Pre-commit verification (mandatory)** — Before EVERY `git commit`, dispatch a verification subagent that runs `bun run check` from the repo root and reports `STATUS: PASS` or `STATUS: FAIL` with a terse per-issue list (no raw output). Wait for `STATUS: PASS` before committing; if FAIL, fix in the current task and re-run. Never use `git commit --no-verify`.
>
> ---
>
> ### Before finishing the branch (advisory cross-model review)
>
> After the final build passes — and before wrapping up via `superpowers:finishing-a-development-branch` — if a cross-model review helper is available (e.g. the Codex plugin's adversarial review), run it with focus: *"Judge correctness against the spec's acceptance criteria (S1–S18) only. Do not flag anything outside the stated criteria — no design alternatives, hardening, or scope the spec did not claim."*
>
> This **never gates a merge** — the gate stays `bun run check` plus `bun run build`; the review only flags what deserves a second look. If no helper is available, finish the branch without it.
