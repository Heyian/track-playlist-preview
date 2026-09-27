# Settings on the Spicetify Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move settings from the profile-menu `PopupModal` to a section on the Spicetify Settings
page, making the module a standard v3 module with a `load(ctx)` entry and a declared stdlib
dependency.

**Architecture:** Three new pure units carry the logic and are unit-tested: `parseSeconds` /
`formatSeconds` (`ui/settingsSection.view.ts`), `waitForClient` (injected probe and timer), and the
settings store's limits and `onChange`. `ui/settingsSection.tsx` is the only file touching stdlib
and is verified live over CDP. `index.ts` becomes `export async function load(ctx)`; `build.ts`
emits an ES module with stdlib imports left external.

**Tech Stack:** TypeScript (strict), Bun bundler (`build.ts`), Vitest, React via `Spicetify.React`
(aliased in `build.ts`), stdlib 1.13.0 primitives, Spicetify CLI 3.0.0-beta.19 on Spotify
1.2.96.518.

**Spec:** `docs/specs/2026-09-27-settings-page-design.md` (criteria S1–S18). Read it before starting.

## Global Constraints

- Quality gate: `bun run check` (typecheck + vitest). No linter. `bun run build` does not typecheck.
- Only `src/ui/settingsSection.tsx` imports a `/modules/stdlib/` path — type imports included (S16).
- `metadata.json` `dependencies` is `{ "stdlib": "^1.13.0" }`, copied from `package.json`
  `spicetify.dependencies` (S1).
- Client readiness = `Spicetify.React`, `Spicetify.ReactDOM`, `Spicetify.ContextMenu`, `Spicetify.Platform` all present.
  `READY_TIMEOUT_MS` = 10 000. `MIN_DURATION_MS` = 1000. Gap minimum 0. No upper bounds.
- Storage key stays `track-playlist-preview:settings` via `Spicetify.LocalStorage`; values stay in ms.
- Section title **Track & Playlist Preview**; row labels exactly *Preview duration (seconds)*,
  *Gap between tracks (seconds)*, *Playlists*, *Liked Songs*, *Albums*, *Artists*, in that order.
- Label copy: `Preview track (${Math.round(durationMs / 1000)}s)`.
- Never use `Spicetify.PopupModal` or `Spicetify.Menu` (S12). Full unload teardown is out of scope (#8).
- Commit messages: imperative sentence, no prefix, no AI attribution (matches `git log`).
- Before every commit, a verification subagent runs `bun run check` and reports `STATUS: PASS` /
  `STATUS: FAIL`; commit only on PASS. Never `--no-verify`.

## Review Focus

1. **Comma and whitespace together** — `" 0,5 "` with min 0 is 500, not `null`. → Task 3.
2. **Leading/trailing zeros** — `"007"` → 7000, `"1.50"` → 1500. → Task 3.
3. **Stored value of the wrong type** — `durationMs: "8000"` (a string) falls back to 15000; a
   stored object with no `enabled` keeps all four types on. → Task 4.
4. **Partial readiness at the deadline** — React and Platform arrive, ContextMenu never does: the
   error names only `Spicetify.ContextMenu`, not the globals missing at the first check. → Task 5.
5. **Toggle change fires the label listener** — `setEnabled` notifies `contextMenus`; the
   *Preview track* label must still match the unchanged duration. → Task 6.

---

### Task 1: Isolated workspace and spec carry-over

**Files:** none in `src/`.

- [ ] **Step 1:** Create an isolated workspace via `superpowers:using-git-worktrees` (branch
  `settings-page`).
- [ ] **Step 2:** The critique-folded spec and this plan are uncommitted on `main`'s worktree. Copy
  `docs/specs/2026-09-27-settings-page-design.md` and
  `docs/superpowers/plans/2026-09-27-settings-page.md` into the new worktree, then
  `git -C <main worktree> checkout -- docs/specs/2026-09-27-settings-page-design.md` and delete the
  plan copy there.
- [ ] **Step 3:** Commit in the worktree: `Fold the spec critique into the Settings-page criteria and add its plan`.

### Task 2: Verify deferred-item issues

- [ ] **Step 1:** For #8 and #9:
  `gh issue view <N> --json body | jq -r .body | grep -E '^#+ (Context|Required|Integration Points|Priority)'`
  Expected: four headings each. If any is missing, edit the issue body to add it (content from the
  spec's Deferred Items and Behaviour → Unload) and re-run.

### Task 3: `parseSeconds` / `formatSeconds` (S7, S8)

**Files:** Create `src/ui/settingsSection.view.ts`, `src/ui/settingsSection.view.test.ts`

**Interfaces:**
- Produces: `formatSeconds(ms: number): string`; `parseSeconds(text: string, minMs: number): number | null`.

- [ ] **Step 1: Write failing tests** — table-driven with `it.each`:
  - `formatSeconds`: 15000 → `"15"`, 500 → `"0.5"`, 1250 → `"1.25"`, 0 → `"0"`.
  - `parseSeconds(t, 1000)`: `"15"` → 15000; `" 2 "` → 2000; `"1.5"` → 1500; `"1.2345"` → 1235;
    `"0.9996"` → 1000; `"007"` → 7000; `"1.50"` → 1500; `"0.9"`, `""`, `"abc"`, `"-1"`, `"1e3"`,
    `"Infinity"`, `".5"` → `null`.
  - `parseSeconds(t, 0)`: `"0,5"` → 500; `" 0,5 "` → 500; `"0"` → 0.
- [ ] **Step 2:** `bun run test src/ui/settingsSection.view.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement.** `formatSeconds` is `String(ms / 1000)`. `parseSeconds`: trim; reject
  unless `/^\d+([.,]\d+)?$/`; replace `,` with `.`; `Math.round(Number(s) * 1000)`; below `minMs` →
  `null` (rounding before the min check).
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5:** Commit `Parse and format settings values in seconds`.

### Task 4: Settings limits, load-time fallback, `onChange` (S10, S11, S17)

**Files:** Modify `src/settings.ts`, `src/settings.test.ts`

**Interfaces:**
- Produces: `export const MIN_DURATION_MS = 1000`; on the returned object,
  `onChange(listener: () => void): () => void` (returns unsubscribe). Existing getters/setters keep
  their signatures.

- [ ] **Step 1: Write failing tests** in `settings.test.ts` (reuse `memoryStorage`):
  - S10: each of `setDurationMs(999)`, `setDurationMs(NaN)`, `setDurationMs(Infinity)`,
    `setGapMs(-1)`, `setGapMs(NaN)`, `setGapMs(Infinity)` leaves the raw stored string, the getters,
    and a `vi.fn()` listener untouched (`not.toHaveBeenCalled`).
  - S10: `setDurationMs(1000)` and `setGapMs(0)` are accepted; a listener that reads
    `JSON.parse(storage.get(KEY)!)` inside itself sees the new value; called exactly once per call.
  - S17: `setEnabled("album", false)` calls each of two listeners once, after persisting. After
    calling the unsubscribe returned for listener A, `setGapMs(100)` calls B but not A.
  - S11: stored `{durationMs: 0, gapMs: -5, enabled: {album: false}}` → 15000 / 0 /
    `isEnabled("album") === false`. `{durationMs: 0, gapMs: 2000}` → 15000 / 2000.
    `{durationMs: 8000, gapMs: "x"}` → 8000 / 0.
  - Review Focus 3: `{durationMs: "8000"}` → 15000; `{durationMs: 3000}` → all four types enabled.
- [ ] **Step 2:** `bun run test src/settings.test.ts` → the new tests FAIL.
- [ ] **Step 3: Implement.** Field validity = `typeof v === "number" && Number.isFinite(v) && v >= min`,
  in both the loader and the setters. Listeners live in a `Set`; setters return early on invalid
  input, otherwise mutate → `persist()` → notify. `setEnabled` notifies too.
- [ ] **Step 4:** Re-run → PASS (the existing AC43/AC44 tests included).
- [ ] **Step 5:** Commit `Enforce settings limits and notify on change`.

### Task 5: `waitForClient` (S3, S4)

**Files:** Create `src/waitForClient.ts`, `src/waitForClient.test.ts`

**Interfaces:**
- Consumes: `TimerPort` from `src/types/domain.ts`; `fakeTimer()` from `src/testing/fakeTimer.ts`.
- Produces: `export const READY_TIMEOUT_MS = 10_000`;
  `waitForClient(opts: { missing: () => string[]; timer: TimerPort; timeoutMs: number; pollMs?: number }): Promise<void>`
  (`pollMs` defaults to 50).

- [ ] **Step 1: Write failing tests** with `fakeTimer()`:
  - S3: `missing: () => []` resolves and `timer.ids()` is empty.
  - S3: `missing` returns `["Spicetify.React"]`, then `[]`; fire the poll timer (the id whose
    `msOf` is 50) → resolves; the deadline timer is cleared (`ids()` empty).
  - S4: `missing` always returns `["Spicetify.ContextMenu", "Spicetify.Platform"]`; fire the timer
    whose `msOf` is `READY_TIMEOUT_MS` → rejects with an `Error` whose message contains both names;
    no timers remain.
  - Review Focus 4: first call returns three names, later calls return only
    `["Spicetify.ContextMenu"]`; fire one poll, then the deadline → message contains
    `Spicetify.ContextMenu` and not `Spicetify.React`.
- [ ] **Step 2:** `bun run test src/waitForClient.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Pure — no `Spicetify` reference. Resolve synchronously-checked
  readiness without a timer; otherwise one deadline timer at `timeoutMs` plus a rescheduled poll at
  `pollMs`. On deadline, reject with
  `new Error(\`Client not ready after ${timeoutMs} ms; missing: ${missing().join(", ")}\`)`. Clear the
  other timer on either outcome.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5:** Commit `Add a capped client-readiness wait`.

### Task 6: Live *Preview track* label (S13)

**Files:** Modify `src/ui/contextMenus.ts`, `src/ui/contextMenus.test.ts`

**Interfaces:**
- Consumes: `Settings.onChange` (Task 4).
- Produces: `ContextMenuDeps` gains `onSettingsChange(listener: () => void): () => void`.

- [ ] **Step 1: Write failing tests.** Change the `Item` mock to keep instances (`name` is a plain
  mutable field) so tests can read the current label. Capture the listener passed to
  `onSettingsChange`; drive `getDurationMs` from a local `let duration`.
  - S13: register at 15000 → label `Preview track (15s)`; set 10000, call listener →
    `Preview track (10s)`; set 10500, call listener → `Preview track (11s)`; the
    `Preview from here` item's `name` is unchanged throughout.
  - Review Focus 5: call the listener without changing the duration → label unchanged.
- [ ] **Step 2:** `bun run test src/ui/contextMenus.test.ts` → FAIL.
- [ ] **Step 3: Implement.** In `register()`, subscribe via `deps.onSettingsChange` and assign
  `previewTrack.name = label()` on every notification (the `name` setter updates without
  re-registering). One `label()` helper builds the copy for both the initial and later values.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5:** Commit `Keep the Preview track label in step with the duration setting`.

### Task 7: Settings section component

**Files:** Create `src/types/stdlib.d.ts`, `src/ui/settingsSection.tsx`

**Interfaces:**
- Consumes: `parseSeconds`, `formatSeconds` (Task 3); `Settings`, `MIN_DURATION_MS` (Task 4).
- Produces: `registerSettingsSection(ctx: ModuleRuntimeContext, settings: Settings): void` and
  `export type { ModuleRuntimeContext }` (re-exported so `index.ts` needs no stdlib import, S16).

- [ ] **Step 1: Declare stdlib types** in `src/types/stdlib.d.ts` (typing only what is used):
  - `"/modules/stdlib/mod.js"`: `ModuleRuntimeContext { identifier: string; defer(fn: () => void): void }`;
    `createRegistrar(ctx): { register(type: "settingsSection", element: React.ReactElement): void }`.
  - `"/modules/stdlib/lib/primitives.js"`: `SettingsSection({ title?: string; children?: React.ReactNode })`,
    `SettingsToggleRow({ label: string; getValue: () => boolean; onChange(value: boolean): void })`,
    `SettingsTextInputRow({ label: string; description?: string; value: string; placeholder?: string; ariaLabel?: string; onInput(value: string): void })`,
    each returning `React.ReactElement`.
- [ ] **Step 2: Implement `settingsSection.tsx`** (`import React from "react"` for JSX, as
  `previewPanel.tsx` does). A `SecondsRow({ label, get, set, minMs })` component holds the input
  text in `useState(() => formatSeconds(get()))` — `SettingsTextInputRow` is controlled by `value`,
  so without local state a rejected keystroke is reset (S9). `onInput`: `setText(v)`; if
  `parseSeconds(v, minMs)` is non-null, call `set`. Rows: duration (`MIN_DURATION_MS`), gap (0),
  then four `SettingsToggleRow`s keyed `playlist`, `likedSongs`, `album`, `artist` with the labels
  in Global Constraints. `registerSettingsSection` calls `createRegistrar(ctx)` then
  `register("settingsSection", <Section settings={settings} />)`.
- [ ] **Step 3:** `bun run check` → PASS. The component is verified live in Task 11 (S5, S6, S9, S15).
- [ ] **Step 4:** Commit `Add the Spicetify Settings page section`.

### Task 8: `load(ctx)` entry, modal removal (S4, S12, S18)

**Files:** Modify `src/index.ts`, `src/types/spicetify.d.ts`; Delete `src/ui/settingsModal.ts`;
Create `src/index.test.ts`

**Interfaces:**
- Consumes: `waitForClient`, `READY_TIMEOUT_MS` (Task 5); `registerSettingsSection`,
  `ModuleRuntimeContext` (Task 7); `onSettingsChange` dep (Task 6); `realTimer` from `spotify/ports`.
- Produces: `export async function load(ctx: ModuleRuntimeContext): Promise<void>` — the bundle's only export.

- [ ] **Step 1: Write the failing test** `src/index.test.ts`. `vi.mock` `./waitForClient` (rejects
  with `new Error("not ready")`), `./ui/settingsSection`, `./ui/contextMenus` (factory returning
  `{ register: vi.fn() }`), and `./ui/previewPanel` (React is not installed for tests). Mock further
  `./ui/*` modules only if the import fails.
  - S18/S4: `await expect(load({ identifier: "track-playlist-preview", defer: vi.fn() })).rejects.toThrow("not ready")`;
    `registerSettingsSection` and `createContextMenus` were not called.
- [ ] **Step 2:** `bun run test src/index.test.ts` → FAIL (`load` is not exported).
- [ ] **Step 3: Implement.** Rename `main()` to exported `load(ctx)`; replace the `GraphQL/ContextMenu/Menu`
  poll with `await waitForClient({ missing, timer: realTimer, timeoutMs: READY_TIMEOUT_MS })`, where
  `missing` reads `globalThis.Spicetify?.React / ContextMenu / Platform` and returns the absent
  names as `"Spicetify.<Name>"`. Pass `onSettingsChange: (l) => settings.onChange(l)` to
  `createContextMenus`. Replace `registerSettingsMenu(settings)` with
  `registerSettingsSection(ctx, settings)`. Delete `void main()` and `src/ui/settingsModal.ts`.
  Update the header comment (readiness now lives in `load`). Remove the `Menu` and `PopupModal`
  namespaces from `src/types/spicetify.d.ts` if `bun run typecheck` stays green without them.
- [ ] **Step 4:** Re-run the test → PASS. `grep -rnE 'Spicetify\.(Menu|PopupModal)' src/` → no
  matches (S12). `grep -rln '/modules/stdlib/' src/` → only `src/ui/settingsSection.tsx` and
  `src/types/stdlib.d.ts` (declarations, not imports; S16).
- [ ] **Step 5:** Commit `Load through load(ctx) and drop the profile-menu settings modal`.

### Task 9: ES-module build with stdlib dependency (S1, S2 static half)

**Files:** Modify `build.ts`, `package.json`

- [ ] **Step 1: Spike s1.** In a scratch copy of `build.ts`, set `format: "esm"` and
  `external: ["/modules/stdlib/*"]`; `bun run build:local`; confirm
  `grep -o '"/modules/stdlib/[^"]*"' dist/track-playlist-preview/index.js` prints both paths
  verbatim and the file ends with an `export { load }`-style statement. If the pattern is not
  honoured, try the plugin route (`onResolve` for `^/modules/stdlib/` returning `{ path, external: true }`).
  Record the working form in `docs/spicetify-v3-platform.md`.
- [ ] **Step 2: Implement `build.ts`.** `format: "esm"`, the external from Step 1, drop the IIFE
  readiness wrapper, emit the `<style>` injection at module top level ahead of the bundled JS,
  and have `metadata()` write `dependencies: pkg.spicetify?.dependencies ?? {}`. Update the header
  comment's item 3. Add `"spicetify": { "dependencies": { "stdlib": "^1.13.0" } }` to `package.json`.
- [ ] **Step 3: Verify S1 + S2 static.** `bun run build:local`, then
  `jq -c '{dependencies, version}' dist/track-playlist-preview/metadata.json` →
  `{"dependencies":{"stdlib":"^1.13.0"},"version":"0.1.0"}`. In `index.js`: exactly one export,
  `load`; no `while (!Spicetify` loop; stdlib imports only from the two public paths.
- [ ] **Step 4: Spike s2.** `bun run build && spicetify apply`, then over CDP
  (`node scripts/cdp-eval.mjs '<expr>'`): `JSON.stringify(Spicetify.Modules.report)` shows
  `track-playlist-preview` loaded with no failure, and
  `document.querySelectorAll("style#track-playlist-preview").length` is 1. If the module failed
  because `Spicetify.React` was undefined when `index.js` was evaluated (the aliased `react`
  import is read at module top level), change the `spicetify-react` plugin to export a getter-backed
  object that reads `Spicetify.React` / `Spicetify.ReactDOM` on access, rebuild, re-check. Record the
  outcome in `docs/spicetify-v3-platform.md`.
- [ ] **Step 5:** Commit `Build an ES module that declares its stdlib dependency`.

### Task 10: Documentation updates

**Files:** `README.md`, `CLAUDE.md`, `docs/specs/2026-07-22-track-playlist-preview-design.md`,
`docs/specs/2026-07-25-preview-modal-design.md` — one commit per doc.

- [ ] **Step 1: `README.md`** — Settings: profile menu → **Spicetify Settings** →
  **Track & Playlist Preview**; table rows *Preview duration (seconds)* default 15, minimum 1, and
  *Gap between tracks (seconds)* default 0. Under Install: depends on stdlib ≥ 1.13.0, which
  `spicetify apply` installs and keeps current; disabling stdlib stops this module loading.
  Commit `Document the Settings-page location and stdlib dependency`.
- [ ] **Step 2: `CLAUDE.md`** — Build item 3 → "`load()` awaits a capped `waitForClient`
  (`READY_TIMEOUT_MS`); there is no readiness wrapper"; item 4 → `metadata.json` declares stdlib
  from `package.json` `spicetify.dependencies`; add a non-obvious-constraints line: only
  `ui/settingsSection.tsx` imports `/modules/stdlib/`. The spec pointer row already exists; keep
  the index within its size budget. Commit `Update CLAUDE.md for the load(ctx) entry`.
- [ ] **Step 3: `2026-07-22-track-playlist-preview-design.md`** — mark AC42 (line ~318), the
  "Settings: opened from a `Spicetify.Menu.Item`" line (~157) and the `ui/settingsModal` row (~127)
  superseded by S5/S12 of `2026-09-27-settings-page-design.md`. Commit
  `Mark the settings modal superseded in the original spec`.
- [ ] **Step 4: `2026-07-25-preview-modal-design.md`** — annotate the Layering note (lines ~237–238)
  as moot, pointing to the Settings-page spec. Commit `Mark the modal layering note moot`.

### Task 11: Live verification over CDP (S2, S5, S6, S9, S12, S13, S14, S15)

Run after `bun run build && spicetify apply`. Every probe restores what it changes, in a `finally`.

- [ ] **Step 1: S2** — `Spicetify.Modules.report.loaded` lists `stdlib` before
  `track-playlist-preview`; `failed` has no entry for it.
- [ ] **Step 2: S5/S6** — Save the raw `Spicetify.LocalStorage.get("track-playlist-preview:settings")`.
  Set it to `{"durationMs":15000,"gapMs":500,"enabled":{"playlist":true,"likedSongs":true,"album":false,"artist":true}}`,
  `location.reload()`, push `/bespoke/settings` via `Spicetify.Platform.History.push`. Assert the
  section heading, the six row labels in order, input values `15` and `0.5`, and Albums off.
- [ ] **Step 3: S9** — Type into the duration input with the native value setter plus a bubbling
  `input` event: `"abc"` → input shows `abc`, stored duration unchanged; `"12"` → stored 12000,
  input shows `12`. Navigate away and back → input shows `12`. Repeat for gap with `"-1"` / `"0.25"`.
  Restore the saved value and reload.
- [ ] **Step 4: S12/S13** — Open the profile menu and assert no *Track & Playlist Preview* item.
  Set the duration to 10 on the page, dispatch `contextmenu` on a track row, assert
  *Preview track (10s)*; set 10.5 → *(11s)*. If a synthetic event does not open the menu, ask the
  user to right-click and report the label.
- [ ] **Step 5: S14** — With the pre-change stored value, confirm it loads unchanged, then re-run
  AC29/AC30/AC35 (toggle Albums off on the page → no action-bar button and no collection menu item
  on an album; back on → both present), AC44 (empty storage → defaults), AC45 (change the duration
  mid-session → applies from the next track). AC43: restart via `spicetify apply` and re-read.
- [ ] **Step 6: S15** — `await Spicetify.Modules.disable("track-playlist-preview")`; the settings
  page no longer shows the section. Re-enable (or `spicetify apply`) afterwards; other UI staying
  mounted is expected (#8).
- [ ] **Step 7:** Record any newly verified platform fact in `docs/spicetify-v3-platform.md`; commit
  if changed.

### Task 12: Post-implementation check

- [ ] **Step 1:** Read `git diff main...HEAD` and confirm: `build.ts` and `package.json` updated;
  all four docs in Task 10 changed; #8/#9 bodies verified; `src/ui/settingsModal.ts` gone; S16 grep
  holds. No glossary or ADR tasks apply (spec: none). Fix anything missing.

### Task 13: Final build

- [ ] **Step 1:** `bun run check && bun run build` → both succeed. Fix and re-run until they do.
