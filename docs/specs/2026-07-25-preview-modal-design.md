# Preview Modal — Design Spec

**Date:** 2026-07-25
**Status:** Approved for planning
**Builds on:** [`2026-07-22-track-playlist-preview-design.md`](2026-07-22-track-playlist-preview-design.md)
(the shipped extension, PR #4, AC1–AC45) and [ADR 0001](../adr/0001-preview-audio-via-trackpreview-graphql.md).
This spec **supersedes** AC33, AC38, AC39 and AC40 of that spec — see **Superseded Acceptance
Criteria**.

---

## Problem

The shipped extension previews tracks with only a Snackbar and two Playbar buttons for feedback and
control. It restored preview *audio* but not the original preview's *surface*: artwork, transport
controls, the collection you're previewing from, and quick add/remove to your playlists.

This feature adds a **preview modal** — a focused surface that opens with every preview session,
shows the current track's artwork and progress, exposes Stop/Next, and lets you add or remove the
track from playlists using Spotify's **own** playlist picker rather than a hand-built list.

## Terms

Extends the prior spec's **Terms**. Spec-local (no `CONTEXT.md` glossary exists).

| Term | Meaning |
| --- | --- |
| **Preview modal** | The blocking `Spicetify.PopupModal` auto-opened per preview session, showing artwork, `Title — Artist`, the source collection + position, a progress bar, Stop/Next, and the add-to-playlist affordance. |
| **Native track menu** | Spotify's own `Spicetify.ReactComponent.TrackMenu`, rendered inside `ReactComponent.ContextMenu`. Its "Add to playlist ▶" submenu is Spotify's real playlist picker (search, checkmarks, "New playlist"). Reused verbatim — we build no playlist list. |
| **Effective preview window** | `min(configuredDurationMs, clipDurationMs)` — the point at which a normally-completing track advances (from the prior spec's AC14/AC15). The progress bar fills against this. |

_Avoid:_ "player" for the preview modal (it drives no `Spicetify.Player`); "picker" for anything we
build (the picker is always Spotify's native one).

---

## Investigation Findings

Verified live over the Chrome DevTools Protocol (`127.0.0.1:8088`) on 2026-07-25, plus a
web/GitHub survey of how existing extensions add tracks to playlists.

### The native picker cannot be opened standalone — but the native track menu can be reused

There is **no** Spicetify/Platform API that opens Spotify's standalone "Add to playlist" picker, and
no extension does it; every add-to-playlist extension hand-rolls a list and calls `PlaylistAPI`
underneath (adufr/`quick-add-to-playlist`, JimMarley420/`addToPlaylistMulti`,
huhridge/`listPlaylistsWithSong`).

However, Spotify's **whole native track context menu** is reusable. Confirmed live:

- `Spicetify.ReactComponent.TrackMenu` is a live `React.memo` component
  (`function({canSwitchVisuals, ...t}) { … }`) that forwards props to Spotify's inner track menu.
- `Spicetify.ReactComponent.ContextMenu` and `RightClickMenu` are live and are the standard way
  extensions mount a menu as a click/right-click target.
- Rendering `ContextMenu` with `menu={React.createElement(TrackMenu, { uri, … })}` yields Spotify's
  real track menu; its "Add to playlist ▶" submenu **is** the native picker.

`TrackMenu`'s exact prop set is undocumented (typed `any`). Mirroring Spotify's own invocation
(minimum `uri`; likely also `uris`, `contextUri`, `reference`) is a **first-task live spike**, as is
confirming the native menu portals **above** `PopupModal`.

### Supporting Platform APIs (all live under `Spicetify.Platform`)

Not required for the native-menu path, but recorded because the deferred custom-picker fallback and
the "which playlists contain this track" affordance would use them:

| Need | Call |
| --- | --- |
| Add track to playlist | `PlaylistAPI.add(playlistUri, trackUris, { after })` |
| Remove track from playlist | `PlaylistAPI.remove(playlistUri, [{ uri, uid }])` — `uid` from `getContents()` |
| User's playlists/folders | `RootlistAPI.getContents()` |
| Is track curated into contexts | `CurationAPI.isCurated` / `curateItems` |
| Collection metadata (label) | `PlaylistAPI.getMetadata(uri)`; album/artist equivalents |

### Album artwork is available at enumeration time

Every enumeration source returns items carrying album images (`PlaylistAPI.getContents`,
`LibraryAPI.getTracks`, artist top-tracks). Artwork therefore rides the existing enumeration — no
per-track live fetch at play time. **Exact field path is a first-task spike** (the live socket
dropped mid-investigation before the shape dump completed); the research survey and community type
defs put it at `item.album.images[]` / `item.albumOfTrack.coverArt`.

---

## Architecture

The preview modal is a new `ui/` module that is a **pure consumer of engine events**: it renders a
view-model and calls back into the controller. It performs no `Spicetify.Player` calls (the
`playerCoordinator`-only rule holds) and no enumeration. It touches only React, `PopupModal`, and
the native `ReactComponent` menu — the same class of Spicetify UI globals the other `ui/` modules
already use.

### Wiring

`previewController` gains a `modal` port, wired exactly like the existing `playbar`/`highlight`
ports it replaces:

```
beginSession(queue, startIndex, collectionUri)
  → resolve collection label once (adapter)
  → coordinator.acquire()
  → modal.open(view)              // AC46: auto-open, blocking PopupModal
  → engine.start(...)

engine emits trackStarted  → modal.update(view)      // AC49: update in place
engine emits sessionEnded  → if replaced: keep modal, repoint  // AC55
                             else:        modal.close()          // AC55
```

Modal callbacks map to existing controller/engine entry points:

- `onStop` (Stop button) → `controller.stop()` (AC50)
- `onClose` (X / backdrop / Esc) → `controller.stop()` (AC51 — close = stop)
- `onSkip` (Next button) → `engine.skip()` (AC52)

**Close detection.** `Spicetify.PopupModal` exposes no `onClose`; a backdrop/Esc/X dismissal only
unmounts the rendered content. The modal content therefore carries a React effect whose **cleanup**
(fired on unmount) invokes `onClose` → `controller.stop()` (AC51). This must be **idempotent and
re-entrancy-guarded**: a programmatic `modal.close()` (from a `sessionEnded` we initiated, AC55) also
unmounts the content and would re-enter `stop()`; a single "closing owned by the controller" flag
distinguishes a user dismissal from a controller-driven teardown so the session is stopped exactly
once. `engine.stop()` is already a no-op when idle, but the guard keeps a `replaced`-then-`update`
sequence from being misread as a user close.

### Modules

| Module | Change | Responsibility |
| --- | --- | --- |
| `ui/previewModal` | **new** | React component + `open`/`update`/`close` port. Renders the modal content and hosts the native track menu. Pure consumer of a view-model + callbacks. |
| `types/domain` | change | `TrackRef` gains optional `artworkUrl`. Add the modal view-model type and `ModalPort` interface. |
| `previewController` | change | Add the `modal` port + its lifecycle; suppress the per-track Snackbar; remove the `playbar` and `highlight` wiring. |
| `collections/*`, `spotify/fetchTrackRef` | change | Populate `TrackRef.artworkUrl` from source item images. |
| `spotify/ports` (`createAudioPort`) | change | Expose an elapsed/duration accessor for the progress bar. |
| `spotify/*` (collection label) | **new small adapter** | Resolve a collection URI → display name (`getMetadata` per type; "Liked Songs" constant). |
| `index.ts` | change | Build the modal + collection-label adapter; wire the `modal` port; drop `playbar`/`highlight`. |
| `ui/playbarControls` (+ test) | **removed** | Superseded by the modal's controls (AC57). |
| `ui/rowHighlight` (+ `.css`, + test) | **removed** | Occluded by the always-open modal; AC39 removed (AC58). |

### Modal contents

- Large album artwork (neutral placeholder when `artworkUrl` is absent) · `Title — Artist`.
- `From: <collection name> · (i/N)`. Single-track session → single-track indicator, no counter.
- **Stop**, **Next** (disabled on the last queue entry), display-only **progress bar** filling
  against the effective preview window, reset per track.
- **Add to playlist** affordance → opens the native track menu for the current track URI.

### Behaviour changes vs. the shipped extension

- **Previewing is now a focused, foreground activity.** The modal auto-opens on every session and is
  a blocking `PopupModal`; browsing other pages while previewing (AC40) is retired. The audio still
  decouples from the page internally, but the modal is the surface.
- **Close = stop.** There is no dismiss-without-stopping and no reopen affordance; a closed modal
  means the session ended.
- **Per-track Snackbar suppressed** while the modal is shown; the end-of-session summary (AC41)
  stays.
- **Playbar Skip/Stop and the row highlight are removed** — both are occluded by the modal and
  replaced by, or made moot by, it.

### Error handling

| Condition | Behaviour |
| --- | --- |
| `TrackMenu` fails to render / native menu unavailable | The add-to-playlist affordance no-ops with a Snackbar ("Add to playlist unavailable"); the rest of the modal is unaffected. (A custom-picker fallback is a deferred item.) |
| `artworkUrl` absent for a track | Render a neutral artwork placeholder; no error. |
| Collection label lookup fails | Show a generic label (e.g. the collection type) rather than failing the session. |
| Session aborts on API error (prior AC13) | Modal closes as part of `sessionEnded`; the existing abort Snackbar still fires. |

### Testing

Pure logic is unit-tested with **Vitest**, matching the repo's `*.test.ts` convention:

- `previewController.test` — extended to assert the new `modal` port calls (`open` on session start,
  `update` on `trackStarted`, `close` on non-replaced `sessionEnded`, repoint on `replaced`) and
  that the per-track Snackbar is suppressed and no `playbar`/`highlight` calls occur.
- A pure `toModalView` helper (engine event + collection label → view-model) unit-tested directly.
- Enumeration adapters — extended to assert `artworkUrl` population.

The React component, the native-menu reuse, and the `PopupModal` z-index/portal behaviour are
verified manually in the running client via the CDP harness (`scripts/cdp-eval.mjs`), per the repo's
established practice for UI adapters.

---

## Acceptance Criteria

Continue the prior spec's numbering. Session-lifecycle terms are as defined there.

**Modal lifecycle**

- **AC46** — On any preview session start (action bar, collection or track context menu, single
  track, from-here — every collection type), the preview modal opens automatically as a blocking
  `Spicetify.PopupModal`.
- **AC49** — When the engine advances to the next track, the open modal updates its artwork, name,
  artist, position counter and progress in place, without closing and reopening.
- **AC55** — When a session terminates by any cause (completed, stopped, aborted, or via the modal's
  Stop/close), the modal closes. A **replacement** session is the exception: the modal stays open and
  repoints to the new session's first track.

**Modal contents**

- **AC47** — The modal displays the current track's album artwork, name and artist; when
  `artworkUrl` is absent it shows a neutral placeholder rather than a broken image.
- **AC48** — The modal displays the source collection's name and the one-based position `i/N`
  (`i` from the engine's index, `N` the preview-queue length). A single-track session shows a
  single-track indicator and no `i/N` counter.
- **AC53** — The modal shows a display-only progress bar reflecting elapsed time against the
  effective preview window `min(configuredDurationMs, clipDurationMs)`; it reaches full as the track
  advances and resets to empty on each new track.

**Modal controls**

- **AC50** — The modal's Stop control terminates the session: the engine returns to idle, audio
  halts, and Spotify is resumed iff it was playing before the session started.
- **AC51** — Closing the modal (close button, backdrop click, or Escape) terminates the session
  identically to AC50.
- **AC52** — The modal's Next control advances to the next track immediately (equivalent to the
  engine's `skip`); it is disabled when the current track is the last entry in the preview queue.

**Add to playlist (native)**

- **AC54** — The modal exposes an "Add to playlist" affordance that opens Spotify's native track
  context menu (`ReactComponent.ContextMenu` hosting `ReactComponent.TrackMenu`) for the current
  track's URI; the native menu renders above the modal, and its "Add to playlist" submenu adds or
  removes the current track using Spotify's own picker. No playlist list is built by this extension.

**Data**

- **AC59** — Every `TrackRef` produced by enumeration and by single-track fetch carries an
  `artworkUrl` whenever its source provides cover art; the modal renders that artwork.

**Superseded / removed (see next section) — restated as pass/fail**

- **AC56** — While the preview modal is displayed, the per-track "`Title — Artist (i/N)`" Snackbar
  (former AC38) is **not** shown; the end-of-session summary Snackbar (AC41) is unchanged.
- **AC57** — No Playbar Skip/Stop buttons are registered for a preview session (superseding AC33);
  session controls exist only in the modal.
- **AC58** — No collection-page row highlight is applied for a preview session; `ui/rowHighlight`
  (and its CSS/test) is removed and unreferenced (removing AC39).

## Superseded Acceptance Criteria

From `2026-07-22-track-playlist-preview-design.md`, superseded by this spec:

- **AC33** (Playbar Skip/Stop registered while active) → superseded by **AC57** (no Playbar
  controls; controls live in the modal).
- **AC38** (per-track Snackbar on each preview start) → superseded by **AC56** (suppressed while the
  modal is shown).
- **AC39** (current-track row highlight) → **removed** by **AC58** (occluded by the modal;
  `ui/rowHighlight` deleted).
- **AC40** (session keeps playing while browsing other pages) → superseded: previewing is a focused,
  blocking-modal activity; browse-while-previewing is no longer a goal. Audio still decouples from
  the page internally, but the blocking modal is the surface.

AC1–AC32, AC34–AC37, AC41–AC45 are unchanged.

## Deferred Items

Recorded here as **UNFILED** — the user prefers to open tracker issues themselves. Not yet filed
against `Heyian/track-playlist-preview`:

- **UNFILED** — Settings toggle to disable the preview modal (restoring the Playbar-only,
  browse-while-previewing flow / AC40).
- **UNFILED** — Custom compact playlist picker as a fallback if the native `TrackMenu` stops
  rendering on a future Spotify version (RootlistAPI + PlaylistAPI + CurationAPI; the
  add/remove/contains APIs are recorded under Investigation Findings).

Explicitly **not deferred** at the user's direction (they will file issues later if wanted):
pause/resume of the current clip, a Previous control, and a seekable progress bar.

Row-highlight cleanup is **not** deferred — it is in scope for this spec (AC58).

## Glossary Updates & ADRs

**Glossary:** no `CONTEXT.md` exists; spec-local terms are in **Terms**.

**ADRs created:**

- `docs/adr/0002-preview-modal-native-trackmenu.md` — the preview experience becomes a focused,
  blocking native modal, and add/remove-to-playlist reuses Spotify's native `TrackMenu` rather than
  a hand-built picker. Meets the three-criteria gate: hard to reverse (binds to an undocumented
  Spotify component and retires a shipped capability), surprising without context (a future reader
  will ask why the whole native menu is reused and why AC40 was dropped), and a real trade-off
  (native fidelity vs. version fragility; focused modal vs. browse-while-previewing).

**ADR conflicts surfaced:** none in `docs/adr/` (0001 is unrelated). This spec does supersede
shipped **acceptance criteria** (AC33/38/39/40) — recorded under **Superseded Acceptance Criteria**
and reflected back into the prior spec (see Documentation Updates).

---

## Config & Infrastructure Impact

Scanned: containers (none), CI/CD (none — no `.github/workflows`), IaC (none), env config (none —
no env vars introduced), schemas (none), scripts, API collections (none), agent index.

| File | Change needed |
| --- | --- |
| `src/types/domain.ts` | Add `artworkUrl?: string` to `TrackRef`; add the modal view-model type and `ModalPort` interface. |
| `src/ui/previewModal.tsx` | **New.** React modal component + `open`/`update`/`close` port; hosts the native track menu. |
| `src/previewController.ts` | Add `modal` port + lifecycle; suppress per-track Snackbar; remove `playbar`/`highlight` wiring. |
| `src/spotify/collectionLabel.ts` (or fold into an existing adapter) | **New small adapter.** Collection URI → display name. |
| `src/spotify/ports.ts` | `createAudioPort` exposes an elapsed/duration accessor for the progress bar. |
| `src/spotify/fetchTrackRef.ts` | Populate `artworkUrl`. |
| `src/collections/*.ts` | Populate `artworkUrl` from source item images. |
| `src/index.ts` | Wire the modal + collection-label adapter; drop `playbar`/`highlight`. |
| `src/ui/playbarControls.ts`, `src/ui/playbarControls.test.ts` | **Delete** (AC57). |
| `src/ui/rowHighlight.ts`, `src/ui/rowHighlight.css`, `src/ui/rowHighlight.test.ts` | **Delete** (AC58). |
| `docs/adr/0002-preview-modal-native-trackmenu.md` | **New** ADR. |
| `CLAUDE.md` | See Documentation Updates. |
| `README.md` | See Documentation Updates. |
| `docs/specs/2026-07-22-…-design.md` | Mark AC33/38/39/40 superseded, pointer to this spec. |

No new environment variables. No new settings key in this iteration (the modal-disable toggle is a
deferred item).

## Documentation Updates

| Doc | Change |
| --- | --- |
| `CLAUDE.md` | Add a `ui/previewModal` pointer row; add a one-line non-obvious constraint — *reuse `Spicetify.ReactComponent.TrackMenu` via `ContextMenu`; never hand-build a playlist picker, never hardcode menu class names*; note that previewing is now a blocking-modal activity (AC40 retired) and that `playbarControls`/`rowHighlight` were removed. Keep the index ≤300 lines. |
| `README.md` | Document the preview modal: artwork + Stop/Next + progress, and add/remove to playlists via Spotify's own menu. Note the behaviour change (previewing is a focused modal; closing stops). |
| `docs/specs/2026-07-22-…-design.md` | Add a note under AC33/AC38/AC39/AC40 that they are superseded/removed by `2026-07-25-preview-modal-design.md`. |
| `docs/adr/0002-…` | Created by this design. |

---

## Implementation Plan Guidance

> **For the plan author (`superpowers:writing-plans`):**
>
> Read the repo's agent index (`CLAUDE.md`) first for architecture, commands and conventions.
> The plan must include the Required Tasks below and apply every Per-Task Policy to every task.
>
> ### Required Tasks
>
> 1. **Isolated workspace** — IF the session is not already isolated, first task:
>    *"Create an isolated workspace via `superpowers:using-git-worktrees`."* (This session is already
>    in a worktree — skip if so.)
> 2. **Live spikes first** — before building the modal, add explicit spike tasks:
>    (a) *"Confirm `Spicetify.ReactComponent.TrackMenu`'s prop set and that it renders inside a
>    custom React tree, mounted via `ReactComponent.ContextMenu`, on the live client."*
>    (b) *"Confirm the native track menu portals **above** an open `Spicetify.PopupModal`
>    (z-index/portal)."*
>    (c) *"Confirm the album-artwork field path on `PlaylistAPI.getContents`, `LibraryAPI.getTracks`
>    and artist top-tracks items."*
>    Use `scripts/cdp-eval.mjs` against the running client. If (a) or (b) fails, STOP and raise it —
>    the native-menu decision (AC54) depends on them and the user chose native-only.
> 3. **ADR creation** — *"Create `docs/adr/0002-preview-modal-native-trackmenu.md` (sequential
>    numbering)."*
> 4. **Config file tasks** — one task per file in **Config & Infrastructure Impact**, including the
>    two **deletions** (`ui/playbarControls*`, `ui/rowHighlight*`) and their un-wiring in `index.ts`.
> 5. **Docs update tasks** — one task per **Documentation Updates** row (CLAUDE.md pointer/constraint,
>    README, back-annotate the 2026-07-22 spec). Design content stays in the docs dir; the index gets
>    at most a pointer row + a one-line constraint.
> 6. **Deferred items** — the two deferred items are **UNFILED** by user preference; add a task to
>    *"Confirm with the user whether to file the two UNFILED deferred items as issues before finishing
>    the branch,"* not to auto-file them.
> 7. **Post-implementation check** — second-to-last task: *"Verify every Required Task ran — files
>    added AND deleted, docs written, ADR created — by reading the diff, not the plan markings."*
> 8. **Final build task** — last task: *"Run `bun run build` and fix until it builds."* Non-negotiable.
>
> ### Per-Task Policies (apply to every task)
>
> - **Testing (TDD)** — `superpowers:test-driven-development`, using Vitest and `*.test.ts`. Test the
>   pure view-model helper and the controller's modal-port calls; the React component + native menu
>   are manually verified via CDP.
> - **Verification before completion** — `superpowers:verification-before-completion`. Do not rely on
>   type-checks alone for the modal, the native menu, or the deletions.
> - **Commit hygiene** — one focused commit per task, matching this repo's commit-message style.
> - **Pre-commit verification (mandatory)** — before EVERY `git commit`, dispatch a verification
>   subagent that runs `bun run check` from the repo root and reports `STATUS: PASS`/`FAIL` with a
>   terse per-issue list. Wait for PASS. Never `git commit --no-verify`.
>
> ### Before finishing the branch (advisory cross-model review)
>
> After the final build passes — and before `superpowers:finishing-a-development-branch` — if a
> cross-model review helper is available, run it focused: *"Judge correctness against this spec's new
> acceptance criteria (AC46–AC59) and the superseded-AC changes only. Do not flag anything outside
> the stated criteria."* This never gates the merge; the gate stays `bun run check` + `bun run build`.

**Note:** `bun run check` (typecheck + tests) is the whole quality gate — no linter. A green
`bun run build` does not prove types; run `bun run check` too.
