# Preview Modal — Design Spec

**Date:** 2026-07-25
**Status:** Approved for planning
**Builds on:** [`2026-07-22-track-playlist-preview-design.md`](2026-07-22-track-playlist-preview-design.md)
(the shipped extension, PR #4, AC1–AC45) and [ADR 0001](../adr/0001-preview-audio-via-trackpreview-graphql.md).
This spec **supersedes or retires** AC8, AC13, AC19, AC27, AC33, AC34, AC38, AC39, AC40, AC42 and
AC45 of that spec — see **Superseded Acceptance Criteria**. Adopting a blocking modal reaches
further into the shipped criteria than the modal's own surface: it removes the Playbar controls that
AC8/AC13 assert on, and it covers the UI that AC34/AC42/AC45 and the replacement path (AC19/AC27)
depend on.

**Amended by:** [`2026-09-26-remove-from-playlist-design.md`](2026-09-26-remove-from-playlist-design.md): a
Remove control (R1–R13) to fold into this modal's design and plan.

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
| **Skipping state** | The preview modal's rendering for a `trackSkipped` event: the skipped track's name, artist and `i/N`, a "No preview — skipping" indicator, placeholder artwork, empty progress bar. Distinct from the *playing state* (AC61). |
| **Foreign takeover** | Any non-preview-modal caller invoking `Spicetify.PopupModal.display` while a session is active. `PopupModal` is a singleton, so this unmounts our content and is handled identically to a user dismissal (AC60). |

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
  → if queue empty: "Nothing to preview", NO modal   // AC46, prior AC8
  → resolve collection label once (adapter)
  → coordinator.acquire()
  → modal.open(view)              // AC46: auto-open, blocking PopupModal
  → engine.start(...)

engine emits trackStarted  → modal.update(playingView)   // AC49: update in place
engine emits trackSkipped  → modal.update(skippingView)  // AC61: no stale track/counter
engine emits sessionEnded  → modal.close()               // AC55, all reasons
```

`sessionEnded` has no replacement branch: with a blocking modal there is no reachable way to start a
second session while one is active (see **Superseded Acceptance Criteria**, AC19/AC27/AC34). The
engine's `"replaced"` reason and the coordinator's pause-ownership transfer remain implemented and
unit-tested as engine invariants; the modal simply closes on every `sessionEnded` reason.

Modal callbacks map to existing controller/engine entry points:

- `onStop` (Stop button) → `controller.stop()` (AC50)
- `onClose` (X / backdrop / Esc) → `controller.stop()` (AC51 — close = stop)
- `onSkip` (Next button) → `engine.skip()` (AC52)

**Close detection.** `Spicetify.PopupModal` exposes no `onClose`; a backdrop/Esc/X dismissal only
unmounts the rendered content. The modal content therefore carries a React effect whose **cleanup**
(fired on unmount) invokes `onClose` → `controller.stop()` (AC51). This must be **idempotent and
re-entrancy-guarded**: a programmatic `modal.close()` (from a `sessionEnded` we initiated, AC55) also
unmounts the content and would re-enter `stop()`; a single "closing owned by the controller" flag
distinguishes a controller-driven teardown from every other unmount, so the session is stopped
exactly once. `engine.stop()` is already a no-op when idle, but the flag is what makes the count
assertable rather than incidentally safe.

**`PopupModal` is a singleton the extension does not own.** There is exactly one modal;
`PopupModal.display` replaces whatever is showing. `ui/settingsModal` already calls it, and so may
any other extension. The preview modal therefore holds the singleton for the whole session, which is
why prior AC42 is rescoped and AC45 retired. A foreign `display()` mid-session unmounts our content
and is **indistinguishable from a user dismissal** — which is the correct outcome: cleanup fires,
the session stops exactly once, and Spotify resumes iff it was playing (AC60). The controller-owned
flag must not swallow this case; only a teardown *we* initiated sets it.

### Modules

| Module | Change | Responsibility |
| --- | --- | --- |
| `ui/previewModal` | **new** | React component + `open`/`update`/`close` port. Renders the modal content and hosts the native track menu. Pure consumer of a view-model + callbacks. |
| `types/domain` | change | `TrackRef` gains optional `artworkUrl`. Add the modal view-model type and `ModalPort` interface. **`AudioPort` is declared here**, not in `spotify/ports` — the elapsed/duration accessor widens this interface. |
| `previewController` | change | Add the `modal` port + its lifecycle; handle `trackSkipped`; suppress the per-track Snackbar; remove the `playbar` and `highlight` wiring. |
| `previewController.test` | **new** | Does **not** exist today — this is a new file, not an extension of an existing one. |
| `collections/*`, `spotify/fetchTrackRef` | change | Populate `TrackRef.artworkUrl` from source item images. |
| `spotify/ports` (`createAudioPort`) | change | Implement the elapsed/duration accessor (interface change lands in `types/domain`). |
| `spotify/*` (collection label) | **new small adapter** | Resolve a collection URI → display name (`getMetadata` per type; "Liked Songs" constant). |
| `index.ts` | change | Build the modal + collection-label adapter; wire the `modal` port; drop `playbar`/`highlight`. |
| `ui/playbarControls` | **removed** | Superseded by the modal's controls (AC57). Only `.ts` exists — **there is no `playbarControls.test.ts`**. |
| `ui/rowHighlight` (+ `.css`) | **removed** | Occluded by the always-open modal; AC39 removed (AC58). Only `.ts` and `.css` exist — **there is no `rowHighlight.test.ts`**. |

**Purity note.** `AudioPort` is the *pure engine's* port; the progress bar is a UI concern. Adding
an elapsed/duration accessor to it is a deliberate widening for a non-engine consumer. The engine
itself must not read it — its advance timing stays driven by `TimerPort` and the `ended` handler, so
the "`previewEngine` is pure" rule in `CLAUDE.md` is preserved.

**JSX.** `ui/previewModal.tsx` is the repo's first `.tsx`. Verified no config change is needed:
`tsconfig.json` sets `"jsx": "react"` (classic runtime), so the file must `import React from "react"`
— which `build.ts` already aliases to `Spicetify.React`. Bun bundles `.tsx` natively.

### Modal contents

- Large album artwork (neutral placeholder when `artworkUrl` is absent) · `Title — Artist`.
- `From: <collection name> · (i/N)`. Single-track session → single-track indicator, no counter.
- **Stop**, **Next** (disabled on the last queue entry), display-only **progress bar** filling
  against the effective preview window, reset per track.
- **Add to playlist** affordance → opens the native track menu for the current track URI.
- **Skipping state** (AC61) — on `trackSkipped` the modal shows that track's name/artist and its
  correct `i/N`, with a "No preview — skipping" indicator, dimmed/placeholder artwork and an empty
  progress bar. Nothing on screen goes stale during a run of unpreviewable tracks.

**Progress bar during the inter-track gap.** `gapMs` (prior AC44, default 0, user-configurable) sits
between tracks. The bar **holds at full** for the gap's duration and resets to empty when the next
`trackStarted` arrives — it does not empty early, which would read as a stalled preview.

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
- **Settings become idle-only.** `PopupModal` is a singleton; the preview modal holds it for the
  session, so the settings modal is reachable only between sessions (prior AC42 rescoped) and
  mid-session duration changes are gone (prior AC45 retired).
- **Replacement sessions are no longer user-reachable.** With the action bar and context menus
  covered, there is no way to start a second session over a running one. The engine and coordinator
  keep the replacement logic as an invariant (prior AC19/AC27), and prior AC34 is retired.

### Error handling

| Condition | Behaviour |
| --- | --- |
| `TrackMenu` fails to render / native menu unavailable | The add-to-playlist affordance no-ops with a Snackbar ("Add to playlist unavailable"); the rest of the modal is unaffected. (A custom-picker fallback is a deferred item.) |
| `artworkUrl` absent for a track | Render a neutral artwork placeholder; no error. |
| Collection label lookup fails | Show a generic label (e.g. the collection type) rather than failing the session. |
| Session aborts on API error (prior AC13) | Modal closes as part of `sessionEnded`; the existing abort Snackbar still fires. Note prior AC13's "Playbar controls are deregistered" clause no longer applies (AC57). |
| Another caller displays a `PopupModal` mid-session | Our content unmounts; cleanup fires and the session stops exactly once, Spotify resuming iff it was playing (AC60). Treated as a user dismissal — we do not fight for the singleton or reopen. |

### Testing

Pure logic is unit-tested with **Vitest**, matching the repo's `*.test.ts` convention:

- `previewController.test` — **a new file**; no controller test exists today. Asserts the `modal`
  port calls (`open` on session start, **not** opened on an empty queue, `update` on `trackStarted`,
  `update` with the skipping view on `trackSkipped`, `close` on `sessionEnded` for every reason),
  that the per-track Snackbar is suppressed, that no `playbar`/`highlight` calls occur, and that a
  user close and a controller-driven close each stop the session **exactly once** (AC51, AC60).
- A pure `toModalView` helper (engine event + collection label → view-model) unit-tested directly,
  covering the playing and skipping states and the single-track indicator.
- Enumeration adapters — extended to assert `artworkUrl` population.

**Not unit-testable — manual CDP verification required.** The React component, the native-menu
reuse, the `PopupModal` z-index/portal behaviour, **the progress bar (AC53)** and **the
`TrackMenu`-unavailable fallback (AC63)** are verified in the running client via
`scripts/cdp-eval.mjs`, per the repo's established practice for UI adapters. AC53 is called out
because the pure `toModalView` test does not reach it: the bar's fill is driven by a sampling loop
over the audio element's elapsed time, not by a view-model field a unit test can assert.

The **collection-label fallback (AC64)** *is* unit-testable — put the fallback in the label adapter,
not the component, and assert that a rejected/empty `getMetadata` yields the generic type label.

---

## Acceptance Criteria

Continue the prior spec's numbering. Session-lifecycle terms are as defined there.

**Modal lifecycle**

- **AC46** — On any preview session start (action bar, collection or track context menu, single
  track, from-here — every collection type), the preview modal opens automatically as a blocking
  `Spicetify.PopupModal`. Given enumeration yields no eligible tracks, **no modal opens** and the
  "Nothing to preview" Snackbar shows instead (prior AC8).
- **AC49** — When the engine advances to the next track, the open modal updates its artwork, name,
  artist, position counter and progress in place, without closing and reopening.
- **AC55** — When a session terminates by any cause (completed, stopped, aborted, or via the modal's
  Stop/close), the modal closes. There is no exception: every `sessionEnded` reason closes the modal.

**Modal contents**

- **AC47** — The modal displays the current track's album artwork, name and artist; when
  `artworkUrl` is absent it shows a neutral placeholder rather than a broken image.
- **AC48** — Given a collection-backed session, the modal displays the resolved collection name and
  the one-based position `i/N` (`i` from the engine's index, `N` the preview-queue length). Given a
  single-track session — started from the track context menu, or from *Preview from here* outside a
  collection context (prior AC37), where the controller supplies no collection URI — the modal
  displays the single-track indicator and **neither** a collection name **nor** an `i/N` counter.
- **AC53** — The modal shows a display-only progress bar reflecting elapsed time against the
  effective preview window `min(configuredDurationMs, clipDurationMs)`; it reaches full as the track
  advances, **holds at full for the `gapMs` inter-track gap**, and resets to empty when the next
  track starts. Verified manually via CDP, not by unit test (see **Testing**).
- **AC61** — Given the engine emits `trackSkipped` for a track with no available clip, the modal
  updates to that track's name, artist and one-based `i/N`, shows a "No preview — skipping"
  indicator with placeholder artwork and an empty progress bar, and does not retain the previously
  played track's details. Through a run of consecutive skips neither the track details nor the
  counter go stale.

**Modal controls**

- **AC50** — The modal's Stop control terminates the session: the engine returns to idle, audio
  halts, and Spotify is resumed iff it was playing before the session started.
- **AC51** — Closing the modal (close button, backdrop click, or Escape) terminates the session
  identically to AC50, and does so **exactly once** — the unmount cleanup does not re-enter `stop()`
  when the close was initiated by the controller.
- **AC60** — Given a caller other than the preview modal displays a `Spicetify.PopupModal` while a
  session is active, the session terminates exactly once: preview audio halts, Spotify is resumed
  iff it was playing before the session started, and the extension neither reopens its modal nor
  re-enters `stop()`.
- **AC52** — The modal's Next control advances to the next track immediately (equivalent to the
  engine's `skip`); it is disabled when the current track is the last entry in the preview queue.

**Add to playlist (native)**

- **AC54** — The modal exposes an "Add to playlist" affordance that opens Spotify's native track
  context menu (`ReactComponent.ContextMenu` hosting `ReactComponent.TrackMenu`) for the **current**
  track's URI, and that menu renders visibly above the open `PopupModal` rather than behind it.
- **AC62** — The native menu's "Add to playlist" submenu adds the current track to a playlist
  selected there, and removes it from a playlist it already belongs to, with the change reflected in
  that playlist. The submenu's own search and "New playlist" entries are Spotify's and function
  unmodified.
- **AC63** — Given `ReactComponent.TrackMenu` is unavailable or throws while rendering, the
  add-to-playlist affordance no-ops and an "Add to playlist unavailable" Snackbar is shown; the
  modal remains open and every other control (Stop, Next, progress, artwork) continues to work, and
  the session is not terminated.

_Design constraint, verified by code review rather than test: this extension renders no playlist
list of its own. See `CLAUDE.md`._

**Data**

- **AC59** — For each enumeration source (`PlaylistAPI.getContents`, `LibraryAPI.getTracks`, artist
  top-tracks) and for single-track fetch, cover art is read from the field path resolved by spike
  (c). Given that field holds URL `U`, the produced `TrackRef.artworkUrl` equals `U`; given the
  field is absent, `artworkUrl` is undefined and the modal renders the placeholder (AC47). Spike (c)
  fills in the path per source; the shape of this assertion does not change.
- **AC64** — Given the collection-label lookup fails or returns no name, the modal displays a
  generic label derived from the collection type (e.g. "Playlist", "Album", "Artist") in place of
  the resolved name, and the session starts and runs normally — a label failure never aborts a
  session nor blocks the modal from opening.

**Superseded / removed (see next section) — restated as pass/fail**

- **AC56** — While the preview modal is displayed, the per-track "`Title — Artist (i/N)`" Snackbar
  (former AC38) is **not** shown; the end-of-session summary Snackbar (AC41) is unchanged.
- **AC57** — No Playbar Skip/Stop buttons are registered for a preview session (superseding AC33);
  session controls exist only in the modal.
- **AC58** — No collection-page row highlight is applied for a preview session; `ui/rowHighlight`
  (and its CSS/test) is removed and unreferenced (removing AC39).

## Superseded Acceptance Criteria

From `2026-07-22-track-playlist-preview-design.md`:

**Directly replaced by this spec's modal criteria**

- **AC33** (Playbar Skip/Stop registered while active) → superseded by **AC57** (no Playbar
  controls; controls live in the modal).
- **AC38** (per-track Snackbar on each preview start) → superseded by **AC56** (suppressed while the
  modal is shown).
- **AC39** (current-track row highlight) → **removed** by **AC58** (occluded by the modal;
  `ui/rowHighlight` deleted).
- **AC40** (session keeps playing while browsing other pages) → superseded: previewing is a focused,
  blocking-modal activity; browse-while-previewing is no longer a goal. Audio still decouples from
  the page internally, but the blocking modal is the surface.

**Amended — clauses invalidated by removing the Playbar controls (AC57)**

- **AC8** — the "…and no Playbar controls are registered" clause is **struck**. The rest stands:
  given no eligible tracks, a "Nothing to preview" Snackbar shows, no session starts, Spotify is not
  paused, no audio plays — and, added here, no modal opens (AC46).
- **AC13** — the "Playbar controls are deregistered" clause is **struck**. The rest stands: the
  session aborts, audio halts, the API-error Snackbar shows, Spotify is resumed iff it was playing.
  The modal closes as part of `sessionEnded` (AC55).

**Retired as unreachable — the blocking modal covers their trigger**

- **AC34** (action-bar click during an active session on the same collection terminates it) →
  **retired**. The modal covers the action bar, so this has no reachable trigger. The controller's
  `toggleCollection` behaviour remains implemented; only the user-facing criterion is withdrawn.
- **AC19** (starting a session while one is active terminates the first) and **AC27** (replacement
  transfers pause ownership; no second pause, no resume at the moment of replacement) → **restated
  as engine-level invariants**. Both remain enforced in `previewEngine`/`playerCoordinator` and
  verified by their existing unit tests, but neither is claimed as user-reachable behaviour while
  the blocking modal is open. AC55 accordingly has no replacement branch.
- **AC45** (changing duration mid-session applies from the next track, without interrupting the
  current one) → **retired**. The settings modal is unreachable mid-session: `PopupModal` is a
  singleton the preview modal holds for the session's duration.

**Rescoped**

- **AC42** (settings modal reachable from a `Spicetify.Menu.Item` in the profile dropdown) → holds
  **while no session is active**. Its content requirements — duration, inter-track gap, one toggle
  per collection type — are unchanged.

AC1–AC7, AC9–AC12, AC14–AC18, AC20–AC26, AC28–AC32, AC35–AC37, AC41, AC43 and AC44 are unchanged.

## Deferred Items

Recorded here as **UNFILED** — the user prefers to open tracker issues themselves. Not yet filed
against `Heyian/track-playlist-preview`:

- **UNFILED** — Settings toggle to disable the preview modal (restoring the Playbar-only,
  browse-while-previewing flow / AC40).
- **UNFILED** — Custom compact playlist picker as a fallback if the native `TrackMenu` stops
  rendering on a future Spotify version (RootlistAPI + PlaylistAPI + CurationAPI; the
  add/remove/contains APIs are recorded under Investigation Findings).
- **UNFILED** — Restore mid-session duration tuning (prior AC45), lost because `PopupModal` is a
  singleton the preview modal holds for the session. Most likely shape: a duration control inside
  the preview modal. Considered and rejected for this iteration — it would make the modal a settings
  writer rather than a pure consumer of engine events.
- **UNFILED** — Non-blocking preview surface (a custom overlay panel instead of `PopupModal`), which
  would reinstate prior AC34, AC40, AC42-mid-session, AC45 and the reachable replacement path in one
  move. Considered and rejected for this iteration: it abandons native modal fidelity and adds its
  own z-index contest with the native `TrackMenu`.

Explicitly **not deferred** at the user's direction (they will file issues later if wanted):
pause/resume of the current clip, a Previous control, and a seekable progress bar.

Row-highlight cleanup is **not** deferred — it is in scope for this spec (AC58).

## Glossary Updates & ADRs

**Glossary:** no `CONTEXT.md` exists; spec-local terms are in **Terms**.

**ADRs — decided here, file to be created by Required Task 3** (not yet written; `docs/adr/` holds
only 0001):

- `docs/adr/0002-preview-modal-native-trackmenu.md` — the preview experience becomes a focused,
  blocking native modal, and add/remove-to-playlist reuses Spotify's native `TrackMenu` rather than
  a hand-built picker. Meets the three-criteria gate: hard to reverse (binds to an undocumented
  Spotify component and retires shipped capabilities), surprising without context (a future reader
  will ask why the whole native menu is reused, and why choosing a blocking `PopupModal` cascaded
  into retiring AC34, AC45 and the AC19/AC27 replacement path), and a real trade-off (native
  fidelity vs. version fragility; focused modal vs. browse-while-previewing and mid-session
  settings). The ADR must record the `PopupModal`-is-a-singleton finding — it is the reason the
  settings criteria moved, and it is not obvious from the API surface.

**ADR conflicts surfaced:** none in `docs/adr/` (0001 is unrelated). This spec does supersede
shipped **acceptance criteria** (AC33/38/39/40) — recorded under **Superseded Acceptance Criteria**
and reflected back into the prior spec (see Documentation Updates).

---

## Config & Infrastructure Impact

Scanned: containers (none), CI/CD (none — no `.github/workflows`), IaC (none), env config (none —
no env vars introduced), schemas (none), scripts, API collections (none), agent index.

| File | Change needed |
| --- | --- |
| `src/types/domain.ts` | Add `artworkUrl?: string` to `TrackRef`; add the modal view-model type and `ModalPort` interface; add the elapsed/duration accessor to `AudioPort` (declared here, not in `ports.ts`). |
| `src/ui/previewModal.tsx` | **New.** React modal component + `open`/`update`/`close` port; hosts the native track menu. First `.tsx` in the repo — no tsconfig/build change needed (`"jsx": "react"` already set). |
| `src/previewController.ts` | Add `modal` port + lifecycle; handle `trackSkipped`; suppress per-track Snackbar; remove `playbar`/`highlight` wiring. |
| `src/previewController.test.ts` | **New file** — no controller test exists today. Covers the modal-port calls, skip handling, and stop-exactly-once (AC51/AC60). |
| `src/ui/previewModal.view.ts` + `.test.ts` (or equivalent) | **New.** The pure `toModalView` helper and its unit test, kept out of the `.tsx` so it is testable without a DOM. |
| `src/spotify/collectionLabel.ts` (or fold into an existing adapter) | **New small adapter.** Collection URI → display name. |
| `src/spotify/ports.ts` | `createAudioPort` implements the elapsed/duration accessor for the progress bar. |
| `src/spotify/fetchTrackRef.ts` | Populate `artworkUrl`. |
| `src/collections/*.ts` | Populate `artworkUrl` from source item images. |
| `src/index.ts` | Wire the modal + collection-label adapter; drop `playbar`/`highlight`. |
| `src/ui/playbarControls.ts` | **Delete** (AC57). This file only — **no `playbarControls.test.ts` exists**; do not add a task to delete one. |
| `src/ui/rowHighlight.ts`, `src/ui/rowHighlight.css` | **Delete** (AC58). These two only — **no `rowHighlight.test.ts` exists**; do not add a task to delete one. |
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
| `docs/specs/2026-07-22-…-design.md` | Back-annotate **every** affected criterion, not just the four originally listed: AC33/AC38/AC39/AC40 superseded or removed; AC8/AC13 amended (Playbar clause struck); AC34/AC45 retired; AC19/AC27 restated as engine-level invariants; AC42 rescoped to "while idle". Each gets a pointer to `2026-07-25-preview-modal-design.md`. |
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
>    and artist top-tracks items."* Then **rewrite AC59 to name the resolved path** — it is not
>    independently testable until that lands.
>    (d) *"Confirm an open `Spicetify.PopupModal` actually blocks pointer interaction with the action
>    bar and the collection/track context menus."*
>    Use `scripts/cdp-eval.mjs` against the running client. If (a) or (b) fails, STOP and raise it —
>    the native-menu decision (AC54/AC62) depends on them and the user chose native-only.
>    If **(d)** shows the modal does **not** block, STOP and raise it: the retirement of prior AC34,
>    AC45 and the AC19/AC27 replacement path (see **Superseded Acceptance Criteria**) is premised on
>    it blocking, and those criteria would need reinstating instead.
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
