# Preview Panel — Design Spec

**Date:** 2026-07-25 · **Revised:** 2026-09-26 (re-grilled on Spotify 1.2.96.518 / Spicetify v3)
**Status:** Revised — awaiting approval
**Builds on:** [`2026-07-22-track-playlist-preview-design.md`](2026-07-22-track-playlist-preview-design.md)
(the shipped extension, PR #4/#5, AC1–AC45) and [ADR 0001](../adr/0001-preview-audio-via-trackpreview-graphql.md).
**Folds in:** [`2026-09-26-remove-from-playlist-design.md`](2026-09-26-remove-from-playlist-design.md)
(R1–R16, approved and critique-revised). R-criteria keep their ids and live in that spec; this spec
decides the parts it handed over (Undo surface, Remove control).

> **Filename.** This spec was first written for a blocking `Spicetify.PopupModal` ("preview modal").
> The 2026-09-26 re-grill replaced it with a non-blocking **preview panel**. The filename is kept so
> existing links resolve. The original version is in git history (`cd683a1`).

---

## Problem

The shipped extension previews tracks with only a notice and two Playbar buttons for feedback and
control. It restored preview *audio* but not the original preview's *surface*: artwork, transport
controls, and the collection you're previewing from.

Previewing a playlist is usually triage: hear each clip, decide whether it stays. This feature adds
a **preview panel**. The panel opens with every preview session, shows the current track's artwork and
progress, and exposes Stop, Next and (in an editable playlist) Remove, with keyboard shortcuts. The
page stays usable underneath it.

## Terms

Spec-local (no `CONTEXT.md` glossary exists). Extends the Terms of both related specs.

| Term | Meaning |
| --- | --- |
| **Preview panel** | Our own non-blocking React card, mounted once at `<body>` level and docked on the right edge. It shows artwork, `Title — Artist`, the source collection and position, a progress bar, and Stop / Next / Remove. It opens and closes with preview sessions. |
| **Pending-removals stack** | Our own list docked above the preview panel. It has one row per **pending removal** (remove spec) with an Undo action, and stays on screen while any removal is pending, whether or not the panel is open. |
| **Effective preview window** | `min(configuredDurationMs, clipDurationMs)`: the point at which a normally-completing track advances (prior spec AC14/AC15). The progress bar fills against this. |
| **Skipping state** | The panel's rendering for a `trackSkipped` event: the skipped track's name, artist and `i/N`, a "No preview — skipping" indicator, placeholder artwork, empty progress bar. Distinct from the *playing state*. |
| **Notice** | Spotify's toast (`Spicetify.showNotification`, a notistack Snackbar). Called "Snackbar" in the prior spec. |

_Avoid:_ "modal" or "popup" for the preview panel (it is neither); "player" for the panel (it drives
no `Spicetify.Player`); "toast" for a pending-removals stack row (it is ours, not Spotify's notice).

---

## Investigation Findings

Verified live over CDP (`scripts/cdp-eval.mjs`) on 2026-09-26: Spotify 1.2.96.518, Spicetify v3
modules, stdlib 1.13.0. These findings replace the 2026-07-25 set, which was taken under v2.

### Why not `Spicetify.PopupModal`

The original design used a blocking `PopupModal`. On the current client:

- **Every notice renders underneath an open `PopupModal`.** The notistack container (z 1400) sits
  inside `Root__top-container` (`position: relative; z-index: 0`), a stacking context below the modal
  overlay (`GenericModal__overlay`, z 100, full window). Hit tests on a default notice, a custom notice
  button and `showNotification` all return the overlay. A z-index change on the notice can't escape
  that stacking context. So Undo (remove spec R11), error notices and failure notices (R15) would all
  be invisible mid-session.
- **Escape does not close a `PopupModal`.** Only a backdrop click and the X button close it.
- **`display()` over an open modal leaks the previous tree.** The singleton re-renders without
  unmounting, so the old content's effect cleanup never runs.
- The modal *does* block pointer input to the page, which is what forced the retirements
  (AC34/AC40/AC42/AC45, reachable replacement) listed in the original version.

A body-level panel avoids all four: the page and notices stay visible, and we own the key handling.

### Why not Spotify's native track menu (Add to playlist)

`Spicetify.ReactComponent.TrackMenu`, `ContextMenu` and `RightClickMenu` exist, but a `TrackMenu`
mounted in our own React root throws (`Please wrap your component in RemoteConfig Provider`, then
`useNavigateStable must be used within a StableUseNavigateProvider`, then `RegistryContext`). It
renders only after harvesting all 82 React context providers from `.main-view-container`'s fiber
tree and re-wrapping them around it. "Add to playlist" additionally needs `saveTrackUri`, `albumUri`
and `artists` props. Once working, the menu portals to a body-level tippy root at z 9999, above
everything. The approach depends on Spotify's internal component tree and was judged too brittle.
With a non-blocking panel, Spotify's own row menu stays reachable during a session. Add to playlist
is therefore out of this iteration (see Deferred Items).

### Notice geometry

Notices render bottom-centre (probe at 1909×1143: `x 916–993, y 1079–1101`). A right-edge panel
does not intersect them at normal window widths. The right sidebar (Now Playing view), when open, is
the rightmost 420 px. The panel sits over it.

### Artwork and track metadata paths

| Source | Artwork field | URL form |
| --- | --- | --- |
| `PlaylistAPI.getContents` items (playlist, album) | `item.album.images[]` `{ url, label }`, labels `standard` (300), `small` (64), `large`/`xlarge` (640) | `spotify:image:…` (loads directly in `<img>`) |
| `LibraryAPI.getTracks({limit, offset})` items (Liked Songs) | `item.album.images[]` (same shape) | `spotify:image:…` |
| `queryArtistOverview` top tracks | `topTracks.items[].track.albumOfTrack.coverArt.sources[].url` (no size labels) | `https://i.scdn.co/image/…` |
| `Definitions.getTrack({ uri })` (single track) | `data.trackUnion.albumOfTrack.coverArt.sources[]` `{ url, width, height }` (300/64/640) | `https://i.scdn.co/image/…` |

**Existing bug:** `spotify/fetchTrackRef` asks `trackPreview` for `name`/`artists`, but
`data.lookup[0].data` holds only `{ previews, uri }`. Single-track previews therefore always show
the URI's last segment as the title. `getTrack` returns `trackUnion.name` and
`trackUnion.firstArtist.items[].profile.name`, plus the artwork. Fixed here (AC69) because the panel
displays that data.

### Icons

`Spicetify.SVGIcons` (100 entries) has `minus`, `block`, `x`, `skip-forward`, `pause`, `check`,
`check-alt-fill`, `plus2px`, `plus-alt`. It has no `stop` and no trash/remove/delete icon. Markup is
built as full `<svg>` from `Spicetify.SVGIcons[name]`, never a bare name (`CLAUDE.md`).

### Keyboard

Not verified live (it would modify a playlist): Spotify's desktop app is reported to remove the
selected tracklist row on `Delete`, immediately. Scoping our shortcuts to panel focus (AC66) avoids
that clash, as well as clashes with typing in search, so the design holds either way.

### Spike results (Task 2, verified 2026-09-26)

Live over CDP (`scripts/cdp-eval.mjs`) against the running client (Spotify 1.2.96.518, layout class
`global-nav-centered`). Each probe registered nothing that outlived the call; UI probes unmounted
and removed their host node in a `finally`.

**p1 — body-level React root.** `Spicetify.ReactDOM.createRoot` exists and is the API to use (not
`.render`). A `div#tpp-spike` appended to `<body>` with
`position: fixed; right: 16px; bottom: 120px; z-index: 50` hit-tests as itself at its centre and as
a page element at a point outside it. With `Spicetify.PopupModal.display(...)` open, the same centre
point resolves to `.GenericModal__overlay` — the host is correctly covered by the modal. A `<section
tabIndex={-1}>` rendered into the host accepted `.focus()` (`document.activeElement` matched). Full
`createRoot().unmount()` + node removal leaves no trace. **No STOP condition hit** — z-index 50 is
confirmed sufficient for "above the page, below `PopupModal`'s overlay (z 100)".

**p2 — CSS variables and geometry.**
`getComputedStyle(document.documentElement)` resolves `--background-elevated-base: #152238`,
`--text-base: #FFFFFF`, `--text-subdued: #ADB5BD`.

Selector `.Root__now-playing-bar` exists (`footer` does not — no `<footer>` element in this layout)
and is stable, but **in the current `global-nav-centered` layout it is not a bottom bar**: it docks
top-right, above `.Root__right-sidebar`, inside the 420 px right column (`Root__globalNav` occupies
the top 64 px full-width; `Root__now-playing-bar` then occupies roughly `top 56, bottom 472, left
1473, right 1893` at a 1909×1143 window; `Root__right-sidebar` occupies `top 472, bottom 1135` in
the same column). Confirmed via `[data-testid="now-playing-bar"]` / `.main-nowPlayingBar-*`, which
report the same right-docked geometry (inner box `1481,64 → 1885,464`). There is no full-width
element pinned to the window's bottom edge. Consequence for this spec: "the Playbar" is a
right-docked block in this layout, not a footer, and other layouts may dock it at the bottom
instead — a single fixed `bottom` offset for the panel is not safe across layouts. The panel must
measure `.Root__now-playing-bar` at open time and choose its offset accordingly; see
**Architecture → Layering → Placement** for the exact rule (AC70 holds either way).

The notistack container is found at `.notistack-Snackbar` (also matched by `[class*="notistack"]`,
`#notistack-snackbar` did not match). During `Spicetify.showNotification("probe")` its bounding box
was bottom-centre, e.g. `left 920, top 1067, right 989, bottom 1115` at the same window size —
consistent with the existing "Notice geometry" finding above (bottom-centre, not intersecting a
right-edge panel).

**p3 — `getTrack`.** `Spicetify.GraphQL.Definitions.getTrack` takes `{ uri }` (a single track URI;
the definition's own `variables` field lists `name`/`operation`/`sha256Hash`/`value` — the request
variable itself is just `{ uri }`). For `spotify:track:2pwED7E7gGr3UR7T3s3LSM`:
- `data.trackUnion.name` → `"Papaoutai - Afro Soul"`.
- `data.trackUnion.firstArtist.items[].profile.name` → `["mikeeysmind"]`.
- `data.trackUnion.otherArtists.items[].profile.name` → present here: `["Chill77", "Unjaps"]`.
- `data.trackUnion.albumOfTrack.coverArt.sources[]` → `{ url, width, height }` triples for
  300/64/640 px, `url`s of the form `https://i.scdn.co/image/...`.

All four paths in the design doc's table above are confirmed exactly as specified; no changes needed.

**p4 — collection names.**
- Playlist: `Spicetify.Platform.PlaylistAPI.getMetadata(playlistUri).name` → confirmed
  (`"Chansons aimées Papa"` for a real user playlist).
- Album: `PlaylistAPI.getMetadata(albumUri).name` **also works** for an album URI and returned the
  correct name (`"Papaoutai (Afro Soul)"`); `Spicetify.GraphQL.Definitions.getAlbum` with
  `{ uri: albumUri }` returned the same name at `data.albumUnion.name`, confirming the documented
  fallback works too. Either call is viable; `PlaylistAPI.getMetadata` is simplest since it also
  covers playlists, so a single code path can try it for both collection types before falling back
  to `getAlbum`.
- Artist: `Spicetify.GraphQL.Definitions.queryArtistOverview` with `{ uri: artistUri }` →
  `data.artistUnion.profile.name` → confirmed (`"mikeeysmind"`).

**r1 — URI-form removal of duplicates.**
Created a throwaway playlist via `Spicetify.Platform.RootlistAPI.createPlaylist("tpp-spike-throwaway",
{ after: "start" })`, which resolves directly to the new playlist's URI string (no wrapper object).
Added the same track twice plus one other via
`Spicetify.Platform.PlaylistAPI.add(playlistUri, [trackUri, trackUri, otherTrackUri], { after: "end" })`.
`getContents` showed 3 rows, each with a distinct `uid` (two rows shared the duplicate `uri`).
Calling `Spicetify.Platform.PlaylistAPI.remove(playlistUri, [{ uri: trackUri, uid: "" }])` once
removed **both** copies in a single call — `getContents` afterward showed only the other track, zero
remaining rows for the duplicated URI. **Confirms the spec's existing removal shape
(`{ uri: trackUri, uid: "" }`) already handles duplicates; Task 6's `playlistRemove` does not need
the per-`uid` fallback path.**

Cleanup pitfall (recorded for anyone reusing this pattern, not itself part of r1's removal
contract): `Spicetify.Platform.RootlistAPI.remove(uris)` maps each array entry as `e.uid ?? e.uri`,
so passing plain URI strings (`remove([playlistUri])`) silently no-ops — `contains([playlistUri])`
still returned `true` afterward. The working call is `RootlistAPI.remove([{ uri: playlistUri }])`,
after which `contains` returned `false` and the playlist no longer appeared in
`RootlistAPI.getContents()`. The throwaway playlist was deleted this way; no user playlist was
touched at any point.

---

## Architecture

The preview panel is a new `ui/` module that is a **pure consumer of controller calls**. It renders
a view-model and calls back into the controller. It makes no `Spicetify.Player` calls (the
`playerCoordinator`-only rule holds) and no enumeration. It uses plain React elements only. No
Spotify internal components means no provider problem.

### Wiring

`previewController` gains a `panel` port, replacing the `playbar` port it removes:

```
beginSession(queue, startIndex, collectionUri)
  → if queue empty: "Nothing to preview" notice, NO panel      // AC46, prior AC8
  → resolve collection label + removable flag once (adapters) // AC48, AC64, R1–R3
  → coordinator.acquire()                                      // no-op on replacement (AC27)
  → panel.open(view)   (update in place if already open)       // AC46, AC55
  → engine.start(...)

engine emits trackStarted  → panel.update(playingView); highlight.set(uri)   // AC49, AC39
engine emits trackSkipped  → panel.update(skippingView)                        // AC61
engine emits sessionEnded  → reason "replaced": keep panel open (next session updates it)
                             any other reason:  panel.close(); highlight.clear(); coordinator.release()
```

Panel callbacks map to controller entry points:

- `onStop` (Stop button) → `controller.stop()` (AC50)
- `onClose` (✕ button, `Esc`) → `controller.stop()` (AC51, close = stop)
- `onNext` (Next button, `→`) → `controller.next()` → `engine.skip()` (AC52)
- `onRemove` (Remove button, `Delete`) → `controller.removeCurrent()` (remove spec R5–R6)

Because the panel is ours, closing it is an explicit callback, not an unmount side effect. `panel.close()`
called by the controller never invokes `onClose`, so a session is stopped exactly once (AC51).

**Focus.** The panel takes keyboard focus every time a session starts, including a replacement. The
shortcuts `→`, `Delete`, `Esc` are handled only for key events whose target is inside the panel.
There they are consumed (`preventDefault` + `stopPropagation`) so Spotify does not also act on them.
Elsewhere, keys reach Spotify untouched (AC66).

**Layering.** The panel and the pending-removals stack mount in one body-level root. They sit
above the page and below `PopupModal`'s overlay (z 100), so the settings modal covers them when
opened mid-session (AC42). They don't intersect the Playbar or the bottom-centre notice area (AC70).
_The settings-modal part of this note is moot: settings moved to the Spicetify Settings page and the
modal was removed — see [the Settings-page spec](2026-09-27-settings-page-design.md)._

**Placement.** Per **Spike results → p2**, `.Root__now-playing-bar` is bottom-docked in some
layouts and top-right-docked in others (`global-nav-centered`, where it spans y 56–472). At each
open the panel measures its `getBoundingClientRect()` and picks one of four placements; the stack
always shares the panel's `right` and sits 8 px above it, growing up to a ceiling. (1) Selector
missing: `right 16`, `bottom 104`. (2) Bottom-docked (`rect.bottom >= innerHeight - 8`): `right 16`,
`bottom = innerHeight - rect.top + 16`. (3) Not bottom-docked and the 384 px panel plus one 64 px stack row fit below it
(`innerHeight - rect.bottom - 8 - 16 >= 384 + 8 + 64`, so the stack never collapses, AC67):
`right 16`, `bottom 16`, stack ceiling `rect.bottom + 8`. (4) Not bottom-docked and it doesn't fit: left of the Playbar's column,
`right = innerWidth - rect.left + 16`, and `bottom 104` so the panel clears the bottom-centre notice
(at 1280×800 the notice spans x 517–763, y 724–772, which a `bottom 16` panel at x 548–828 would
hit). Outside case 3 the stack ceiling is `.Root__globalNav`'s bottom + 8, or 72 px without it. The
panel stays 280 px wide. This keeps the panel and stack clear of both the Playbar and the notice
(AC70).

_These are the **Right edge** rules. AC70's "on the right edge" means rules 1–4, including rule
4's left-of-Playbar fallback. See the [panel-position spec](2026-09-27-panel-position-design.md),
P15–P17, for the other positions._

Styling comes from Spotify's CSS custom properties (e.g. `--background-elevated-base`, `--text-base`,
`--text-subdued`) and, for buttons, classes read off a live `[data-encore-id="buttonTertiary"]`
sibling, as `actionBarButton` already does. No `e-NNNNN` class is hardcoded (`CLAUDE.md`).

### Modules

| Module | Change | Responsibility |
| --- | --- | --- |
| `ui/previewPanel.tsx` | **new** | React card + `open`/`update`/`close` port; focus + key handling; hosts the pending-removals stack's render. Plain elements only. First `.tsx` in the repo. |
| `ui/previewPanel.view.ts` | **new, pure** | `toPanelView(event, label, removable)` → view-model (playing / skipping / single-track). Unit-tested without a DOM. |
| `ui/pendingRemovalsStack.tsx` | **new** | Renders one row per pending removal with Undo; subscribes to `pendingRemovals`. Mounted independently of the panel's open state. |
| `pendingRemovals` | **new, pure** | Remove spec. Adds a change subscription (list of pending entries: handle, title, playlist name) for the stack. |
| `types/domain` | change | `TrackRef.artworkUrl?`; `PanelPort`, panel view-model; `AudioPort` gains an elapsed/duration accessor; remove spec's `RemovePort` and `isExcluded` type. |
| `previewController` | change | `panel` port lifecycle incl. replacement; `trackSkipped` handling; suppress per-track notice; drop `playbar`; keep `highlight`; add `next()`; add remove spec's removable flag + `removeCurrent()`. |
| `previewController.test.ts` | **new** | No controller test exists today. |
| `previewEngine` | change | Remove spec's `isExcluded` dep. The engine never reads the audio elapsed accessor. |
| `collections/*` | change | Populate `artworkUrl` from the paths in **Investigation Findings**. |
| `spotify/fetchTrackRef` | change | Switch to `Definitions.getTrack`: real name, artist(s), artwork (AC69). Keep the URI-label fallback. |
| `spotify/collectionLabel.ts` | **new** | Collection URI → display name (`getMetadata` per type; "Liked Songs" constant), with a generic type-label fallback (AC64). |
| `spotify/ports` | change | `createAudioPort` implements the elapsed accessor; remove spec's `playlistRemove` and `canRemove`. |
| `index.ts` | change | Build panel, stack, label adapter and `pendingRemovals`; wire `panel`; drop `playbar`. |
| `ui/playbarControls.ts` + `.test.ts` | **deleted** | Superseded by the panel (AC57). |
| `ui/rowHighlight` | unchanged | Kept; AC39 applies again. |

**Purity note.** `AudioPort` is the pure engine's port. Adding an elapsed/duration accessor is a
deliberate widening for a UI consumer (the progress bar). The engine must not read it. Its advance
timing stays driven by `TimerPort` and the `ended` handler, preserving the "`previewEngine` is pure"
rule in `CLAUDE.md`.

**JSX.** `tsconfig.json` sets `"jsx": "react"` (classic runtime), so `.tsx` files
`import React from "react"`, which `build.ts` aliases to `Spicetify.React`. Bun bundles `.tsx`
natively.

### Panel contents

```
┌───────────────────────┐
│                    ✕  │
│  ┌─────────────────┐  │
│  │    artwork      │  │   ~280 px wide, right edge
│  └─────────────────┘  │
│  Title — Artist       │
│  From: Chill Mix 4/37 │
│  ▓▓▓▓▓▓░░░░░░░░░░░░   │
│ [■ Stop][⏭ Next]  [− Remove] │
└───────────────────────┘
```

Vertical offset is not a fixed "above the Playbar" spot — it's set by the Playbar's measured
placement at open time. See Layering → Placement above and Spike results → p2 below.

- Artwork (neutral placeholder when `artworkUrl` is absent), `Title — Artist`.
- `From: <collection name> · i/N`. Single-track session → single-track indicator, no counter.
- **Stop**, **Next** (disabled on the last queue entry), display-only **progress bar** against the
  effective preview window. After a normal completion the bar holds full during `gapMs`. It resets
  when the next track starts. Next and Remove advance with no hold.
- **Remove**: icon (`minus`) + text "Remove", right-aligned apart from Stop/Next, accessible label
  "Remove from *playlist name*". Present only in a removable session (remove spec R1–R2).
- **Skipping state** on `trackSkipped` (AC61).
- **✕** close = stop.

**Pending-removals stack**, directly above the panel: rows `Removed *Title* from *Playlist* · Undo`,
newest nearest the panel. A row disappears when its removal is undone or its commit call is issued
(a later failure shows only the R15 notice). The stack stays at the same anchor when the panel is
closed. It has no row limit.

### Behaviour changes vs. the shipped extension

- A preview panel opens with every session and closes when it ends (except on replacement, where it
  updates in place). Close = stop; there is no minimize and no done screen.
- The page stays usable: browsing (AC40), the action-bar toggle (AC34), context menus (including
  starting a replacement session, AC19/AC27) and mid-session settings (AC42/AC45) all keep working.
- Per-track notice (AC38) suppressed while the panel is open. The end-of-session summary (AC41) and
  error notices stay.
- Playbar Skip/Stop removed (AC33 superseded by AC57). The row highlight (AC39) stays.
- Single-track previews show the real title and artist (AC69; fixes the `fetchTrackRef` bug).

### Error handling

| Condition | Behaviour |
| --- | --- |
| `artworkUrl` absent / image fails to load | Neutral placeholder; no error. |
| Collection label lookup fails | Generic type label ("Playlist", "Album", "Artist"); session unaffected (AC64). |
| `getTrack` fails for a single track | URI-label fallback as today; artwork placeholder. |
| Session aborts on API error (prior AC13) | Panel closes with `sessionEnded`; the abort notice shows. |
| `canRemove` lookup fails | No Remove control; session unaffected (R3). |
| Removal commit rejects | R15 notice (the stack row already left when the call was issued). |

### Testing

Vitest, `*.test.ts`:

- `previewController.test.ts` (**new file**): `panel.open` on session start, not on an empty queue;
  `update` on `trackStarted` and with the skipping view on `trackSkipped`; `close` on every
  `sessionEnded` reason except `replaced`; on replacement the panel is updated, not closed; per-track
  notice suppressed; no Playbar calls; highlight set/cleared; `onClose` stops exactly once and a
  controller-driven `close` does not call `stop`; plus the remove spec's controller cases.
- `previewPanel.view.test.ts`: playing, skipping, single-track, removable/not-removable views; Next
  disabled on last entry.
- `pendingRemovals.test.ts` (remove spec) plus the change subscription used by the stack.
- `collections/*.test.ts`: `artworkUrl` from each source path, absent → undefined.
- `collectionLabel` test: rejected/empty metadata → generic type label.
- `fetchTrackRef` is a `Spicetify` adapter. Unit-test its pure parsing by extracting a
  `parseGetTrack(res)` helper.
- Delete `ui/playbarControls.test.ts` with its module.

**Manual CDP verification** (not unit-testable): the React panel and stack rendering, focus and key
scoping (AC66), placement/layering (AC70), the progress bar (AC53), and the page staying interactive
(AC65).

---

## Acceptance Criteria

Ids continue the shipped spec's numbering. Surviving ids from the 2026-07-25 version are kept. New
ids start at AC65. The remove spec's **R1–R16** apply unchanged and are part of this feature's
contract. Session-lifecycle terms are as defined in the shipped spec.

**Panel lifecycle**

- **AC46**: On any preview session start (action bar, collection or track context menu, single
  track, *Preview from here*, every collection type), the preview panel opens. Given enumeration
  yields no eligible tracks, **no panel opens** and the "Nothing to preview" notice shows (prior
  AC8). No `Spicetify.PopupModal` is used for the preview surface.
- **AC49**: When the engine advances to the next track, the open panel updates its artwork, name,
  artist, position counter and progress in place, without closing and reopening.
- **AC55**: When a session ends as `completed`, `stopped` or `aborted`, the panel closes. When a
  session ends as `replaced` (a new session started from the page), the panel stays open and shows
  the new session's view at its starting entry (the selected entry for *Preview from here*, per R4),
  with the collection name and counter per AC48 and the playing or skipping state per AC49/AC61.
- **AC65**: While the panel is open, the page stays interactive: navigating to another page does not
  close the panel or interrupt the session. The action bar, context menus and the profile-menu
  settings entry remain clickable, and each behaves as its shipped criterion states (AC34, AC19/AC27,
  AC42).

**Panel contents**

- **AC47**: The panel displays the current track's album artwork, name and artist. When
  `artworkUrl` is absent or fails to load, it shows a neutral placeholder rather than a broken image.
- **AC48**: Given a collection-backed session, the panel displays the resolved collection name and
  the one-based position `i/N` (`i` from the engine's index, `N` the preview-queue length). For a
  Liked Songs session the collection name is the constant "Liked Songs". Given a
  single-track session (track context menu, or *Preview from here* outside a collection context per
  prior AC37), the panel displays the single-track indicator and **neither** a collection name
  **nor** an `i/N` counter.
- **AC53**: The panel shows a display-only progress bar reflecting elapsed time against the
  effective preview window. On a normal completion (duration expiry or natural clip end, prior
  AC14/AC15) it reaches full and **holds at full for `gapMs`**. On Next (AC52) or Remove (R6) there
  is no full-bar hold and no gap (prior AC23). On `trackSkipped` it is empty (AC61). It resets to
  empty when the next track starts. Verified manually via CDP.
- **AC61**: Given the engine emits `trackSkipped`, the panel shows that track's name and artist, a
  "No preview — skipping" indicator, placeholder artwork and an empty progress bar, and none of the
  previous track's details. In a collection-backed session it also shows the one-based `i/N`. In a
  single-track session it keeps the single-track indicator and shows no counter (AC48). Through
  consecutive skips neither the details nor the counter go stale.
- **AC68**: In a removable session the panel shows a Remove button with the `minus` icon (full
  `<svg>` markup from `Spicetify.SVGIcons`) and the visible text "Remove", positioned apart from Stop
  and Next, with accessible label "Remove from *playlist name*". In a non-removable session no Remove
  button is rendered (R2).

**Panel controls**

- **AC50**: The Stop control ends the session: the engine returns to idle, audio halts, and Spotify
  resumes iff it was playing before the session started.
- **AC51**: The ✕ control, and `Esc` while focus is inside the panel, end the session identically to
  AC50, calling `controller.stop()` exactly once. A controller-driven `panel.close()` never calls
  `controller.stop()`.
- **AC52**: The Next control advances to the next track immediately (the engine's `skip`). It is
  disabled when the current track is the last entry in the preview queue.
- **AC66**: When a session starts (including a replacement), the panel receives keyboard focus.
  While focus is inside the panel, `→` acts as Next (AC52, no-op when disabled), `Delete` acts as
  Remove (R6; no-op per R5 in a non-removable session) and `Esc` acts as close (AC51). Each such
  event is consumed and does not reach Spotify's own handlers. Given focus is outside the panel,
  those keys trigger no panel action and reach Spotify unchanged.

**Pending removals**

- **AC67**: Each pending removal (remove spec) is shown as one row in the pending-removals stack
  with the track title, source playlist name and an Undo action. The row stays visible and its
  Undo usable until the commit call is issued, regardless of how many removals are pending and
  whether the panel is open. Using Undo is R11's undo. The row disappears when the removal is
  undone or when its commit call is issued. A later rejection shows only R15's notice and no row.
  Rows are ordered newest nearest the panel. With no pending removals, the stack renders nothing.

**Placement**

- **AC70**: At a window of at least 1280×800, the panel and the pending-removals stack sit on the
  right edge, the stack directly above the panel. The stack keeps the same position whether the
  panel is open or closed. Their bounding boxes don't intersect the Playbar or the notice
  container's area, and they render above page content and below `Spicetify.PopupModal`'s overlay.
  No `e-[0-9]` class literal appears in `src/` (grep).

  _These are the **Right edge** rules. AC70's "on the right edge" means rules 1–4, including rule
  4's left-of-Playbar fallback. See the [panel-position spec](2026-09-27-panel-position-design.md),
  P15–P17, for the other positions._

**Data**

- **AC59**: For each source in **Investigation Findings → Artwork and track metadata paths**, given
  the listed field holds URL `U` (for labelled `album.images[]`, the `standard` entry, else the
  first), the produced `TrackRef.artworkUrl` equals `U`. Given the field is absent,
  `artworkUrl` is undefined.
- **AC64**: Given the collection-label lookup fails or returns no name, the panel displays a
  generic label from the collection type ("Playlist", "Album", "Artist") and the session starts and
  runs normally.
- **AC69**: Given a single-track session for a track whose `getTrack` lookup succeeds, the produced
  `TrackRef` carries that track's real name, its artist name(s) joined by ", ", and its artwork URL.
  Given the lookup fails, the name falls back to the URI's last segment, the artist to empty and
  `artworkUrl` to undefined, and the session still starts.

**Superseded / removed**

- **AC56**: While the panel is open, the per-track "`Title — Artist (i/N)`" notice (former AC38) is
  **not** shown. The end-of-session summary (AC41) and error notices are unchanged.
- **AC57**: No Playbar buttons are registered for a preview session (superseding AC33).
  `ui/playbarControls.ts` and `ui/playbarControls.test.ts` are deleted and unreferenced.

**Withdrawn ids** (not reused): AC54, AC62, AC63 (native track menu; Add to playlist deferred);
AC58 (row highlight kept); AC60 (no `PopupModal` takeover exists).

## Changes to the Shipped Spec's Criteria

From `2026-07-22-track-playlist-preview-design.md`:

- **Superseded:** AC33 → AC57 (panel controls, no Playbar buttons). AC38 → AC56 (per-track notice
  suppressed while the panel is open).
- **Amended:** AC8 and AC13: the "Playbar controls are (de)registered" clauses are struck. AC8 also
  gains "no panel opens" (AC46). Under AC13 the panel closes with `sessionEnded` (AC55).
- **Unchanged, and reachable again:** AC19, AC27, AC34, AC39, AC40, AC42, AC45. The original
  version of this spec retired or rescoped these because of the blocking modal. The panel makes that
  unnecessary.

All other shipped criteria are unchanged.

## Deferred Items

Filed against `Heyian/track-playlist-preview` on 2026-09-27:

- **#6**: Add to playlist from the preview panel.
  - *Context:* dropped from this iteration (see Investigation Findings: the native `TrackMenu` needs
    82 harvested React providers). Spotify's own row menu stays reachable during a session.
  - *Required:* either the native menu via provider harvesting behind a failure fallback, or a
    hand-built compact picker (`RootlistAPI.getContents` + `PlaylistAPI.add`, editable playlists only,
    with search).
  - *Integration points:* `ui/previewPanel`, `spotify/ports`, a new picker module.
  - *Priority:* medium. Revisit after the panel ships.
- **#7**: Un-like from Liked Songs (recorded in the remove spec).

Dropped from the original version's list (now moot): settings toggle to disable the modal (the
Playbar-only flow it restored no longer exists); non-blocking surface (done); restore mid-session
duration tuning (AC45 applies again); custom picker as a fallback for the native menu (folded into
the Add-to-playlist item above).

Explicitly not deferred (user's direction, unchanged): pause/resume of the current clip, a Previous
control, a seekable progress bar, a done screen at session end.

## Glossary Updates & ADRs

**Glossary:** no `CONTEXT.md`. Spec-local terms changed: **Preview modal → Preview panel** (renamed;
"modal" added to _Avoid_). Added **Pending-removals stack** and **Notice**. Removed **Native track
menu** and **Foreign takeover** (no longer part of the design).

**ADRs: none.** The original version planned `0002-preview-modal-native-trackmenu.md`. It is
cancelled: the panel lives in one UI module and restores rather than retires shipped criteria, so it
fails the hard-to-reverse criterion. The reasons for not using `PopupModal` or the native menu are
recorded in **Investigation Findings**. No conflict with ADR 0001.

---

## Config & Infrastructure Impact

Scanned: containers (none), CI/CD (none — no `.github/workflows`), IaC (none), env config (no env
vars), schemas (none), scripts (`scripts/cdp-eval.mjs` unchanged), API collections (none), settings
(no new key: `UNDO_WINDOW_MS` is a constant), build (`build.ts` unchanged; `.tsx` needs no config).

| File | Change needed |
| --- | --- |
| `src/types/domain.ts` | `TrackRef.artworkUrl?`; `PanelPort` + view-model; `AudioPort` elapsed accessor; `RemovePort`, `isExcluded` (remove spec). |
| `src/ui/previewPanel.tsx` | **New.** |
| `src/ui/previewPanel.view.ts` + `.test.ts` | **New.** Pure view-model helper. |
| `src/ui/pendingRemovalsStack.tsx` | **New.** |
| `src/pendingRemovals.ts` + `.test.ts` | **New** (remove spec), plus change subscription. |
| `src/previewController.ts` | Panel port, replacement branch, `next()`, suppress per-track notice, drop `playbar`, remove-spec additions. |
| `src/previewController.test.ts` | **New.** |
| `src/previewEngine.ts` + `.test.ts` | `isExcluded` (remove spec). |
| `src/collections/playlist.ts`, `likedSongs.ts`, `artist.ts` (+ tests) | Populate `artworkUrl`. |
| `src/spotify/fetchTrackRef.ts` | Switch to `getTrack`; extract a tested `parseGetTrack`. |
| `src/spotify/collectionLabel.ts` (+ test) | **New.** |
| `src/spotify/ports.ts` | Audio elapsed accessor; `playlistRemove`, `canRemove`. |
| `src/index.ts` | Wire panel, stack, label adapter, `pendingRemovals`; drop `playbar`. |
| `src/ui/playbarControls.ts`, `src/ui/playbarControls.test.ts` | **Delete.** |
| `README.md`, `CLAUDE.md`, `docs/specs/2026-07-22-…` | See Documentation Updates. |

## Manual Operator Steps

None. No credentials, consoles or cutovers. The live spikes are agent-runnable over CDP.

## Documentation Updates

| Doc | Change |
| --- | --- |
| `CLAUDE.md` | Architecture line: add `ui/previewPanel` and `pendingRemovals`. Add one non-obvious constraint: *never use `Spicetify.PopupModal` for an in-session surface; notices render beneath it (see the panel spec).* Keep the index ≤300 lines. |
| `README.md` | Document the preview panel (artwork, Stop/Next/Remove, shortcuts, Undo stack; Remove on editable playlists only) and the removal of the Playbar buttons. |
| `docs/specs/2026-07-22-…-design.md` | Back-annotate AC33/AC38 (superseded, pointer to AC57/AC56) and AC8/AC13 (Playbar clause struck), each pointing here. |
| `docs/specs/2026-09-26-remove-from-playlist-design.md` | Done with this revision: handed-over decisions recorded, "preview modal" → "preview panel". |

---

## Implementation Plan Guidance

One plan covers this spec **and** the remove spec (R1–R16). The plan must include every file in
both specs' Config & Infrastructure Impact tables and the spikes below.

**Live spikes first** (via `scripts/cdp-eval.mjs`; run node with the Bash sandbox disabled, since
fetch to `127.0.0.1:8088` fails inside it):

- (p1) Mount a plain React tree in a body-level root with `Spicetify.ReactDOM` (confirm `createRoot`
  vs. legacy `render` under v3). Confirm it renders above page content and below an open
  `PopupModal` overlay, and that `elementFromPoint` over the page outside the panel still returns
  page elements (AC65, AC70). Remove it in a `finally`.
- (p2) Confirm the CSS custom properties the panel will use resolve on `:root` (e.g.
  `--background-elevated-base`, `--text-base`, `--text-subdued`). Confirm the Playbar's and notice
  container's live bounding boxes for AC70.
- (p3) Confirm `Spicetify.GraphQL.Definitions.getTrack` resolves name, artists and cover art for a
  track URI (AC69).
- (r1) From the remove spec: URI-form `PlaylistAPI.remove` removes all duplicates. Use a throwaway
  playlist the agent creates and deletes. Never touch a user playlist.

The remove spec's spike (r2) is superseded: the Undo surface is our own stack, covered by p1.
If p1 shows a body-level root can't sit above the page or can't receive focus/keys, STOP and raise
it: the panel decision depends on it.

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
> 2. **Glossary application** — *Dropped: this repo has no `CONTEXT.md` glossary; terms are spec-local. Code must still use "panel", never "modal", for the preview surface.*
> 3. **ADR creation** — *Dropped: this spec creates no ADR (the planned ADR 0002 is cancelled) and surfaces no ADR conflict.*
> 4. **Deferred-item verification** — Add a task: *"Confirm every issue referenced in the 'Deferred Items' section exists and has all four required body sections (Context, Required, Integration Points, Priority)."* Run `gh issue view <#> --json body | jq -r .body` and grep for the four headings. Both items here are UNFILED by the user's choice: instead, *ask the user whether to file them before finishing the branch*; never auto-file.
> 5. **Config file tasks** — FOR EACH file listed in the spec's "Config & Infrastructure Impact" section, add one explicit task: *"Update `<path>`."*
> 6. **Manual Operator Steps** — *Dropped: none.*
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
> After the final build passes — and before wrapping up via `superpowers:finishing-a-development-branch` — if a cross-model review helper is available (e.g. the Codex plugin's adversarial review), run it with focus: *"Judge correctness against the spec's acceptance criteria (AC46–AC70 as listed in the preview-panel spec, the shipped-spec changes it lists, and R1–R16 of the remove spec) only. Do not flag anything outside the stated criteria — no design alternatives, hardening, or scope the spec did not claim."*
>
> This **never gates a merge** — the gate stays `bun run check` plus `bun run build`; the review only flags what deserves a second look. If no helper is available, finish the branch without it.
