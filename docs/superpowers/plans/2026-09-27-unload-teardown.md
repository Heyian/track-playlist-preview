# Unload Teardown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the module unloads (`Spicetify.Modules.disable`, `unload` or `reload`), remove
everything it mounted, subscribed or scheduled. The next `load()` then builds a fresh wiring.

**Architecture:** `load(ctx)` builds one wiring per call. `wire()` returns `{ settings, dispose }`
and registers `dispose` with `ctx.defer` before the settings section is registered. Each adapter
gets its own teardown: `controller.dispose`, `pendingRemovals.flush`, `contextMenus.dispose`,
`actionBar.stop`, `panel.dispose` and `rowHighlight.clear`. A small pure helper,
`createDisposer`, runs the steps with error isolation and a once-guard. CSS moves out of the JS
bundle into `index.css`, declared as `entries.css`, so the loader adopts it and removes it.

**Tech Stack:** TypeScript (strict), Bun bundler (`build.ts`), Vitest (+ happy-dom per file),
React via `Spicetify.React` (not installed in `node_modules`, so `.tsx` files that import React
cannot be loaded in vitest), Spicetify CLI 3.0.0-beta.19, stdlib 1.13.0, Spotify 1.2.96.518.

**Spec:** `docs/specs/2026-09-27-unload-teardown-design.md` (criteria U1–U31). Read it first,
especially **Teardown steps, in order** and **CDP check**. It builds on
`docs/specs/2026-09-27-settings-page-design.md` (S15, S18) and
`docs/specs/2026-09-27-panel-position-design.md`.

## Global Constraints

- Quality gate: `bun run check` (typecheck + vitest). No linter. `bun run build` does not typecheck.
- Teardown order in `dispose()`: controller → pending removals (flush) → context menus → action-bar
  button → preview panel → row highlight. Rollback in `wire()` runs whatever was built, in reverse
  mount order, then re-throws the original error.
- `dispose()` runs every step in its own `try/catch`, throws the first error after all steps have
  run, and does nothing on a second call.
- Flush commits through the existing `commit()` path: no retry, `onError` on rejection.
- `Spicetify.ContextMenu.Item` stays. Do not switch to the stdlib registrar's `menu` type.
- Only `playerCoordinator` calls `Spicetify.Player`. Only `src/ui/settingsSection.tsx` imports a
  `/modules/stdlib/` path, type imports included. No `e-[0-9]` class literal in `src/`.
- Commits: capitalized imperative subject, no `feat:` prefix, no AI-attribution line.
- Before every commit, a verification subagent runs `bun run check` from the repo root and reports
  `STATUS: PASS` / `STATUS: FAIL` with a terse per-issue list. Commit only on PASS. Never
  `--no-verify`.
- CDP: `node scripts/cdp-eval.mjs '<expr>'` and `node scripts/check-unload.mjs`, with the Bash
  sandbox **disabled** (a fetch to `127.0.0.1:8088` fails inside it). A probe that registers UI
  removes it in a `finally`. Before any run that starts a session, tell the user that playback
  will be interrupted for a few seconds.

## Review Focus

1. **Unload during the gap between tracks.** Given a clip has completed and the gap timer is
   pending, when the module unloads and the timer fires, `audio.play` is not called again. → Task 5.
2. **Unload while a clip URL is resolving.** Given `resolve` has not settled when the module
   unloads, when it resolves, `audio.play` is not called, and `resume` was still called once
   (if Spotify was playing). → Task 5.
3. **Rollback after a partial mount.** If `register()` throws on the second menu item, `dispose()`
   deregisters the first one. `actionBar.stop()` before `start()` does not throw. → Tasks 6 and 7.
4. **Two full disable → enable cycles.** After load → unload → load → unload → load, there is
   exactly one live wiring: three items registered by the last `register()`, and every earlier
   wiring's `dispose` has run exactly once. → Task 10.
5. **The manager's Reload button.** `Spicetify.Modules.reload("track-playlist-preview")` leaves
   exactly one `#tpp-action-bar-button` on a collection page and one adopted stylesheet mentioning
   `.tpp-panel`. → Task 12.

---

### Task 1: Isolated workspace and spec carry-over

**Files:** none in `src/`.

- [ ] **Step 1:** Create an isolated workspace via `superpowers:using-git-worktrees` (branch
  `unload-teardown`).
- [ ] **Step 2:** The critique-folded spec and this plan are uncommitted in the main worktree. Copy
  `docs/specs/2026-09-27-unload-teardown-design.md` and
  `docs/superpowers/plans/2026-09-27-unload-teardown.md` into the new worktree. Then in the main
  worktree run `git checkout -- docs/specs/2026-09-27-unload-teardown-design.md` and delete the
  plan copy.
- [ ] **Step 3:** Commit in the worktree: `Fold the spec critique into the unload-teardown criteria and add its plan`.
- [ ] **Step 4:** Deferred-item check: `gh issue view 10 --json body -q .body | grep '^## '` lists
  `Context`, `Required`, `Integration Points`, `Priority`.
- [ ] **Step 5:** `curl -s 127.0.0.1:8088/json/version` (sandbox disabled) returns JSON with a
  `Browser` field. If it does not, set `spotify_launch_flags = --remote-debugging-port=8088` under
  `[Setting]` in `~/.config/spicetify/config-xpui.ini`, run `spicetify apply`, and retry.

### Task 2: `scripts/check-unload.mjs` (U26, U27), first run in red

**Files:**
- Create: `scripts/check-unload.mjs`

**Interfaces:**
- Produces: `node scripts/check-unload.mjs [--no-session]`. Env `CDP_PORT` (default `8088`). One
  `PASS <name>` / `FAIL <name>` line per check. Exit 0 only when every check passed. Exit 1 on any
  failure or thrown error.

- [ ] **Step 1: Write the script**, following the spec's **CDP check** steps 1–6 exactly. Reuse
  `cdp-eval.mjs`'s page-target lookup (skip `devtools://` targets). Open one WebSocket, and use an
  `evaluate(expr)` with incrementing message ids that wraps `expr` in `(async () => (…))()`
  (`awaitPromise`, `returnByValue`). Keep the in-page state on `window.__tppCheck`: the original
  `HTMLMediaElement.prototype.play`, `ContextMenuV2.registerItem` and `unregisterItem`, the
  captured clip element, and the call counts. Navigate with `Spicetify.Platform.History.push(path)`.
  Bounded waits poll every 100 ms: 10 s for the clip to play, 5 s for `isPlaying()` to match and
  5 s for the button to appear after enable. "Two animation frames" means
  `await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))` in the page.
  For step 3's "another collection page", push `/search`, then `/collection/tracks`. Checks:
  - After disable: `panel root absent`, `button absent`, `no previewing row`, `stylesheet removed`
    (no adopted sheet and no `<style>` whose rules or text contain `.tpp-panel`),
    `unregisterItem ×3`, `no button after navigation`, and with a session also `clip stopped`
    (`paused && !hasAttribute("src")`) and `playback restored`.
  - After enable: `registerItem ×3`, `one button`, `one stylesheet`.
  - `finally`: if `Spicetify.Modules.report` does not list the module as loaded, call
    `Spicetify.Modules.enable(id)`. Restore the three functions and push the starting pathname.
- [ ] **Step 2: Capture the U27 baseline.** Run `node scripts/cdp-eval.mjs` with an expression that
  sets `window.__tppOrig = { play: HTMLMediaElement.prototype.play, reg: Spicetify.ContextMenuV2.registerItem, unreg: Spicetify.ContextMenuV2.unregisterItem, path: Spicetify.Platform.History.location.pathname }`
  and returns `path`.
- [ ] **Step 3: Red run against the current (pre-teardown) install.** Tell the user playback will
  be interrupted, then run `node scripts/check-unload.mjs`. Expected: exit 1, with `FAIL` at least
  for `button absent`, `unregisterItem ×3` and `stylesheet removed`. This proves the checks can
  fail.
- [ ] **Step 4: U27 after the red run.** Run `node scripts/cdp-eval.mjs` with an expression that
  returns `{ loaded, play, reg, unreg, path }`. `loaded` is the module's loaded state from
  `Spicetify.Modules.report`. `play`, `reg` and `unreg` are identity comparisons (`===`) of the
  current functions against `window.__tppOrig`. `path` compares the current pathname with
  `__tppOrig.path`. Expected: all five true. Then `delete window.__tppOrig`.
- [ ] **Step 5: Thrown-error exit.** `CDP_PORT=1 node scripts/check-unload.mjs; echo $status`
  prints `1`.
- [ ] **Step 6:** Pre-commit verification, then commit: `Add the CDP unload check script`.

### Task 3: `createDisposer` (U23, U24)

**Files:**
- Create: `src/teardown.ts`
- Test: `src/teardown.test.ts`

**Interfaces:**
- Produces: `export function createDisposer(steps: readonly (() => void)[]): () => void`.

- [ ] **Step 1: Write the failing tests:**
  - `"U23: a throwing step does not stop later steps; the first error is thrown"`: steps `s1`
    (throws `e1`), `s2`, `s3` (throws `e3`), `s4`. Calling the disposer throws `e1`, and all four
    were called once, in order.
  - `"U24: a second call runs nothing and does not throw"`: after the first call (with a throwing
    step, caught), the second call returns normally and no step's call count changes.
  - `"no step throws → returns normally"`.
- [ ] **Step 2:** `bun run test src/teardown.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `createDisposer` in `src/teardown.ts`. It captures the step list and
  keeps a `done` flag.
- [ ] **Step 4:** `bun run test src/teardown.test.ts` → PASS.
- [ ] **Step 5:** Pre-commit verification, then commit: `Add a disposer that isolates teardown errors`.

### Task 4: `pendingRemovals.flush()` (U6–U9)

**Files:**
- Modify: `src/pendingRemovals.ts`
- Test: `src/pendingRemovals.test.ts`

**Interfaces:**
- Produces: `flush(): void` on `PendingRemovals`.

- [ ] **Step 1: Write the failing tests** in `describe("flush (U6–U9)")`, using the file's `setup`,
  `tick` and `a`, plus a second track `b`:
  - `"U6: every pending removal is committed now; the timer adds nothing"`: schedule `a` and `b` on
    `P` → `flush()` → `await tick()` → `remove` has calls `[P, a.uri]` and `[P, b.uri]` without any
    `timer.fire`, and `timer.ids()` is `[]`. Firing any previously returned id adds no call.
  - `"U7: flushed handles cannot be undone and are not listed"`: `undo(h)` is `false` for both,
    and `list()` is `[]`.
  - `"U8: a flushed removal whose remove rejects reports once"`: `setup(async () => { throw new Error() })`
    → schedule → `flush()` → `await tick()` → `onError` called once with `("Title", <playlistName>)`.
  - `"U9: undone, in-flight, succeeded and failed removals are left alone"`. Build one of each:
    undo one; fire one whose `remove` never settles; fire one that resolves; fire one that rejects.
    The `remove` impl switches per track URI. Record the `remove` call count, `flush()`,
    `await tick()`: the count is unchanged.
- [ ] **Step 2:** `bun run test src/pendingRemovals.test.ts` → the new tests FAIL (`flush is not a function`).
- [ ] **Step 3:** Implement `flush()`. For each entry with status `pending`, clear its timer, then
  call `commit(entry)`.
- [ ] **Step 4:** `bun run test src/pendingRemovals.test.ts` → PASS.
- [ ] **Step 5:** Pre-commit verification, then commit: `Flush pending removals on demand`.

### Task 5: `controller.dispose()` (U1–U4, U29)

**Files:**
- Modify: `src/previewController.ts`
- Test: `src/previewController.test.ts` (U3, U4)
- Create test: `src/previewController.unload.test.ts` (U1, U2, U29, Review Focus 1–2)

**Interfaces:**
- Produces: `dispose(): void` on `PreviewController`. It calls `stop()`, then sets a `disposed`
  flag. With the flag set, `startCollection`, `startTrack`, `startFromHere`, `toggleCollection`,
  `next` and `removeCurrent` return without effect (the async ones resolve `undefined`).

- [ ] **Step 1: Write the failing tests in `previewController.test.ts`** (fake engine, existing
  `setup`). Use a deferred promise helper (`let resolve; const p = new Promise(r => resolve = r)`):
  - `"U3: unload during any start stage begins no session"`: `it.each` over four stages, each made
    pending by a deferred: `enumerate` (startCollection), `fetchTrackRef` (startTrack),
    `collectionLabel` (startCollection on `P`), `playlistMetadata` (startCollection on `P`). For
    each: start, `dispose()`, resolve the deferred, `await` the start → `coordinator.acquire`,
    `engine.start` and `panel.open` were not called.
  - `"U4: after dispose, every entry point is inert"`: start a session on `P` and await it, clear
    the mocks, `dispose()`, clear the mocks again. Then call `startCollection(P)`, `startTrack(a.uri)`,
    `startFromHere(a.uri, P)`, `toggleCollection(ALBUM)`, `next()` and `removeCurrent()`, awaiting
    the async ones. `coordinator.acquire`, `engine.start`, `engine.skip`, `panel.open` and
    `pendingRemovals.schedule` were not called. (The fake engine stays "active" after `stop`, so
    this test pins the `disposed` guard, not the engine state.)
- [ ] **Step 2: Write the failing tests in `previewController.unload.test.ts`.** Compose the real
  `createPreviewEngine`, `createPlayerCoordinator` and `createPreviewController`. Use
  `fakeTimer()`, a fake audio port (like `previewEngine.test.ts`'s `fakeAudio`), a fake player
  `{ isPlaying: vi.fn(() => playing), pause: vi.fn(), resume: vi.fn() }`, and controller deps
  shaped like `previewController.test.ts`'s `setup` (fakes for panel, notify, highlight,
  pendingRemovals, enumerate → `[a, b, c]`). Config: duration 15000, gap as the test sets it.
  - `"U1: unload while Spotify was playing resumes once and stops the clip"`: playing `true`,
    start on `ALBUM`, flush microtasks until `audio.play` has been called, `dispose()` →
    `audio.stop` called, `player.resume` called once, `panel.close` called.
  - `"U1: a replacement session keeps the first acquire's decision"`: playing `true`, start on
    `ALBUM`, then set playing `false` (as Spotify now reports it, since we paused it) and start
    on `P`. `dispose()` → `player.pause` once, `player.resume` once.
  - `"U2: unload when Spotify was already paused does not resume"`: playing `false`, start, dispose
    → `player.resume` not called.
  - `"U29: the skipped summary still shows on unload"`: `resolve` returns `null` for `a` and a URL
    for `b`. Start, flush until `b` plays, `dispose()` → `notify.info` called once with
    `"Skipped 1 track with no preview"`.
  - `"Review Focus 1: unload during the gap plays nothing when the gap timer fires"`: gap 2000.
    Start, let `a` play, fire the duration timer, `dispose()`, fire every remaining timer id →
    `audio.play` call count unchanged.
  - `"Review Focus 2: unload while resolving plays nothing when it settles"`: `resolve` returns a
    deferred. Playing `true`, start, `dispose()`, resolve with a URL, flush → `audio.play` not
    called, `player.resume` called once.
- [ ] **Step 3:** `bun run test src/previewController` → the new tests FAIL (`dispose is not a function`).
- [ ] **Step 4:** Implement `dispose()` and the guards in `previewController.ts`.
- [ ] **Step 5:** `bun run test src/previewController` → PASS.
- [ ] **Step 6:** Pre-commit verification, then commit: `Make the controller inert after dispose`.

### Task 6: `contextMenus.dispose()` (U14, U15)

**Files:**
- Modify: `src/ui/contextMenus.ts`
- Test: `src/ui/contextMenus.test.ts`

**Interfaces:**
- Produces: `dispose(): void` on the object `createContextMenus` returns. It calls `deregister()`
  on every item that `register()` registered, and calls the unsubscribe returned by
  `deps.onSettingsChange`.

- [ ] **Step 1: Write the failing tests.** In the test's `Item` stub, make `register` and
  `deregister` `vi.fn()` instance fields:
  - `"U14: dispose deregisters each of the three items once"`: `register()` then `dispose()` →
    `built` has 3 items and each `deregister` was called once.
  - `"U15: after dispose a settings change does not relabel Preview track"`: `onSettingsChange` backed
    by a real `Set` (add, return delete). `register()`, `dispose()`, change `getDurationMs` to
    return 30000, call every listener still in the set → the *Preview track* item's `name` is still
    `"Preview track (15s)"`, and the set is empty.
  - `"Review Focus 3: a throw mid-register leaves only the registered items to deregister"`: the stub's
    `register` throws on the second constructed item. `register()` throws. `dispose()` → the first
    item's `deregister` called once, and the other items' not at all.
- [ ] **Step 2:** `bun run test src/ui/contextMenus.test.ts` → FAIL.
- [ ] **Step 3:** Implement. `register()` pushes each item into a `registered` array after its
  `register()` returns, and keeps the unsubscribe.
- [ ] **Step 4:** `bun run test src/ui/contextMenus.test.ts` → PASS.
- [ ] **Step 5:** Pre-commit verification, then commit: `Deregister the context-menu items on dispose`.

### Task 7: `actionBar.stop()` (U10–U13, action-bar part of U30)

**Files:**
- Modify: `src/ui/actionBarButton.ts`
- Test: `src/ui/actionBarButton.test.ts`

**Interfaces:**
- Produces: `stop(): void` on the object `createActionBarButton` returns. It calls the unlisten
  from `History.listen`, disconnects the observer, cancels a queued frame, removes
  `#tpp-action-bar-button`, and clears `started`. It is safe before `start()` and when called twice.

- [ ] **Step 1: Write the failing tests.** In `beforeEach`, `listen` returns an `unlisten` `vi.fn()`
  and captures the listener it was given. Use the file's `renderActionBar`, `deps` and `settle`:
  - `"U10: stop removes the button and calls the History unlisten"`.
  - `"U11: after stop, DOM mutations and navigations never re-add the button"`: start, stop, remove
    and re-render the action bar, call the captured History listener, `await settle()` → no
    button.
  - `"U12: a frame queued before stop injects nothing"`: start with no action bar in the DOM, then
    `renderActionBar()` (the observer queues a frame), `stop()` synchronously, `await settle()` →
    no button.
  - `"U13: stop then start works again"`: with the action bar present, start, stop, start,
    `await settle()` → exactly one button. Then remove the row, stop, start, render the row
    later, `await settle()` → exactly one.
  - `"U30: stop disconnects the observer"`: `vi.spyOn(MutationObserver.prototype, "disconnect")`
    is called by `stop()`.
  - `"Review Focus 3: stop before start does not throw"`.
- [ ] **Step 2:** `bun run test src/ui/actionBarButton.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Keep `unlisten`, `observer` and the `requestAnimationFrame` id in
  closure variables. `schedule()` records the frame id, and the frame callback clears it.
- [ ] **Step 4:** `bun run test src/ui/actionBarButton.test.ts` → PASS.
- [ ] **Step 5:** Pre-commit verification, then commit: `Stop the action-bar button on dispose`.

### Task 8: Panel host teardown (U16, U17, panel part of U30)

`previewPanel.tsx` imports React, which is not in `node_modules`, so vitest cannot load it. The
host element, root and settings subscription therefore move into a React-free module that can be
tested.

**Files:**
- Create: `src/ui/panelHost.ts`
- Test: `src/ui/panelHost.test.ts` (`// @vitest-environment happy-dom`)
- Modify: `src/ui/previewPanel.tsx`

**Interfaces:**
- Produces (in `panelHost.ts`):
  ```ts
  export const ROOT_ID = "tpp-preview-root";
  export interface PanelHostDeps {
    /** Creates the React root on `host` and renders into it. */
    mount(host: HTMLElement): { unmount(): void };
    onSettingsChange(listener: () => void): () => void;
    /** Writes placement to `host`; also called on every settings change. */
    place(host: HTMLElement): void;
  }
  export function mountPanelHost(deps: PanelHostDeps): { host: HTMLElement; dispose(): void };
  ```
  `mountPanelHost` reuses an existing `#tpp-preview-root` or appends a new one to `body`, calls
  `mount`, and subscribes `() => deps.place(host)`. `dispose()` unsubscribes, unmounts, and removes
  the host. It is idempotent.
- Produces (in `previewPanel.tsx`): `createPreviewPanel(deps): PreviewPanel`, where
  `export type PreviewPanel = PanelPort & { dispose(): void }`.

- [ ] **Step 1 (spike s1):** Over CDP, create a throwaway host, then
  `Spicetify.ReactDOM.createRoot(host).render(Spicetify.React.createElement("b", null, "x"))`.
  After one frame, `root.unmount()` leaves `host.childElementCount === 0`. A second `createRoot`
  on a fresh host renders. Remove both hosts in a `finally`. Record the result.
- [ ] **Step 2: Write the failing tests** in `panelHost.test.ts`:
  - `"U16: dispose unmounts the root and removes the host"`: after `mountPanelHost`,
    `#tpp-preview-root` exists and `mount` got it. After `dispose()`, `unmount` was called once
    and `#tpp-preview-root` is absent.
  - `"U17: after dispose a settings change does not place"`: `onSettingsChange` backed by a real
    `Set`. Firing the listeners before dispose calls `place` with the host. After `dispose()`, the
    set is empty, and firing every listener left adds no `place` call.
  - `"dispose twice unmounts once"`.
  - `"reuses an existing #tpp-preview-root"`.
- [ ] **Step 3:** `bun run test src/ui/panelHost.test.ts` → FAIL (module not found).
- [ ] **Step 4:** Implement `panelHost.ts`. In `previewPanel.tsx`, replace the host creation,
  `createRoot(...).render(...)` and `deps.onSettingsChange(place)` with one `mountPanelHost` call:
  `mount` creates the root, renders `<PreviewRoot …/>` and returns the root; `place(host)` is the
  existing `place` body targeting `host`. `open()` calls `place(host)`. Return
  `{ open, update, close, dispose }`, where `dispose` is the host's. Delete the "Unsubscribe on
  unload is #8" comment and update the header comment to cite U16/U17.
- [ ] **Step 5:** `bun run check` → PASS.
- [ ] **Step 6:** Pre-commit verification, then commit: `Unmount the preview panel on dispose`.

### Task 9: Row-highlight characterization (U5, row-highlight part of U30)

**Files:**
- Test: `src/ui/rowHighlight.test.ts` (`// @vitest-environment happy-dom`)

`rowHighlight.clear()` already clears and disconnects. This task pins that behaviour, since
dispose now relies on it.

- [ ] **Step 1: Write the tests:**
  - `"U5: after clear, a matching row added later is not highlighted"`: `set("spotify:track:abc")`,
    `clear()`, append a `.main-trackList-trackListRow` containing `<a href="/track/abc">`, and flush
    microtasks. No element has `tpp-previewing-row`.
  - `"U30: clear disconnects the observer"`: spy `MutationObserver.prototype.disconnect`, then
    `set(...)`, `clear()` → called.
- [ ] **Step 2:** `bun run test src/ui/rowHighlight.test.ts` → PASS. If either fails, fix
  `rowHighlight.ts` in this task.
- [ ] **Step 3:** Pre-commit verification, then commit: `Pin row-highlight teardown with tests`.

### Task 10: Per-load wiring and dispose in `load()` (U20–U25, U28, U31) + `src/types/stdlib.d.ts`

**Files:**
- Modify: `src/index.ts`, `src/types/stdlib.d.ts`
- Test: `src/index.test.ts`

**Interfaces:**
- Consumes: `createDisposer` (Task 3); `flush` (Task 4); `controller.dispose` (Task 5);
  `contextMenus.dispose` (Task 6); `actionBar.stop` (Task 7); `PreviewPanel.dispose` (Task 8);
  `rowHighlight.clear`.
- Produces: `function wire(): { settings: Settings; dispose: () => void }` (module-private);
  `load(ctx)` as in the spec's **Lifecycle** block.

- [ ] **Step 1: Config — update `src/types/stdlib.d.ts`:** `ModuleRuntimeContext` gains
  `spotifyVersion: string`, and `defer(fn: () => void | Promise<void>): void`.
- [ ] **Step 2: Rework `src/index.test.ts` mocks.** `ctx()` gains `spotifyVersion: "1.2.96.518"`.
  The factory mocks return fresh objects per call:
  - `createContextMenus` → `{ register, dispose }`;
  - `createActionBarButton` → `{ start, stop, refresh }`;
  - `createPreviewPanel` → `{ open, update, close, dispose }`.
  Add mocks for `./previewController` (`createPreviewController` → `{ dispose, startCollection,
  startTrack, startFromHere, toggleCollection, stop, next, removeCurrent, onEvent, isExcluded,
  isActiveFor }`, all `vi.fn()`) and for `./ui/rowHighlight` (`{ rowHighlight: { set, clear } }`).
  A helper `unload(c)` runs every function in `c.defer.mock.calls` in reverse order.
- [ ] **Step 3: Write the failing tests** (replace `"a second load … re-registers only the
  settings section"`):
  - `"load registers dispose with ctx.defer before the settings section"`: `defer` called once with
    a function, and its `invocationCallOrder` is lower than `registerSettingsSection`'s.
  - `"dispose tears down in order"`: unload → the mocks were called in this order (compare
    `invocationCallOrder`): controller `dispose`, menus `dispose`, action bar `stop`, panel
    `dispose`, `rowHighlight.clear`. (Flush sits between the controller and the menus. It runs on
    the real `pendingRemovals`, so it is not asserted here.)
  - `"U20: a second load builds a new wiring"`: load, unload, load → `createContextMenus`,
    `createActionBarButton` and `createPreviewPanel` were each called twice. The second menus'
    `register` and the second action bar's `start` were each called once. The first instances'
    `dispose`/`stop` were each called once, and the second instances' not yet.
  - `"U21: settings stored before unload are read by the next wiring"`: take the `settings`
    argument of the first `registerSettingsSection` call, `setDurationMs(5000)`, unload, load →
    the second call's `settings.getDurationMs()` is 5000.
  - `"U22: a throwing wire step disposes what was built and defers nothing"`: make the next
    `createContextMenus` return a `register` that throws `boom`. `load` rejects with `boom`. The
    controller `dispose`, action bar `stop`, panel `dispose` and menus `dispose` were each called
    once. `ctx.defer` and `registerSettingsSection` were not called.
  - `"U24: running the deferred dispose twice tears down once"`: unload twice → each teardown mock
    called once, and no throw.
  - `"U31: the new wiring routes to a fresh controller"`: load, unload, load. Call the second
    `createContextMenus` call's `deps.onPreviewCollection("spotify:album:x")` → the second
    controller's `startCollection` was called with `("spotify:album:x", 0)`, and the first's not.
    The second controller's `dispose` was not called.
  - `"Review Focus 4: two full cycles leave one live wiring"`: load, unload, load, unload, load →
    3 wirings built. The first two instances' teardown mocks were each called once; the third's
    were not.
  - Keep both S18/S4 tests (U25) unchanged apart from `ctx()`.
- [ ] **Step 4:** `bun run test src/index.test.ts` → the new tests FAIL.
- [ ] **Step 5: Implement in `src/index.ts`.** Delete `wired` and its comment. `wire()` keeps a
  `built: (() => void)[]` and pushes each piece's teardown right after the piece is created,
  **before** its `start()`/`register()`. The order is pending removals (`flush`), panel
  (`dispose`), controller (`dispose`), action bar (`stop`), context menus (`dispose`). The body
  sits in `try`. On `catch`, run `createDisposer([...built].reverse())()` inside its own
  `try { } catch { }` and re-throw the original error. On success, return
  `{ settings, dispose: createDisposer([controller.dispose, pendingRemovals.flush, contextMenus.dispose, actionBar.stop, panel.dispose, rowHighlight.clear]) }`
  (bind methods as arrow functions). `load()` follows the spec's **Lifecycle** block. Update the
  file header comment.
- [ ] **Step 6:** `bun run check` → PASS. `grep -rn "#8" src/` → no output (U28).
- [ ] **Step 7:** Pre-commit verification, then commit: `Rebuild the wiring per load and dispose it on unload`.

### Task 11: CSS as `entries.css` in `build.ts` (U18)

**Files:**
- Modify: `build.ts`

- [ ] **Step 1: Red check.** `bun run build:local`, then `grep -c 'createElement("style")' dist/track-playlist-preview/index.js`
  → `1`, and `jq .entries dist/track-playlist-preview/metadata.json` → `{"js":"index.js"}`.
- [ ] **Step 2: Implement.** Delete `styleInjection`, so the bundle is `js` alone. When `css` is
  non-empty, write `<outDir>/index.css`. Otherwise delete a stale `<outDir>/index.css` if one
  exists. `metadata(hasCss: boolean)` sets
  `entries: hasCss ? { js: "index.js", css: "index.css" } : { js: "index.js" }`. The watch path
  calls the same `build()`. Rewrite header item 2: imported CSS goes to `index.css`, which
  `metadata.json` declares as `entries.css`; the loader adopts it before each `load()` and removes
  it on unload.
- [ ] **Step 3: U18 checks, for both builds.** Run `bun run build:local`, then `bun run build`.
  For each output dir (`dist/track-playlist-preview/` and the path `bun run build` prints):
  - `grep -c 'tpp-panel' index.css` ≥ 1 and `grep -c 'tpp-previewing-row' index.css` ≥ 1;
  - `jq -c .entries metadata.json` → `{"js":"index.js","css":"index.css"}`;
  - `grep -c 'createElement("style")' index.js` → `0`.
- [ ] **Step 4 (spike s2):** `spicetify apply`. Over CDP, count the adopted sheets whose
  `cssRules` mention `.tpp-panel` → `1`, and `Spicetify.Modules.report.failed` → empty. If the
  sheet is missing, check the network for `/modules/track-playlist-preview/index.css` before
  changing anything.
- [ ] **Step 5:** Pre-commit verification, then commit: `Ship the stylesheet as entries.css`.

### Task 12: Live verification (U19, U26, U27, Review Focus 5)

**Files:** none (fixes found here go into the file at fault).

- [ ] **Step 1:** `bun run build && spicetify apply`. `Spicetify.Modules.report` shows the module
  loaded.
- [ ] **Step 2:** Capture the U27 baseline as in Task 2 Step 2. Tell the user playback will be
  interrupted. `node scripts/check-unload.mjs` → every line is `PASS`, and the script exits 0.
- [ ] **Step 3:** `node scripts/check-unload.mjs --no-session` → every line `PASS`, no session
  checks listed, exit 0.
- [ ] **Step 4:** Repeat Task 2 Step 4's U27 probe → all five true.
- [ ] **Step 5 (Review Focus 5):** Over CDP,
  `await Spicetify.Modules.reload("track-playlist-preview")`, push `/collection/tracks`, and wait
  up to 5 s → exactly one `#tpp-action-bar-button`, and exactly one adopted sheet mentions
  `.tpp-panel`.
- [ ] **Step 6:** Manual smoke over CDP: start **Preview all**, schedule nothing, disable, and
  confirm Spotify's play state matches the state before the preview. Re-enable, and **Preview
  all** plays a clip.
- [ ] **Step 7:** If anything was fixed: pre-commit verification, then commit
  `Fix <what> found in live unload checks`, naming the defect in the body.

### Task 13: Update `docs/spicetify-v3-platform.md`

- [ ] **Step 1:** Add the "Unload, enable and reload" section as specified in the spec's
  **Documentation Updates** row, with sources as in **Investigation Findings**. Add the s1 and s2
  spike results.
- [ ] **Step 2:** Pre-commit verification, then commit: `Record the v3 unload and reload behaviour`.

### Task 14: Update `CLAUDE.md`

- [ ] **Step 1:** Apply the spec's `CLAUDE.md` row. Build item 2 becomes: CSS is written to
  `index.css`, declared as `entries.css`, and adopted and removed by the loader. Add a
  Documentation pointer:
  `- [Unload-teardown spec](docs/specs/2026-09-27-unload-teardown-design.md) — disposing everything on unload, the per-load wiring, criteria U1–U31.`
  Under "Debugging against the live client", add
  `node scripts/check-unload.mjs [--no-session]` (it interrupts playback). Under "Non-obvious
  constraints", add: **Everything `wire()` mounts must have a teardown step** in `dispose()` and
  in its rollback.
- [ ] **Step 2:** Pre-commit verification, then commit: `Point CLAUDE.md at the unload-teardown spec`.

### Task 15: Update `README.md`

- [ ] **Step 1:** Apply the spec's `README.md` row (Build paragraph and Debugging section).
- [ ] **Step 2:** Pre-commit verification, then commit: `Document the stylesheet entry and the unload check`.

### Task 16: Annotate `docs/specs/2026-09-27-settings-page-design.md`

- [ ] **Step 1:** Below Q6 and the **Unload** paragraph, add in italics: _Superseded by the
  [unload-teardown spec](2026-09-27-unload-teardown-design.md): unload now disposes everything._
- [ ] **Step 2:** Pre-commit verification, then commit: `Mark the Settings-page unload notes as superseded`.

### Task 17: Annotate `docs/specs/2026-09-27-panel-position-design.md`

- [ ] **Step 1:** At the "left for #8 to call on unload" sentence and at the #8 note in Deferred
  Items, append: _— addressed by the [unload-teardown spec](2026-09-27-unload-teardown-design.md)
  (U17)._
- [ ] **Step 2:** Pre-commit verification, then commit: `Link the panel-position spec's #8 notes to the unload spec`.

### Task 18: Annotate `docs/specs/2026-09-26-remove-from-playlist-design.md`

- [ ] **Step 1:** Below the Undo-window criteria, add in italics: _On unload, pending removals are
  flushed (committed at once): see the [unload-teardown spec](2026-09-27-unload-teardown-design.md),
  U6–U9. Quitting Spotify still drops them (#10)._
- [ ] **Step 2:** Pre-commit verification, then commit: `Note the unload flush in the Remove spec`.

### Task 19: Post-implementation check

- [ ] **Step 1:** Read `git diff main...HEAD --stat` and the diff. Confirm each item happened:
  `build.ts`, `scripts/check-unload.mjs` and `src/types/stdlib.d.ts` changed as in the Config
  table; the generated `metadata.json` declares `entries.css` (Task 11); the six doc updates are
  present; `#10` was verified (Task 1). No glossary or ADR work applies (spec: none). Fix anything
  missing in this task.
- [ ] **Step 2:** If anything was fixed: pre-commit verification, then commit:
  `Complete the unload-teardown documentation`.

### Task 20: Final build

- [ ] **Step 1:** `bun run build`. It exits 0 and writes `index.js`, `index.css` and
  `metadata.json` to the modules folder. Fix and re-run until it passes.
- [ ] **Step 2:** `spicetify apply`. `Spicetify.Modules.report` shows the module loaded without
  error.
- [ ] **Step 3:** If a fix was needed: pre-commit verification, then commit:
  `Fix the build after the unload-teardown changes`.

---

## Before finishing the branch

After Task 20, if a cross-model review helper is available (e.g. the Codex plugin's adversarial
review), run it with focus: *"Judge correctness against the spec's acceptance criteria (U1–U31)
only. Do not flag anything outside the stated criteria — no design alternatives, hardening, or
scope the spec did not claim."* It never gates the merge.

Then, per `CLAUDE.md` "Finishing a feature", ask the user whether to remove
`spotify_launch_flags = --remote-debugging-port=8088` and re-run `spicetify apply`.
