# View Order — Design Spec

**Date:** 2026-09-28
**Status:** Approved design — spec pending review
**Issue:** #1 — Preview should follow the visible sorted/filtered order
**Builds on:** [`2026-07-22-track-playlist-preview-design.md`](2026-07-22-track-playlist-preview-design.md),
which fixed the preview queue to the collection's stored order (the **Order** bullet, AC1, AC3, AC7)
and deferred this work to #1. Also touches the unload teardown
([`2026-09-27-unload-teardown-design.md`](2026-09-27-unload-teardown-design.md)) only to confirm
nothing new needs tearing down. Criteria here are numbered **V1…** so they cannot collide with
AC1–AC70, R1–R16, S1–S18, P1–P20 or U1–U31.

---

## Problem

A preview session walks a collection in its stored order. Playlist pages and Liked Songs have a
sort dropdown and a "Search in playlist" filter. A user who filters a playlist to `live` and presses
**Preview all** expects to hear the filtered tracks in the order shown, and instead hears the whole
playlist in stored order. "Preview from here" is worse: on a sorted page it starts at the clicked
track's position in the *stored* order, so the tracks that follow are not the ones below the row.

## Terms

- **View order** — the order and membership of tracks a collection page shows: the saved sort
  applied to the collection, narrowed by the page filter.
- **Saved sort** — the sort the user picked for a collection in its sort dropdown. Spotify persists
  it per collection. "Custom order" is the absence of a saved sort.
- **Page filter** — the text in the collection page's "Search in playlist" box. It exists only
  while that page is open.
- **View options** — `{ sort?: { field, order }, filter?: string }`, the values passed to
  `PlaylistAPI.getContents` to reproduce the view order.

## Investigation Findings

Verified live on Spotify 1.2.96 over the debug port (`scripts/cdp-eval.mjs`) and in
`/opt/spotify/Apps/xpui/xpui-modules.js`.

1. **`PlaylistAPI.getContents(uri, opts)` sorts and filters.** Its query builder reads `sort`,
   `filter`, `attributeFilter`, `descriptorFilter`, `rowId`, `offset`, `limit`.
   - `sort` is `{ field, order }`. `field` ∈ `TITLE`, `ADDED_BY`, `ADDED_AT`, `ARTIST`, `ALBUM`,
     `DURATION`, `SHOW_NAME`, `PUBLISH_DATE`; `order` is `"ASC"` / `"DESC"`, default ASC.
   - **An unknown `field` is ignored silently** — `NAME`, `ARTIST_NAME` return stored order, no error.
   - `filter` is a string (or `{ value }`), trimmed, case-insensitive, matching title, artist and
     album. `totalLength` reflects the filtered count (`"love"` → 2 of 150).
   - Sort and filter combine in one call.
2. **Spotify's own playback uses the same path.** `PlayerAPI.play` routes playlists and Liked Songs
   through `context.playlistQueryOptions`, built by the same query builder, and the page passes its
   current `{ sort, filter }`. So `getContents(uri, { sort, filter })` reproduces the view order by
   construction; no DOM scraping of the virtualised list (~33 rows rendered) is needed.
3. **The saved sort** is `Spicetify.Platform.LocalStorageAPI.getItem("sortedState")` (backed by
   localStorage key `<username>:sortedState`): one map `{ [uri]: { field, order } }` for all
   collections. "Custom order" deletes the key. Menu → value: Title `TITLE` ASC, Artist `ARTIST` ASC,
   Album `ALBUM` ASC, Recently added `ADDED_AT` DESC, Release date `PUBLISH_DATE` DESC, Duration
   `DURATION` ASC; clicking the same option again flips `order`. Writing the map re-renders the page
   in the new order.
4. **The page filter** is not in the URL and no API exposes it. It is readable from the DOM at
   `.main-view-container input.x-filterBox-filterInput` (present on playlist pages and Liked Songs),
   or from React fiber props (`contentsOptions.filter`). It is empty on other pages and restored when
   returning to the same playlist within a run.
5. **Albums and artist pages have no sort or filter** for their track lists.
6. **`LibraryAPI.getTracks` cannot reproduce Liked Songs' view.** Its sort uses different field
   names (`NAME`, `ARTIST_NAME`, `ALBUM_NAME`, `ADDED_AT`); its `filters` option returns 0 items for
   every input tried; `totalLength` is always 0. **Liked Songs is a list-platform playlist:**
   `Spicetify.Platform.LibraryAPI._likedSongsUri` is a per-account `spotify:playlist:…` URI, and
   `getContents` on it sorts and filters correctly. Its saved sort is keyed by that URI. With no
   saved sort the page shows "Recently added" and uses the list's natural order.

## Decisions

| # | Question | Decision |
| --- | --- | --- |
| Q1 | Page changes after a preview starts | **Lock at start.** View options are read once; later sort/filter changes or navigation do not touch the queue. |
| Q2 | Panel marker for a filtered queue | **Counts only** ("4/12"), no marker. |
| Q3 | Setting to restore stored order | **No setting.** "Custom order" plus an empty filter gives the stored order. |
| Q4 | Which entry points follow the page | **Saved sort everywhere; page filter only when the previewed collection is the open page.** Applies to **Preview all**, the collection context menu and **Preview from here**. |
| Q5 | Liked Songs | **Enumerate the internal playlist URI** (`_likedSongsUri`) through `getContents`; fall back to `LibraryAPI.getTracks` without view options when the field is missing. |
| Q6 | Reading the page filter | **DOM filter box**, scoped to `.main-view-container`. |
| Q7 | Unknown sort field | **Pass through unchanged**; no allow-list. |

## Design

### `collections/viewOrder.ts` (new, pure)

```ts
export interface ViewOptions {
  sort?: { field: string; order?: "ASC" | "DESC" };
  filter?: string;
}

export interface ViewOrderDeps {
  readSortedState(): unknown;            // the raw sortedState map; may throw
  likedSongsPlaylistUri(): string | null; // _likedSongsUri, or null
  currentCollectionUri(): string | null;  // the open page's collection URI
  readFilterText(): string | null;        // the filter box value, or null when absent
}

export function createViewOrder(deps: ViewOrderDeps): {
  viewFor(uri: string, type: CollectionType): ViewOptions;
};
```

- Returns `{}` for `album` and `artist`.
- **Sort key:** the playlist URI itself; for `likedSongs`, `likedSongsPlaylistUri()` (no sort when
  it is null). The entry is used only when it is an object whose `field` is a non-empty string;
  `order` is kept only when it is `"ASC"` or `"DESC"`. A throwing or non-object `readSortedState()`
  yields no sort.
- **Filter:** only when `currentCollectionUri() === uri` (the URI the user previewed, so Liked Songs
  compares `spotify:collection:tracks`), and only when the trimmed text is non-empty.

No `Spicetify` global is referenced; the four readers are injected.

### `collections/index.ts`, `collections/playlist.ts`

- `enumerate(uri, deps, classify, view?: ViewOptions)`.
- `enumeratePlaylistContents(uri, api, view?)` adds `sort` / `filter` to every `getContents` page
  request when present, and omits the keys when absent (so a call with no view is byte-identical to
  today's).
- `PlaylistContentsApi.getContents`'s options type gains the optional `sort` and `filter`.
- `CollectionDeps` gains `likedSongsPlaylistUri(): string | null`. For `likedSongs`: when it returns
  a URI, enumerate that URI through `enumeratePlaylistContents` with the view; otherwise call
  `enumerateLikedSongs(libraryApi)` as today and ignore the view.
- `album` passes no view; `artist` is unchanged.

### `spotify/ports.ts` (adapter bindings)

- `readSortedState`: `Spicetify.Platform.LocalStorageAPI.getItem("sortedState")`.
- `likedSongsPlaylistUri`: `Spicetify.Platform.LibraryAPI._likedSongsUri` when it is a string that
  starts with `spotify:playlist:`, else `null`.
- `readFilterText`: `document.querySelector(".main-view-container input.x-filterBox-filterInput")?.value ?? null`.
- `src/types/spicetify.d.ts` gains the members read above if they are not typed yet.

### Wiring (`src/index.ts`)

```ts
enumerate: (uri) => enumerate(uri, collectionDeps, classify, viewOrder.viewFor(uri, classify(uri))),
```

`viewFor` runs when `enumerate` is called — at session start — which is what locks the queue (Q1).
`previewController`, `previewEngine`, the panel and the pending-removals stack do not change. The
session's collection URI stays the URI the user previewed (`spotify:collection:tracks` for Liked
Songs), so the action-bar toggle, labels and Remove behave as before.

### Unload

Everything is read on demand; no listener, observer or subscription is added, so `dispose()` and its
rollback gain no step.

## Acceptance Criteria

**Saved sort**

- **V1** — Given `sortedState[P]` is `{ field: F, order: O }` (O ∈ ASC/DESC) for playlist URI P,
  when a preview of P starts from **Preview all**, the collection context menu, or **Preview from
  here**, every `getContents(P, …)` page request carries `sort: { field: F, order: O }`.
- **V2** — Given `sortedState` has no entry for P, `getContents(P, …)` is called with no `sort` key,
  and the preview queue is in P's stored order.
- **V3** — Given `sortedState[P].field` is a string not in the known field list, it is passed to
  `getContents` unchanged.
- **V4** — Given `sortedState[P]` is not an object, has a `field` that is not a non-empty string, or
  reading `sortedState` throws, no `sort` is passed and the preview starts normally.
- **V5** — Given `sortedState[P].order` is neither `"ASC"` nor `"DESC"`, `sort` is passed with
  `field` only.

**Page filter**

- **V6** — Given the open page's collection URI equals P and the filter box holds text T whose
  trimmed form T′ is non-empty, every `getContents(P, …)` page request carries `filter: T′`.
- **V7** — Given the open page's collection URI is not P (preview started from the sidebar menu
  while another page — filtered or not — is open), no `filter` is passed.
- **V8** — Given the filter box is absent or its trimmed value is empty, no `filter` is passed.
- **V9** — Given P has both a saved sort and a page filter, one `getContents` request carries both,
  and the preview queue equals, in order, the tracks the page lists (verified live).

**Liked Songs**

- **V10** — Given `LibraryAPI._likedSongsUri` is a `spotify:playlist:…` URI L, a preview of
  `spotify:collection:tracks` enumerates via `getContents(L, …)` with `sort` from `sortedState[L]`
  and `filter` per V6–V8 (compared against `spotify:collection:tracks`), and `LibraryAPI.getTracks`
  is not called.
- **V11** — Given `_likedSongsUri` is missing or not a `spotify:playlist:…` string, enumeration uses
  `LibraryAPI.getTracks` exactly as before, with no sort or filter, and the preview starts.
- **V12** — During a Liked Songs session, the session's collection URI is
  `spotify:collection:tracks`: the Liked Songs action-bar button reads "Stop preview" and the panel
  source label is unchanged from before this change.

**Albums and artists**

- **V13** — For album and artist URIs, enumeration requests are identical to before this change
  regardless of any `sortedState` entry or filter-box text.

**Session behaviour**

- **V14** — View options are read once per session start. Given a session has started, changing
  the saved sort, editing the page filter, or navigating away does not change the preview queue's
  order, membership, or total.
- **V15** — Given a sorted and/or filtered page, **Preview from here** on a row starts at that
  track's index in the view-order queue, and the next tracks previewed are the rows below it on the
  page.
- **V16** — Given **Preview from here** on a track not in the view-order queue, a single-track
  preview starts (AC37 unchanged).
- **V17** — Given a page filter that matches no eligible track, "Nothing to preview" is shown and no
  session starts (AC8 unchanged): Spotify is not paused and no panel opens.
- **V18** — The panel's source text total equals the view-order queue's length; no filter marker is
  shown.
- **V19** — Given a sorted playlist with more than 100 eligible tracks, enumeration pages through
  `getContents` with the same `sort` on every page and returns every eligible track exactly once.

**Code constraints**

- **V20** — `collections/viewOrder.ts` and every file under `collections/` reference no `Spicetify`
  global and no `document`; only `spotify/ports.ts` reads `LocalStorageAPI`, `_likedSongsUri` and
  the filter box.
- **V21** — No listener, observer or subscription is added; `node scripts/check-unload.mjs` passes.
- **V22** — No new setting is stored or shown on the Settings page.

### Amendments to the v1 spec

- **Order** bullet → "the collection's view order (see `2026-09-28-view-order-design.md`)".
- **AC1** → "…preserving the playlist's view order (stored order when there is no saved sort and no
  page filter)…".
- **AC3** → "…enumerates Liked Songs via its internal playlist URI (V10), falling back to
  `LibraryAPI.getTracks` (V11)…".
- **AC7** → struck; superseded by V1–V13.

## Deferred Items

None — live-follow of page changes (Q1 B) and a stored-order setting (Q3 B) were rejected, not
deferred.

## Glossary Updates & ADRs

- No `CONTEXT.md` exists; the terms **view order**, **saved sort**, **page filter** and **view
  options** are defined in **Terms** above.
- No ADR: every choice is cheap to reverse (read-only, no stored data, no public interface).
- No conflict with ADR 0001 (preview audio still comes from `trackPreview`).

## Config & Infrastructure Impact

Scanned: no `Dockerfile`, CI (`.github/` absent), IaC, env files, schemas or API collections exist.
`package.json` scripts, `metadata.json` generation and `build.ts` are unaffected; no new dependency.
`scripts/check-unload.mjs` is unchanged (V21 only runs it).

None.

## Manual Operator Steps

None — the live verification of V9, V10 and V15 uses the debug port, which already answers on
`127.0.0.1:8088`.

## Documentation Updates

| Doc | Change |
| --- | --- |
| `docs/specs/2026-07-22-track-playlist-preview-design.md` | Apply the **Amendments to the v1 spec** above, each with a pointer to this spec; mark #1 resolved under Deferred Items. |
| `docs/spicetify-v3-platform.md` | Add a short "Spotify Platform APIs" section recording findings 1, 3, 4 and 6 (with a pointer here for detail). |
| `CLAUDE.md` | One pointer row under **Documentation**: `View-order spec — sort and filter in the preview queue, criteria V1–V22.` |

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
> 2. **Deferred-item verification** — Add a task: *"Confirm every issue referenced in the 'Deferred Items' section exists and has all four required body sections (Context, Required, Integration Points, Priority)."* Run `gh issue view <#> --json body | jq -r .body` and grep for the four headings.
> 3. **Config file tasks** — FOR EACH file listed in the spec's "Config & Infrastructure Impact" section, add one explicit task: *"Update `<path>`."*
> 4. **Manual Operator Steps** — IF the spec's "Manual Operator Steps" section is non-empty, add a task ahead of every task that depends on those values existing: *"Hand the operator the Manual Operator Steps and wait for confirmation; if a wizard-generation skill is available, generate the script first."* The agent never performs these steps itself and never substitutes a placeholder credential to unblock itself.
> 5. **Docs update tasks** — FOR EACH entry in the spec's "Documentation Updates" section, add one explicit task: *"Update `<doc-path>`."* Design content goes in the docs dir, not the agent index; the index gets at most a 1-line pointer, a ≤3-sentence area summary, or a 1-line command/env-var entry.
> 6. **Post-implementation check** — Add as the second-to-last task: *"Verify every Required Task above was actually executed — config files updated, docs written, glossary entries applied, ADRs created."* Read the diff; don't trust plan markings.
> 7. **Final build task** — Add as the last task: *"Run `bun run build` and fix any issues until it builds successfully."* Non-negotiable — type-checks and tests alone do not catch all build-time failures.
>
> (Glossary application and ADR creation tasks are dropped: the repo has no glossary file and this spec creates no ADR.)
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
> After the final build passes — and before wrapping up via `superpowers:finishing-a-development-branch` — if a cross-model review helper is available (e.g. the Codex plugin's adversarial review), run it with focus: *"Judge correctness against the spec's acceptance criteria (V1–V22) only. Do not flag anything outside the stated criteria — no design alternatives, hardening, or scope the spec did not claim."*
>
> This **never gates a merge** — the gate stays `bun run check` plus `bun run build`; the review only flags what deserves a second look. If no helper is available, finish the branch without it.
