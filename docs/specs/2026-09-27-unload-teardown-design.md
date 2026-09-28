# Unload Teardown — Design Spec

**Date:** 2026-09-27
**Status:** Approved design — spec pending review
**Issue:** #8 — Remove everything the module mounted when it is unloaded
**Builds on:** [`2026-09-27-settings-page-design.md`](2026-09-27-settings-page-design.md) (introduced
the `load(ctx)` entry and deferred full teardown to #8 in Q6/S15) and
[`2026-09-27-panel-position-design.md`](2026-09-27-panel-position-design.md) (added the panel's
`settings.onChange` subscription whose unsubscribe #8 must call). Also touches the shipped module
([`2026-07-22-track-playlist-preview-design.md`](2026-07-22-track-playlist-preview-design.md)),
the preview panel ([`2026-07-25-preview-modal-design.md`](2026-07-25-preview-modal-design.md)) and
Remove ([`2026-09-26-remove-from-playlist-design.md`](2026-09-26-remove-from-playlist-design.md)).
Criteria here are numbered **U1…** so they cannot collide with AC1–AC70, R1–R16, S1–S18 or P1–P20.

---

## Problem

Since the Settings-page change, the bundle is a v3 module that exports `load(ctx)`, so it can be
switched off at runtime: `Spicetify.Modules.disable("track-playlist-preview")`, or the `manager`
module's disable and Reload buttons. On unload the stdlib registrar removes the settings section,
and nothing else. The action-bar button and its body-wide `MutationObserver`, the three context-menu
items, the preview panel's React root, the pending-removals stack, the settings subscriptions, the
injected `<style>`, and any running preview session all stay live. `src/index.ts` works around this
by wiring once and never again (`wired ??= wire()`).

First-party guidance treats this as a bug. `spicetify/modules` → `docs/module-standard.md`,
"Dispose what you touch": "Every register, adopted stylesheet, event listener, and timer is undone
on unload. `createRegistrar(ctx)` auto-disposes what you register; you clear the timers, overlays,
and subscriptions you own. A module that leaks or lingers after a reload is a bug." Its Testing
section asks to "exercise enable, use, disable, and re-enable. Check that removed UI stays removed
after Spotify changes its DOM, listeners don't run twice".

## Terms

Spec-local (no `CONTEXT.md` glossary exists). Extends the Terms of the prior specs.

| Term | Meaning |
| --- | --- |
| **Unload** | The loader running a module's disposers: `Spicetify.Modules.disable(id)`, `Modules.unload(id)`, or `reload(id)` (unload then enable). Quitting or restarting Spotify is **not** an unload. |
| **Wiring** | The set of live objects one `load()` builds: settings store, engine, controller, coordinator, audio element, pending removals, panel, action-bar button, context-menu items. |
| **Dispose** | Undo everything one wiring mounted, subscribed or scheduled. The wiring's `dispose()` is registered with `ctx.defer`. |
| **Flush** | Commit every pending removal immediately instead of when its Undo window ends. |

_Avoid:_ "reset" or "cleanup" for dispose (they suggest a partial undo); "reload" for a plain
disable.

## Investigation Findings

Verified 2026-09-27 against CLI 3.0.0-beta.19 (installed `/opt/spotify/Apps/xpui/hooks/modularLoader.js`,
matching `spicetify/cli` branch `v3-beta` `src/jsHelper/modularLoader/{index,registry,types}.ts`,
commit b50800b), stdlib 1.13.0, manager 1.4.0, Spotify 1.2.96.518, by source reading and CDP probes.

- **Disposers.** Each module has one disposer list, run by `unload()` in **reverse order** of
  registration. Each disposer is awaited inside its own `try/catch`; a failure is logged
  ("error unloading …") and the rest still run. Registration order: preload `ctx.defer`s, preload's
  return value, the `entries.css` disposer, the `color.ini` disposer, load `ctx.defer`s, load's
  return value (`registry.ts` l.294-318, l.398-417, l.470-489).
- **Enable does not re-import.** `jsIndexOf` caches the imported module namespace; `enable()` runs
  `preload`/`load` again on the cached object. Top-level code runs once per page, so module-scope
  state and top-level DOM side effects survive disable→enable. `reload(id)` is unload + enable on
  the same cached code (the manager's Reload button calls it). Only `Modules.installLocal` re-imports
  new code; an on-disk module like ours picks up new code only after `spicetify apply` and a restart.
- **Partial load leaks.** If `load()` throws, disposers it already registered are never run:
  `enable`/`runLoads` leave `loaded=false`, and `unload()` returns early on `!state.loaded`.
- **`entries.css`.** `metadata.json` `entries: { js?, css? }`; both may be set (stdlib's own metadata
  declares both). The loader fetches `/modules/<id>/<css>`, builds a constructable `CSSStyleSheet`
  (plain text fallback when it contains `@import`), pushes it onto `document.adoptedStyleSheets`
  between preload and load, and registers a disposer that removes it. Re-adopted on every enable.
  A module with CSS also triggers a fetch of `/modules/<id>/color.ini`; a 404 is harmless.
- **Context-menu items.** `Spicetify.ContextMenu.Item` is defined by the CLI's spicetifyWrapper
  (`menus.js`), not stdlib. `deregister()` is `Spicetify.ContextMenuV2.unregisterItem(this._element)`
  (probe), which deletes from a private `registeredItems` map. Items render from that map on each
  menu render, so a deregistered item is gone from the next menu opened; a menu already open is not
  re-rendered and keeps showing it. The map itself is not reachable from outside;
  `Spicetify.ContextMenuV2` exposes `registerItem` and `unregisterItem`, which `Item` looks up on the
  global at call time (probe).
- **`Spicetify.Platform.History.listen`** returns an unlisten function (probe; history v4
  `appendListener`).
- **stdlib registrar** has no context-menu register with URI access: its `menu` type receives
  `props: null` in the live client (no source transform applied), so `ContextMenu.Item` stays.
- **`ctx`** is `{ spotifyVersion, identifier, defer }`; `defer` accepts a function returning
  `void | Promise<void>`. `src/types/stdlib.d.ts` omits `spotifyVersion` and types `defer` as sync.

## Decisions

| # | Decision |
| --- | --- |
| Q1 | Pending removals inside their Undo window are **flushed** (committed immediately) on unload, not cancelled. Removals lost when Spotify quits are out of scope (#10). |
| Q2 | Proof is unit tests **plus** a committed CDP script, `scripts/check-unload.mjs`. |
| Q3 | CSS moves to **`entries.css`**; the loader adopts and removes it. No `<style>` injection. |
| Q4 | **Rebuild per load**: each `load()` builds a fresh wiring; unload disposes all of it. The `wired` guard goes away. |
| Q5 | The CDP script runs a **live preview session** before disabling (Liked Songs, **Preview all**); `--no-session` skips it. |
| D1 | `wire()` disposes what it already built if a later step throws, then re-throws (covers the partial-load leak). |
| D2 | After dispose, the old wiring's controller entry points are no-ops (covers a context menu left open across the disable). |
| D3 | Notices are not special-cased on unload: the session's "Skipped N tracks" summary and any "Couldn't remove…" failure from a flushed removal still show. |

## Design

### Lifecycle (`src/index.ts`)

```ts
export async function load(ctx) {
  await waitForClient(...);              // unchanged; rejects before anything is built (S18)
  const { settings, dispose } = wire();  // throws → already disposed (D1)
  ctx.defer(dispose);
  registerSettingsSection(ctx, settings);
}
```

- `wire()` returns `{ settings, dispose }`. It records a teardown step as it mounts each piece. If a
  step throws, it runs the recorded steps in reverse and re-throws the original error.
- `dispose()` runs the teardown steps in the order below, each in its own `try/catch`, then throws
  the first error caught (if any) so the loader logs it. A second call does nothing.
- The registrar is created after `ctx.defer(dispose)`, so on unload (reverse order) the settings
  section goes first, then the wiring, then the loader's stylesheet removal.

### Teardown steps, in order

1. **Controller** — new `dispose()`: calls `stop()` (bumps `startSeq`, so an in-flight start
   bails; `engine.stop()` emits `sessionEnded("stopped")`, which closes the panel, clears the row
   highlight, and calls `coordinator.release()` — playback resumes only if the coordinator paused
   it). Then sets a disposed flag that makes `startCollection`, `startTrack`, `startFromHere`,
   `toggleCollection`, `next` and `removeCurrent` return without effect. Every UI entry point
   (menu items, action-bar click, panel buttons and keys) reaches the engine only through these.
2. **Pending removals** — new `flush()`: each entry still `pending` has its timer cleared and is
   committed through the existing `commit()` path (issued, `remove()` called, `onError` on
   rejection, no retry). Entries in any other state are untouched. After `flush()`, `undo()` returns
   `false` for flushed handles and `list()` no longer includes them.
3. **Context menus** — new `dispose()`: `deregister()` on all three items; call the unsubscribe
   returned by the S13 relabel `onSettingsChange`.
4. **Action-bar button** — new `stop()`: call the unlisten returned by `History.listen`, disconnect
   the `MutationObserver`, `cancelAnimationFrame` a queued `inject()`, remove `#tpp-action-bar-button`.
   `start()` after `stop()` works again.
5. **Preview panel** — new `dispose()` on the value `createPreviewPanel` returns: call the
   unsubscribe from `deps.onSettingsChange(place)`, `root.unmount()`, remove `#tpp-preview-root`.
6. **Row highlight** — `rowHighlight.clear()` (already run by step 1's session end; repeated as a
   safety net for a highlight left by an idle wiring). Disconnects its observer.

The `<Audio>` element needs no step: step 1 stops it (`pause`, `src` removed), it is not in the DOM,
and nothing references it once the wiring is dropped.

### CSS (`build.ts`)

- Drop the `styleInjection` prefix. When the bundle produced CSS, write it to `<outDir>/index.css`
  and add `css: "index.css"` to `metadata.json` `entries`. Applies to `build`, `build:local` and
  `watch`.
- The loader adopts the sheet before each `load()` and removes it on unload.

### Types (`src/types/stdlib.d.ts`)

`ModuleRuntimeContext` gains `spotifyVersion: string`; `defer(fn: () => void | Promise<void>): void`.

### CDP check (`scripts/check-unload.mjs`)

Node script over the same CDP connection as `scripts/cdp-eval.mjs` (`CDP_PORT`, default 8088).
Steps:

1. Record the starting pathname and `Spicetify.Player.isPlaying()`. Wrap
   `HTMLMediaElement.prototype.play` to capture the element that plays a preview clip, and wrap
   `Spicetify.ContextMenuV2.registerItem` / `unregisterItem` to count calls.
2. *(session; skipped by `--no-session`)* Navigate to `/collection/tracks`, click
   `#tpp-action-bar-button` (**Preview all**), and wait (bounded) until the captured clip element is
   playing.
3. `Spicetify.Modules.disable("track-playlist-preview")`, then check:
   - `#tpp-preview-root`, `#tpp-action-bar-button` and `.tpp-previewing-row` are absent;
   - no `document.adoptedStyleSheets` entry and no `<style>` has a rule mentioning `.tpp-panel`;
   - `unregisterItem` was called 3 times;
   - after navigating to another collection page and waiting two animation frames, no button
     appears;
   - *(session)* the clip element is paused with no `src`, and within a bounded wait
     `isPlaying()` equals the value recorded in step 1.
4. `Spicetify.Modules.enable("track-playlist-preview")`, then check: `registerItem` was called 3
   times; on a collection page exactly one `#tpp-action-bar-button` exists; exactly one adopted
   stylesheet mentions `.tpp-panel`.
5. `finally`: if the module is disabled, enable it; restore the wrapped functions; navigate back to
   the starting pathname.
6. Print one `PASS`/`FAIL` line per check; exit 1 if any check failed or the run threw.

The script never schedules a playlist removal (it would edit a real playlist); flush on unload is
covered by unit tests only. It requires Spotify running with CDP enabled and, without
`--no-session`, a Liked Songs list containing at least one track with a preview clip. It interrupts
playback for a few seconds.

## Acceptance Criteria

"Unload" below means running every function `load(ctx)` passed to `ctx.defer`, in reverse order of
registration (as the loader does); in the live client, `Spicetify.Modules.disable("track-playlist-preview")`.

**Session and playback**

- **U1** — Given an active session that started while Spotify was playing, when the module unloads,
  then the preview clip stops (the audio element is paused and has no `src`), the player port's
  `resume` is called exactly once, and the preview panel is no longer rendered.
- **U2** — Given an active session that started while Spotify was paused, when the module unloads,
  then the player port's `resume` is not called.
- **U3** — Given `startCollection`, `startTrack` or `startFromHere` is awaiting its enumeration or
  track lookup when the module unloads, when that await settles, then no session begins: the player
  port's `pause` is not called, the engine is not started, and the panel is not opened.
- **U4** — After unload, calling the old wiring's `startCollection`, `startTrack`, `startFromHere`,
  `toggleCollection`, `next` or `removeCurrent` does not call the player port, start the engine,
  open the panel, or schedule a removal.
- **U5** — After unload, no element has the class `tpp-previewing-row`, and adding a track row
  matching the last previewed track to the DOM does not give it that class.

**Pending removals**

- **U6** — Given N ≥ 1 removals in the pending state, when the module unloads, then the remove port
  is called once per removal (with its playlist and track URI) before any timer advances, and
  advancing the timer past `UNDO_WINDOW_MS` afterwards causes no further remove call.
- **U7** — After a flush, `undo(handle)` returns `false` for every flushed handle, and `list()`
  returns an empty array.
- **U8** — Given a flushed removal whose remove call rejects, the error notice with
  `removalFailedMessage(trackTitle, playlistName)` is shown exactly once.
- **U9** — Given removals that are undone, in flight, succeeded or failed, `flush()` makes no remove
  call for them.

**Action-bar button**

- **U10** — After unload, `#tpp-action-bar-button` is absent, and the function returned by
  `History.listen` has been called.
- **U11** — After unload, when the DOM mutates or `History` notifies a navigation to an enabled
  collection page, then after the next animation frame `#tpp-action-bar-button` is still absent.
- **U12** — Given an `inject()` queued for the next animation frame when the module unloads, when
  that frame runs, then `#tpp-action-bar-button` is still absent.
- **U13** — Given `stop()` then `start()` on the action-bar button, on an enabled collection page
  exactly one `#tpp-action-bar-button` exists.

**Context menus**

- **U14** — After unload, `deregister()` has been called exactly once on each of the three items
  (*Preview this collection*, *Preview track (Ns)*, *Preview from here*).
- **U15** — After unload, a settings change does not change the *Preview track* item's `name`.

**Preview panel and stack**

- **U16** — After unload, `#tpp-preview-root` is absent from the document and its React root has
  been unmounted.
- **U17** — After unload, a settings change (including **Panel position**) makes no placement
  measurement: the Playbar (`.Root__now-playing-bar`) and global nav (`.Root__globalNav`) are not
  queried, and no placement style is written.

**Stylesheet**

- **U18** — `bun run build:local` writes `dist/track-playlist-preview/index.css` containing the rules
  of every CSS file imported under `src/` (`.tpp-panel`, `.tpp-previewing-row`), `metadata.json`
  declares `entries` `{ "js": "index.js", "css": "index.css" }`, and `index.js` creates no `<style>`
  element.
- **U19** — Live: after disable, no adopted stylesheet and no `<style>` element contains a rule
  mentioning `.tpp-panel`; after enable, exactly one adopted stylesheet does.

**Lifecycle**

- **U20** — After the first wiring is unloaded, a second `load(ctx)` builds a new wiring: the
  context-menu, action-bar and panel factories each run once more, three context-menu items are
  registered (not six), and on an enabled collection page exactly one `#tpp-action-bar-button`
  exists.
- **U21** — Settings values stored before an unload are the values the next `load()`'s wiring reads.
- **U22** — Given a step of `wire()` throws, every piece built before it has been disposed (its
  teardown step ran), `load()` rejects with that error, and no function was passed to `ctx.defer`.
- **U23** — Given one teardown step throws, every later step still runs, and `dispose()` then throws
  that error.
- **U24** — Calling `dispose()` a second time makes no player, remove, deregister, unmount or DOM
  call and does not throw.
- **U25** — S15 and S18 still hold.

**Verification script and code**

- **U26** — `node scripts/check-unload.mjs`, run against a live client with CDP on `CDP_PORT` and a
  Liked Songs track with a preview clip, prints one `PASS` line per check in its step 3 and step 4
  and exits 0; `--no-session` omits the session checks. If any check fails, the script prints
  `FAIL` for that check and exits 1.
- **U27** — After any run of `check-unload.mjs` (pass, fail, or thrown error), the module is enabled
  (`Spicetify.Modules.report` lists it as loaded), `HTMLMediaElement.prototype.play`,
  `ContextMenuV2.registerItem` and `ContextMenuV2.unregisterItem` are the original functions, and
  the pathname equals the one at start.
- **U28** — `grep -rn "#8" src/` returns nothing, and `src/index.ts` has no module-level wiring
  guard.

## Deferred Items

- #10 — Commit or document pending removals lost when Spotify quits mid-Undo window

## Glossary Updates & ADRs

None to a glossary file — no `CONTEXT.md` exists; terms are spec-local (see **Terms**). No ADR:
teardown follows the platform's documented contract and is easy to reverse, so it fails the "hard to
reverse" and "surprising" criteria. Moving CSS to `entries.css` is also the platform default. No
conflict with ADR 0001.

## Config & Infrastructure Impact

| File | Change |
| --- | --- |
| `build.ts` | Remove `<style>` injection; write `index.css` when CSS exists; add `css` to `metadata.json` `entries`. Update the header comment (item 2). |
| `metadata.json` (generated) | Gains `entries.css`. Not committed; produced by the build. |
| `scripts/check-unload.mjs` | New CDP check script (see Design). |
| `src/types/stdlib.d.ts` | `ModuleRuntimeContext` gains `spotifyVersion`; `defer` accepts async functions. |
| `package.json` | None — the script runs with `node` like `cdp-eval.mjs`; no new dependency. |
| `tsconfig.json` | None — `scripts/*.mjs` is outside `include`, as `cdp-eval.mjs` is today. |
| CI | None — no `.github/` directory. |
| Env / secrets | None. `CDP_PORT` already exists (optional, default 8088). |
| `~/.config/spicetify/config-xpui.ini` | None to commit. Running the CDP script needs `spotify_launch_flags = --remote-debugging-port=8088`, which `CLAUDE.md`'s "Starting a feature" already has the agent set. |

## Manual Operator Steps

None. The agent builds, runs `spicetify apply` and runs the CDP script itself. Running the script
without `--no-session` interrupts Spotify playback for a few seconds, so the agent tells the user
before running it.

## Documentation Updates

| Doc | Change |
| --- | --- |
| `docs/spicetify-v3-platform.md` | New section "Unload, enable and reload": disposer order and error isolation, enable not re-importing, the partial-load leak, `entries.css` adopt/remove and the `color.ini` fetch, `ContextMenu.Item.deregister` behaviour (open menu keeps the item), `History.listen` unlisten, `ctx` fields. Cite sources as in Investigation Findings. |
| `CLAUDE.md` | Build item 2: CSS is written to `index.css` and declared as `entries.css`, adopted and removed by the loader. Add a Documentation pointer row to this spec. Add `node scripts/check-unload.mjs` under "Debugging against the live client". Add a one-line constraint: everything `wire()` mounts must have a teardown step. |
| `README.md` | Build paragraph: replace "inlines any imported CSS into the output bundle, wraps everything so the module waits…" with the `index.css`/`entries.css` output and the `load(ctx)` readiness wait. Debugging section: mention `scripts/check-unload.mjs` and that it interrupts playback. |
| `docs/specs/2026-09-27-settings-page-design.md` | Annotate Q6 and the **Unload** paragraph ("Everything else stays mounted until #8") as superseded by this spec. |
| `docs/specs/2026-09-27-panel-position-design.md` | Annotate l.151 ("left for #8 to call on unload") and the #8 note in Deferred Items as addressed by this spec (U17). |
| `docs/specs/2026-09-26-remove-from-playlist-design.md` | Note under the Undo-window criteria that unload flushes pending removals (U6–U9) and that quitting Spotify still drops them (#10). |

## Implementation Plan Guidance

Spikes to run before the task that depends on them:

- (s1) Over CDP, confirm `root.unmount()` on a throwaway `Spicetify.ReactDOM.createRoot` root
  removes its rendered children, and that a second `createRoot` on a fresh host after unmount
  renders. Remove the host in a `finally`.
- (s2) After the `build.ts` change, `spicetify apply`, then confirm over CDP that
  `document.adoptedStyleSheets` holds one sheet mentioning `.tpp-panel` and that
  `Spicetify.Modules.report.failed` is empty.

Required Task 2 (glossary) and Task 3 (ADRs) do not apply: no `CONTEXT.md`, no ADRs listed.
Required Task 6 does not apply: no Manual Operator Steps.

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
> After the final build passes — and before wrapping up via `superpowers:finishing-a-development-branch` — if a cross-model review helper is available (e.g. the Codex plugin's adversarial review), run it with focus: *"Judge correctness against the spec's acceptance criteria (U1–U28) only. Do not flag anything outside the stated criteria — no design alternatives, hardening, or scope the spec did not claim."*
>
> This **never gates a merge** — the gate stays `bun run check` plus `bun run build`; the review only flags what deserves a second look. If no helper is available, finish the branch without it.
