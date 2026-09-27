# Track & Playlist Preview — Design Spec

**Date:** 2026-07-22
**Status:** Approved for planning
**Builds on:** Nothing. Repo had zero commits at design time. The only prior artifact is the
`previewTrack.js` prototype carried in the handoff document (never committed to this repo).

---

## Problem

Spotify removed the per-track "preview" button — the ~15s snippet playable without committing to
full playback — from playlist and Liked Songs views around mid-2026. There is no changelog entry;
the removal is corroborated only by Spotify Community threads. This extension restores that
capability and extends it to whole collections.

## Terms

Used consistently below and in code. (No `CONTEXT.md` glossary exists in this repo; these are
spec-local definitions.)

| Term | Meaning |
| --- | --- |
| **Preview clip** | The ~23–30s MP3 at a `p.scdn.co/mp3-preview/…` URL returned by `trackPreview`. |
| **Preview session** | One run of the engine over an ordered preview queue. Exactly one may be active. |
| **Collection** | A previewable container: playlist, Liked Songs, album, or artist. |
| **Collection adapter** | The per-type module turning a collection URI into an ordered `TrackRef[]`. |
| **Action bar** | The Play/Shuffle/Download/… row under a collection's cover art (`.main-actionBar-ActionBarRow`). |

_Avoid:_ "preview track" as a noun (ambiguous with the menu item); bare "queue" (collides with
Spotify's own playback queue) — say **preview queue** for the engine's ordered track list and
**playback queue** for Spotify's.

---

## Investigation Findings

All findings verified live against Spotify `1.2.92.147` / Spicetify `2.44.0` on 2026-07-22, driven
over the Chrome DevTools Protocol on `127.0.0.1:8088` (exposed because `always_enable_devtools = 1`).

### Defects in the prototype and the original handoff plan

1. **`Spicetify.Player.data.position` does not exist.** The field is `positionAsOfTimestamp`; the
   accessor is `Spicetify.Player.getProgress()`. The prototype's `data?.position ?? 0` therefore
   always evaluated to `0`, silently restoring every interrupted track to its beginning.
2. **Restoring with `playUri(trackUri)` destroys playback context and playback queue.** Live state carried
   `context.uri = spotify:playlist:…`, `index = {pageIndex: 0, itemIndex: 2}` and 50 `nextItems`;
   a bare track URI discards all of it.
3. **`spotify:playlist:…` parses as `Spicetify.URI.Type.PLAYLIST_V2` (`"playlist-v2"`), not
   `PLAYLIST`.** Gating a context-menu predicate on `URI.Type.PLAYLIST` means the item never
   appears. Use `Spicetify.URI.isPlaylistV1OrV2()`.
4. **`hm://playlist/v2/playlist/{id}/tracks` fails** with "Failed to fetch". The handoff document's
   preferred enumeration lead is dead. (`sp://core-playlist/…` also fails: "Resolver not found!".)

### The finding that reframes the design

`Spicetify.GraphQL.Definitions.trackPreview` exists and, called with a `uris` array, returns real
preview-clip URLs:

```js
await Spicetify.GraphQL.Request(
  Spicetify.GraphQL.Definitions.trackPreview,
  { uris: ["spotify:track:0QnjcR3CzjZAibq74RW02x"] }
);
// → data.lookup[].data.previews.audioPreviewsV2.items[].url
//   "https://p.scdn.co/mp3-preview/8ad3d50019bc5c57c7870e936cb83d2dc4aa7eb7"
```

Measured behaviour:

| Property | Measurement |
| --- | --- |
| Batch size tolerated | 343 URIs in one request (445 ms) |
| Coverage | 403 / 403 tracks across two playlists returned a preview |
| Response | HTTP 200, CORS-enabled, `audio/mpeg`, ~275 KB |
| Duration | 22.87 s, `readyState` 4 in a bare `<Audio>` element, no auth |

This removes the need to drive Spotify playback at all: no listening-history pollution, no Premium
requirement, and no snapshot/restore state machine.

### Verified enumeration paths

| Collection | Call | Notes |
| --- | --- | --- |
| Playlist | `Platform.PlaylistAPI.getContents(uri, {limit, offset})` | 163 ms; items carry `uri`, `isPlayable`, `isLocal`, `duration` |
| Album | `Platform.PlaylistAPI.getContents(uri, {limit, offset})` | Same call works on album URIs |
| Liked Songs | `Platform.LibraryAPI.getTracks({limit, offset})` | `PlaylistAPI` on `spotify:collection:tracks` errors "Invalid playlist response!" |
| Artist | `GraphQL.Request(Definitions.queryArtistOverview, {uri, locale: "", includePrerelease: true})` | `data.artistUnion.discography.topTracks.items[].track.uri` — **10 tracks only** |

### Action-bar injection anchor

`.main-actionBar-ActionBarRow` is present on **all four** page types (playlist, `/collection/tracks`,
album, artist) and is unique per page. It is a Spicetify-maintained `main-*` semantic class, not a
hashed Spotify class, so it is markedly more durable than the alternatives.

Row children in order: `.main-actionBar-ActionBarPlayButtonContainer`, then tertiary buttons
(Shuffle, Download, …), then the search-box container.

Buttons carry the stable attribute `data-encore-id="buttonTertiary"`. Their class list
(`e-10451-legacy-button …`) embeds an **encore version number that will change** across Spotify
updates, so styling must be taken by cloning `className` from a live sibling at injection time —
never hardcoded.

---

## Architecture

Audio is produced entirely by an `<Audio>` element fed from `trackPreview`. Spotify's player is
touched only to pause on session start and resume on session end.

### Modules

Adapters are the only modules permitted to reference Spotify or Spicetify globals; everything below
the adapter line is pure and unit-testable without a running client.

| Module | Responsibility | Depends on |
| --- | --- | --- |
| `previewSource` | Resolve `TrackRef[]` → preview URLs. Batches via `trackPreview`, caches by URI, returns `null` for tracks with no clip. | `Spicetify.GraphQL` |
| `collections/` | One adapter per collection type behind a shared `enumerate(uri, {limit, offset})` interface; paginates lazily. | `Platform.PlaylistAPI`, `Platform.LibraryAPI`, `Spicetify.GraphQL` |
| `previewEngine` | Pure session state machine `idle → previewing(previewQueue, index) → idle`. Emits `trackStarted`, `trackSkipped`, `sessionEnded`. Owns no DOM and no Spotify calls. | — (injected audio + timer ports) |
| `playerCoordinator` | The **only** module that pauses/resumes Spotify. Never seeks, never changes context. | `Spicetify.Player` |
| `settings` | Typed settings with defaults, persisted in `Spicetify.LocalStorage`. | `Spicetify.LocalStorage` |
| `ui/actionBarButton` | Injects and maintains the action-bar button. | DOM, `Platform.History` |
| `ui/playbarControls` | Registers/deregisters Skip and Stop. | `Spicetify.Playbar` |
| `ui/contextMenus` | Track and collection context-menu items. | `Spicetify.ContextMenu`, `Spicetify.URI` |
| `ui/rowHighlight` | Highlights the currently-previewing row. | DOM |
| `ui/settingsModal` | Settings UI. _Superseded by `ui/settingsSection` — see S5/S12 of [the Settings-page spec](2026-09-27-settings-page-design.md)._ | `Spicetify.PopupModal`, `Spicetify.React` |

### Data flow

```
entry point (action bar | context menu)
  → collections.enumerate(uri)        → TrackRef[]  (canonical order)
  → previewEngine.start(previewQueue, index)
      ├→ previewSource.resolve(batch) → url | null
      ├→ playerCoordinator.pause()    (once, at session start)
      ├→ audio.play(url) … 15s … next
      └→ sessionEnded → playerCoordinator.resume() + summary Snackbar
```

`previewSource` resolves a window ahead of playback (batch of 100, refill when fewer than 10 remain
unresolved) so a 397-track collection is never resolved upfront.

### Behaviour

- **Duration:** configurable, default 15 000 ms, clamped to the clip's own length.
- **Order:** canonical stored order. The page's sort dropdown and search filter are ignored.
- **Feedback:** a Snackbar per track (`Title — Artist (3/30)`) plus a highlight on the current
  track's row whenever that row is rendered in the track list.
- **Missing clips:** skipped immediately and counted; one summary Snackbar at session end.
- **Controls:** Playbar Skip and Stop buttons registered on session start, deregistered on end;
  the action-bar button doubles as a stop toggle.
- **Session scope:** one session at a time. Starting a new one replaces the running one. A session
  survives navigation (audio is decoupled from the page); only the row highlight is page-bound.
- **Entry points:** action-bar button on all four collection types; collection context menu;
  track context menu with *Preview track (15s)* and *Preview from here*.
- **Settings:** opened from a `Spicetify.Menu.Item` in the profile dropdown. Toggles per collection
  type (playlist / Liked Songs / album / artist), preview duration, inter-track gap.
  _Superseded: settings now live on the Spicetify Settings page — S5/S12 of
  [the Settings-page spec](2026-09-27-settings-page-design.md)._

### Design constraints

Not all of these are expressible as observable acceptance criteria, but violating any of them is a
defect:

1. **Never hardcode an encore version string.** Class names of the form `e-10451-legacy-button…`
   embed a version that changes across Spotify updates. Button styling must be read from a live
   sibling `[data-encore-id="buttonTertiary"]` at injection time. A grep for `e-[0-9]` in `src/`
   must return nothing.
2. **Never copy a GraphQL `sha256Hash` into source.** Read operations from
   `Spicetify.GraphQL.Definitions` at runtime so a rotated hash self-heals — see ADR 0001.
3. **`playerCoordinator` is the only module that may call `Spicetify.Player`,** and only `pause`
   and `resume`. No other module imports it.
4. **`previewEngine` must not reference `Spicetify`, `window`, or `document`** — audio and timer
   access arrive as injected ports, which is what makes AC12–AC21 unit-testable.

### Error handling

| Condition | Behaviour |
| --- | --- |
| `trackPreview` request fails | Abort session, Snackbar "Preview unavailable — Spotify API error". Resume Spotify only if it was playing before the session started. |
| Clip URL 404s or `<Audio>` errors | Treat as a missing clip: count and skip, advancing immediately. |
| Enumeration returns empty | Snackbar "Nothing to preview"; no session starts. |
| Action bar not found, or no tertiary sibling to copy styling from | Skip injection silently; retry on next navigation. |
| Spotify paused before session start | Do not resume at end. |

### Testing

`previewEngine`, `previewSource` and the collection adapters are pure given injected ports and are
unit-tested with **Vitest** (added as a devDependency — see Config Impact). Adapter and UI modules
are verified manually in the running client; the CDP harness used during investigation
(`Runtime.evaluate` against `127.0.0.1:8088`) is the practical mechanism and should be committed as
a dev script.

Vitest is confirmed and already installed as a devDependency; `bun run check` (typecheck + tests)
passes and is the quality gate. Tests are derived from AC1–AC45.

---

## Acceptance Criteria

Session-lifecycle terms used below: a session **terminates** when its preview queue is exhausted,
when the user stops it, when it is replaced by a new session, or when it aborts on error.

**Enumeration**

- **AC1** — Given a playlist URI, `collections.enumerate` returns track URIs preserving the
  playlist's stored relative order; the returned count equals the number of eligible track entries
  remaining after the AC6 exclusions.
- **AC2** — Given a collection larger than 100 tracks, enumeration paginates and returns every
  eligible track (verified against a 397-track playlist).
- **AC3** — Given `spotify:collection:tracks`, enumeration calls `LibraryAPI.getTracks` and returns
  every eligible track URI in the API's response order.
- **AC4** — Given an album URI, enumeration returns the album's tracks in disc/track order.
- **AC5** — Given an artist URI, enumeration returns every track supplied by the artist top-tracks
  response, each exactly once and in response order. No fixed count is assumed.
- **AC6** — Non-track items (podcast episodes, unavailable entries) are excluded from the returned
  preview queue.
- **AC7** — For every collection type, the preview queue's order and membership are unaffected by
  the page's active sort order or search filter.
- **AC8** — Given enumeration produces no eligible tracks, a "Nothing to preview" Snackbar is shown
  and no session starts: Spotify is not paused, no audio plays, and no panel opens. *(Amended by
  `2026-07-25-preview-modal-design.md` AC46: the "Playbar controls are registered" clause is struck
  and replaced with "no panel opens".)*

**Preview source**

- **AC9** — Each `trackPreview` GraphQL operation carries at most 100 URIs. Resolving more than 100
  inputs partitions them into multiple operations while returning exactly one result per input,
  order-aligned with the input.
- **AC10** — A track with no `audioPreviewsV2` entry resolves to `null` rather than raising.
- **AC11** — Until the extension reloads or its cache is explicitly cleared, repeated resolutions of
  the same URI reuse the cached result and cause at most one `trackPreview` operation containing
  that URI.
- **AC12** — Given a 397-track collection, the first preview begins playing before every track in
  the collection has had its clip URL resolved.
- **AC13** — Given a `trackPreview` request fails, the session aborts: preview audio halts, a
  "Preview unavailable — Spotify API error" Snackbar is shown, the panel closes with
  `sessionEnded`, and Spotify is resumed if and only if it was playing before the session started.
  *(Amended by `2026-07-25-preview-modal-design.md` AC55: the "Playbar controls are deregistered"
  clause is struck and replaced with "the panel closes with `sessionEnded`".)*

**Engine**

- **AC14** — Given a session started on a preview queue of N tracks, the engine advances to track
  *i+1* after the configured duration elapses.
- **AC15** — When a clip is shorter than the configured duration, the engine advances at the clip's
  natural end rather than waiting out the timer.
- **AC16** — `skip()` advances to the next track immediately and cancels the pending timer.
- **AC17** — `stop()` returns the engine to `idle` and halts audio within 100 ms.
- **AC18** — When the preview queue is exhausted the engine returns to `idle` and emits
  `sessionEnded`.
- **AC19** — Starting a session while one is active terminates the first; exactly one session is
  ever active.
- **AC20** — A track resolving to `null` never emits `trackStarted` and never starts audio; it
  emits a skip, increments the skipped count, and proceeds to the next eligible track.
- **AC21** — Given a clip URL returns 404 or the `<Audio>` element raises an error, the track is
  counted and skipped under the same rules as AC20 and is included in the final skipped count.
- **AC22** — Given a zero-based start index *k* where `0 ≤ k < N`, previewing begins at preview
  queue entry *k* and continues through entry *N−1*. Given *k* outside that range, no session
  starts and the engine remains `idle`.
- **AC23** — The configured inter-track gap is applied only after a preview completes normally —
  duration expiry (AC14) or natural clip end (AC15). It is **not** applied after a manual skip
  (AC16), a missing clip (AC20), or a clip error (AC21); those advance immediately. With a gap of
  0 ms, normal completion also advances immediately.

**Player coordination**

- **AC24** — Given Spotify is playing when a session starts, the player is paused exactly once.
- **AC25** — Given Spotify was playing before previewing began, it is resumed exactly once when
  previewing finally terminates — except that replacement performs no resume (AC27).
- **AC26** — Given Spotify was paused when a session starts, it is never resumed.
- **AC27** — Replacing an active session transfers ownership of the existing pause to the new
  session: Spotify is neither resumed nor paused a second time at the moment of replacement, and is
  restored only when the replacing session terminates.
- **AC28** — Across a full session the playback context URI, playback queue length and track
  position are unchanged — `playerCoordinator` issues no `seek`, `playUri` or context mutation.

**UI**

- **AC29** — Given a collection type is enabled in settings and the page's
  `.main-actionBar-ActionBarRow` contains a `[data-encore-id="buttonTertiary"]` sibling, exactly one
  preview button is present in that row. This holds for playlist, Liked Songs, album and artist
  pages.
- **AC30** — When a collection type is disabled in settings, no button is injected on its pages.
- **AC31** — After navigating away from and back to an eligible collection page, that page's action
  bar contains exactly one preview button; navigation never produces duplicates.
- **AC32** — The injected button's `className` equals that of the `[data-encore-id="buttonTertiary"]`
  sibling it was copied from, and contains no encore version string written in source. Given the
  action bar is absent, or present with no such sibling, no button and no error UI appear, and
  injection is attempted again on the next navigation.
- **AC33** — *Superseded by `2026-07-25-preview-modal-design.md` AC57: no Playbar buttons are
  registered for a preview session; the preview panel provides Skip/Stop instead.* ~~Skip and Stop
  Playbar buttons are registered while a session is active and absent when idle.~~
- **AC34** — Clicking the action-bar button during an active session on the same collection
  terminates the session.
- **AC35** — Given a collection type is enabled, the collection context-menu item appears for that
  type's URIs — playlist (which parse as `playlist-v2`), Liked Songs, album and artist. Given the
  type is disabled, the item is absent for that type.
- **AC36** — The track context menu offers *Preview track (15s)*, which starts a single-track
  preview session, and *Preview from here*, which starts a session at that track within its
  containing collection.
- **AC37** — *Preview from here* invoked outside a collection context falls back to a single-track
  preview.
- **AC38** — *Superseded by `2026-07-25-preview-modal-design.md` AC56: while the panel is open, this
  per-track Snackbar notice is suppressed.* ~~When each preview starts, a Snackbar shows
  `Title — Artist (i/N)`, where *i* is the track's one-based index in the preview queue and *N* is
  that queue's total length.~~
- **AC39** — While a session is active, the currently previewed track's row is highlighted whenever
  that row is rendered on its collection page. Navigating away removes the highlight from the
  departed page, and session termination removes all highlighting.
- **AC40** — Given a session is active, navigating to another page does not interrupt it: preview
  audio continues and the engine keeps advancing through the preview queue.
- **AC41** — Whenever a session terminates by any cause, a summary Snackbar reports the skipped
  count if that count is greater than zero.

**Settings**

- **AC42** — The settings modal is reachable from a `Spicetify.Menu.Item` in the profile dropdown,
  and exposes preview duration, inter-track gap, and one toggle per collection type.
  _Superseded by S5/S12 of [the Settings-page spec](2026-09-27-settings-page-design.md)._
- **AC43** — Settings persist across a Spotify restart.
- **AC44** — With no stored settings, defaults apply: 15 000 ms duration, 0 ms gap, all four
  collection types enabled.
- **AC45** — Changing the duration mid-session applies from the next track onward, without
  interrupting the current one.

## Deferred Items

Filed against `Heyian/track-playlist-preview`:

- #1 — Preview should follow the visible sorted/filtered order
- #2 — Optional full-playback fallback for tracks with no preview clip
- #3 — Package for the Spicetify Marketplace

Resolved during design rather than deferred: migrating off `spicetify-creator`. Its JSR successor
`@spicetify/bundler` is archived and Deno-only, so the build was moved to a local Bun bundler
script (`build.ts`) before any feature code existed. See **Build & Runtime Notes**.

## Glossary Updates & ADRs

**Glossary:** no `CONTEXT.md` exists in this repo, so no glossary was updated. Spec-local terms are
defined in **Terms** above.

**ADRs created:**

- `docs/adr/0001-preview-audio-via-trackpreview-graphql.md` — basing all preview audio on the
  undocumented `trackPreview` GraphQL operation rather than driving `Spicetify.Player`.

**ADR conflicts surfaced:** none — `docs/adr/` was empty before this design.

---

## Config & Infrastructure Impact

Scanned: containers (none), CI/CD (none — no `.github/workflows`), IaC (none), env config (none —
the extension has no env vars), schemas (none), scripts, API collections (none), agent index.

The build toolchain was migrated during design; the table records both what changed and what the
implementation still needs to do.

| File | Change needed | Status |
| --- | --- | --- |
| `package.json` | Bun scripts (`build`, `build:local`, `watch`, `test`, `typecheck`, `check`); `vitest` + `typescript` + `@types/bun` as devDependencies; `spicetify-creator` removed | **Done** |
| `build.ts` | New. Bun bundler: aliases `react`/`react-dom` to `Spicetify.React`/`ReactDOM`, inlines CSS, wraps in the wait-for-Spicetify IIFE, writes to the Extensions dir | **Done** |
| `tsconfig.json` | ESNext + `moduleResolution: bundler`, `noEmit`, `types: ["bun"]`, stricter flags | **Done** |
| `src/index.ts` | New entry point, replacing the `spicetify-creator` example `src/app.tsx` | **Done** (skeleton) |
| `src/settings.json` | Deleted — a `spicetify-creator` manifest with no meaning to the Bun build | **Done** |
| `src/types/css-modules.d.ts` | Added a plain `*.css` module declaration for non-module CSS imports | **Done** |
| `.gitignore` | Added `dist/` and `.bun-build/` | **Done** |
| `README.md` | Replaced the upstream `spicetify-creator` README with project documentation | **Done** |
| `LICENSE` | MIT, added | **Done** |
| `vitest.config.ts` | Not yet needed; add only if the default include globs prove insufficient | Pending |
| `scripts/cdp-eval.mjs` | Commit the CDP harness used during investigation as a dev tool | Pending |
| `CLAUDE.md` | Module map, Bun commands, preview-source constraint (see Documentation Updates) | Pending |

No new environment variables are introduced. `bun run test` passes `--passWithNoTests` so `check`
stays green until the first test lands.

## Documentation Updates

| Doc | Change |
| --- | --- |
| `CLAUDE.md` | Replace the "bare scaffold" note with a ≤3-sentence architecture summary and a pointer row to this spec. Add a 1-line entry for the CDP dev script. Keep the index under 300 lines. |
| `README.md` | Currently the upstream `spicetify-creator` README. Replace with project documentation: what the extension does, install steps, settings, and the known caveat that `trackPreview` is internal API. |
| `docs/adr/0001-…` | Created by this design (see Glossary Updates & ADRs). |

---

## Implementation Plan Guidance

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
> 2. **Glossary application** — *Dropped: this repo has no `CONTEXT.md` glossary, and the spec's "Glossary Updates & ADRs" section lists no new or changed glossary terms.*
> 3. **ADR creation** — FOR EACH ADR listed in the spec, add a task: *"Create `docs/adr/NNNN-<slug>.md` following sequential numbering (start at `0001-` if the directory is empty)."* IF the spec lists ADR conflicts surfaced, also add a task: *"Update the conflicting ADR's status (superseded / amended) and link to the new ADR."*
> 4. **Deferred-item verification** — Add a task: *"Confirm every issue referenced in the 'Deferred Items' section exists and has all four required body sections (Context, Required, Integration Points, Priority)."* Run `gh issue view <#> --json body | jq -r .body` and grep for the four headings. Issues to check: #1, #2, #3.
> 5. **Config file tasks** — FOR EACH file listed in the spec's "Config & Infrastructure Impact" section, add one explicit task: *"Update `<path>`."*
> 6. **Docs update tasks** — FOR EACH entry in the spec's "Documentation Updates" section, add one explicit task: *"Update `<doc-path>`."* Design content goes in the docs dir, not the agent index; the index gets at most a 1-line pointer, a ≤3-sentence area summary, or a 1-line command/env-var entry.
> 7. **Post-implementation check** — Add as the second-to-last task: *"Verify every Required Task above was actually executed — config files updated, docs written, glossary entries applied, ADRs created."* Read the diff; don't trust plan markings.
> 8. **Final build task** — Add as the last task: *"Run `bun run build` and fix any issues until it builds successfully."* Non-negotiable — type-checks and tests alone do not catch all build-time failures.
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
> After the final build passes — and before wrapping up via `superpowers:finishing-a-development-branch` — if a cross-model review helper is available (e.g. the Codex plugin's adversarial review), run it with focus: *"Judge correctness against the spec's acceptance criteria (AC1–AC45) only. Do not flag anything outside the stated criteria — no design alternatives, hardening, or scope the spec did not claim."*
>
> This **never gates a merge** — the gate stays `bun run check` plus `bun run build`; the review only flags what deserves a second look. If no helper is available, finish the branch without it.

**Note for the plan author:** `bun run check` (typecheck + tests) already exists and passes. There
is no linter configured in this repo, so `check` is the whole quality gate.

---

## Build & Runtime Notes

- The build is a local Bun script, `build.ts`. `spicetify-creator` was removed during design: it is
  explicitly deprecated by its own README, and its JSR successor `@spicetify/bundler` is archived,
  Deno-only (`runtimeCompat.node: false`) and has zero dependents.
- `bun run build` writes straight into `~/.config/spicetify/Extensions/`; `spicetify apply` is
  required afterwards for the client to pick up changes. `bun run build:local` writes to `dist/`.
- The bundler does not typecheck. A green build proves nothing about types — `bun run check` runs
  `tsc --noEmit` and the tests.
- `react` / `react-dom` are aliased to `Spicetify.React` / `Spicetify.ReactDOM` by a Bun plugin in
  `build.ts`. Import them normally; never add them as dependencies. Verified: a probe bundle
  importing React resolved both aliases and bundled no React runtime.
- Imported CSS is inlined into the output JS and injected as a `<style>` tag — a sibling `.css`
  file would never be loaded by Spicetify.
- `build.ts` wraps output in a loop awaiting `Spicetify.React`, `Spicetify.ReactDOM` and
  `Spicetify.Platform`. Other namespaces (`Playbar`, `ContextMenu`, `GraphQL`) still need checking
  before use.
