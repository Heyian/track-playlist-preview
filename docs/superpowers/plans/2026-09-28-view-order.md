# View Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new preview follows the collection page's view order: the saved sort from every entry
point, plus the page filter when the previewed collection is the open page (issue #1).

**Architecture:** A new pure module `collections/viewOrder.ts` turns injected readers
(`sortedState`, the Liked Songs playlist URI, the open page's URI, the filter box text) into
`ViewOptions`. `collections.enumerate` takes an optional `ViewOptions` and passes `sort` / `filter`
to `PlaylistAPI.getContents`; Liked Songs enumerates its internal playlist URI through the same
path, falling back to `LibraryAPI.getTracks`. `spotify/ports.ts` binds the readers to the live
client, and `index.ts` computes the view inside the `enumerate` lambda, so it is read once per
session start. The controller, engine and panel are untouched.

**Tech Stack:** TypeScript (strict), Bun bundler (`build.ts`), Vitest (+ happy-dom via the
`// @vitest-environment happy-dom` file pragma), Spicetify CLI 3 / stdlib 1.13.0, Spotify 1.2.96.518.

**Spec:** `docs/specs/2026-09-28-view-order-design.md` (criteria V1–V22 and V8a). Read
**Investigation Findings** and **Design** first.

## Global Constraints

- Quality gate: `bun run check` (typecheck + vitest). No linter. `bun run build` does not typecheck.
- Only adapter modules touch `Spicetify` globals or `document`: nothing under `src/collections/`
  may reference either (V20). The live readers live in `src/spotify/ports.ts`.
- Saved sort: `Spicetify.Platform.LocalStorageAPI.getItem("sortedState")` → `{ [uri]: { field, order } }`.
- Filter box selector, verbatim: `.main-view-container input.x-filterBox-filterInput`.
- Liked Songs playlist URI: `Spicetify.Platform.LibraryAPI._likedSongsUri`, accepted only when a
  string starting with `spotify:playlist:`.
- `getContents` option names are `sort: { field, order? }` and `filter: string`. Omit a key
  entirely when it has no value — never send `sort: undefined`.
- Sort `field` is passed through unchanged when it is a non-empty string (no allow-list, V3);
  `order` is kept only when `"ASC"` or `"DESC"` (V5).
- The session's collection URI stays the URI the user previewed (`spotify:collection:tracks` for
  Liked Songs). Never let the internal Liked Songs URI reach the controller (V12, R2).
- No new listener, observer, subscription or setting (V21, V22).
- Commit messages: imperative sentence, no prefix (e.g. "Pass the saved sort to getContents").
  No AI-attribution lines.
- `spicetify apply` force-restarts Spotify: ask the user before running it.

## Review Focus

1. `sortedState` comes back as something other than a plain map (a JSON string, `null`, an
   array) → no sort, preview starts. Test: Task 3, `V4: a non-object sortedState map yields no sort`.
2. Sorting by Title puts unavailable, empty-named entries first → they are dropped by eligibility
   and the queue starts at the first playable row. Test: Task 1, `V9: sorted results drop ineligible
   leading entries and keep order`.
3. The sidebar's "Search in Your Library" box shares the filter-box class → it is never read as the
   page filter. Test: Task 4, `V8a: ignores a filter box outside .main-view-container`.
4. Liked Songs has a saved sort under its internal URI but none under `spotify:collection:tracks`
   → the internal URI's entry is used, and an entry under `spotify:collection:tracks` is ignored.
   Test: Task 3, `V10: Liked Songs sort is keyed by the internal playlist URI only`.
5. The user previews playlist Q from the sidebar while playlist P's page is open with a filter →
   Q gets its own saved sort and no filter. Test: Task 3, `V7: no filter when the open page is a
   different collection`.

---

### Task 0: Isolated workspace

- [ ] **Step 1:** If the session is not already in a git worktree, create one via
  `superpowers:using-git-worktrees` for branch `view-order` (it already exists with the spec
  commits; base the worktree on it, not on `main`).

---

### Task 1: `ViewOptions` type and view-aware playlist enumeration

**Files:**
- Modify: `src/types/domain.ts` (add `ViewOptions`)
- Modify: `src/collections/playlist.ts`
- Test: `src/collections/playlist.test.ts`

**Interfaces:**
- Produces: in `src/types/domain.ts`
  ```ts
  export interface ViewOptions {
    sort?: { field: string; order?: "ASC" | "DESC" };
    filter?: string;
  }
  ```
- Produces: `PlaylistContentsApi.getContents(uri, options: { limit: number; offset: number } & ViewOptions)`
- Produces: `enumeratePlaylistContents(uri: string, api: PlaylistContentsApi, view?: ViewOptions): Promise<TrackRef[]>`

- [ ] **Step 1: Write the failing tests** (append to `describe("enumeratePlaylistContents")`, using a recording api)

```ts
function recordingApi(all: RawTrackItem[]) {
  const calls: Record<string, unknown>[] = [];
  const api: PlaylistContentsApi = {
    async getContents(_uri, options) {
      calls.push({ ...options });
      return { items: all.slice(options.offset, options.offset + options.limit), totalLength: all.length };
    },
  };
  return { api, calls };
}

it("V1/V19: sends the same sort on every page and keeps every entry, duplicates included", async () => {
  const all = Array.from({ length: 250 }, (_, i) => track(`t${i % 200}`)); // t0..t49 appear twice
  const { api, calls } = recordingApi(all);
  const refs = await enumeratePlaylistContents("spotify:playlist:p", api, { sort: { field: "TITLE", order: "ASC" } });
  expect(refs).toHaveLength(250);
  expect(calls).toHaveLength(3);
  for (const c of calls) expect(c.sort).toEqual({ field: "TITLE", order: "ASC" });
});

it("V6: sends the filter on every page", async () => {
  const { api, calls } = recordingApi(Array.from({ length: 150 }, (_, i) => track(`t${i}`)));
  await enumeratePlaylistContents("spotify:playlist:p", api, { filter: "live" });
  expect(calls.map((c) => c.filter)).toEqual(["live", "live"]);
});

it("V2: omits sort and filter keys when no view is given or the view is empty", async () => {
  for (const view of [undefined, {}]) {
    const { api, calls } = recordingApi([track("a")]);
    await enumeratePlaylistContents("spotify:playlist:p", api, view);
    expect(Object.keys(calls[0]!).sort()).toEqual(["limit", "offset"]);
  }
});

it("V9: sorted results drop ineligible leading entries and keep order", async () => {
  const all = [track("gone", { isPlayable: false, name: "" }), track("b"), track("a")];
  const { api } = recordingApi(all);
  const refs = await enumeratePlaylistContents("spotify:playlist:p", api, { sort: { field: "TITLE" } });
  expect(refs.map((r) => r.uri)).toEqual(["spotify:track:b", "spotify:track:a"]);
});
```

- [ ] **Step 2: Run** `bunx vitest run src/collections/playlist.test.ts` — Expected: the V1/V19, V6
  and V2 tests FAIL (sort/filter not sent; typecheck of the 3-arg call also fails under `bun run typecheck`).

- [ ] **Step 3: Implement.** Add `ViewOptions` to `domain.ts`. In `playlist.ts`, widen the options
  type as above and spread `view.sort` / `view.filter` into each request only when defined.

- [ ] **Step 4: Run** `bunx vitest run src/collections/playlist.test.ts` — Expected: PASS (all
  existing AC1/AC2/AC4/AC6 tests still pass).

- [ ] **Step 5: Commit** — `git add src/types/domain.ts src/collections/playlist.ts src/collections/playlist.test.ts && git commit -m "Pass sort and filter options to playlist enumeration"`

---

### Task 2: `enumerate` takes a view; Liked Songs via its internal playlist URI

**Files:**
- Modify: `src/collections/index.ts`
- Test: `src/collections/index.test.ts`

**Interfaces:**
- Consumes: `ViewOptions`, `enumeratePlaylistContents(uri, api, view?)` (Task 1).
- Produces: `CollectionDeps` gains `likedSongsPlaylistUri(): string | null`.
- Produces: `enumerate(uri: string, deps: CollectionDeps, classify: (uri: string) => CollectionType | null, view?: ViewOptions): Promise<TrackRef[]>`

- [ ] **Step 1: Write the failing tests.** Import `type Mock` from `vitest`. Extend the test's `deps()` with
  `likedSongsPlaylistUri: vi.fn(() => null as string | null)`; the existing "routes Liked Songs to
  LibraryAPI" test becomes the V11 case unchanged. Add:

```ts
const VIEW = { sort: { field: "ADDED_AT", order: "DESC" as const }, filter: "live" };
const classify = (u: string) => collectionTypeForUri(u, matcher);

it("V1/V6: passes the view to getContents for a playlist", async () => {
  const d = deps();
  await enumerate("spotify:playlist:p", d, classify, VIEW);
  expect(d.playlistApi.getContents).toHaveBeenCalledWith("spotify:playlist:p", expect.objectContaining(VIEW));
});

it("V10: Liked Songs enumerates the internal playlist URI with the view and never calls LibraryAPI", async () => {
  const d = deps();
  (d.likedSongsPlaylistUri as Mock).mockReturnValue("spotify:playlist:liked");
  const refs = await enumerate("spotify:collection:tracks", d, classify, VIEW);
  expect(d.playlistApi.getContents).toHaveBeenCalledWith("spotify:playlist:liked", expect.objectContaining(VIEW));
  expect(d.libraryApi.getTracks).not.toHaveBeenCalled();
  expect(refs.map((r) => r.uri)).toEqual(["spotify:track:p"]);
});

it("V11: without an internal URI, Liked Songs uses LibraryAPI and ignores the view", async () => {
  const d = deps();
  await enumerate("spotify:collection:tracks", d, classify, VIEW);
  expect(d.libraryApi.getTracks).toHaveBeenCalledWith({ limit: 100, offset: 0 });
  expect(d.playlistApi.getContents).not.toHaveBeenCalled();
});

it("V13: album and artist requests ignore any view", async () => {
  const d = deps();
  await enumerate("spotify:album:x", d, classify, VIEW);
  expect(Object.keys((d.playlistApi.getContents as Mock).mock.calls[0]![1]).sort()).toEqual(["limit", "offset"]);
  await enumerate("spotify:artist:x", d, classify, VIEW);
  expect(d.artistOverview).toHaveBeenCalledWith("spotify:artist:x");
});
```

- [ ] **Step 2: Run** `bunx vitest run src/collections/index.test.ts` — Expected: V1/V6, V10 and
  V13 FAIL.

- [ ] **Step 3: Implement** the new `enumerate` signature: `playlist` passes `view`; `album` passes
  none; `likedSongs` calls `enumeratePlaylistContents(internalUri, deps.playlistApi, view)` when
  `deps.likedSongsPlaylistUri()` returns a string, else `enumerateLikedSongs(deps.libraryApi)`.

- [ ] **Step 4: Run** `bunx vitest run src/collections` — Expected: PASS. `bun run typecheck` will
  fail in `src/spotify/ports.ts` (`createCollectionDeps` lacks `likedSongsPlaylistUri`); Task 4
  fixes it. Do not commit until `bun run check` passes: add a temporary
  `likedSongsPlaylistUri: () => null` to `createCollectionDeps` now (Task 4 replaces it).

- [ ] **Step 5: Commit** — `git add src/collections/index.ts src/collections/index.test.ts src/spotify/ports.ts && git commit -m "Enumerate Liked Songs through its playlist URI when a view applies"`

---

### Task 3: `collections/viewOrder.ts`

**Files:**
- Create: `src/collections/viewOrder.ts`
- Test: `src/collections/viewOrder.test.ts`

**Interfaces:**
- Consumes: `ViewOptions`, `CollectionType` from `src/types/domain.ts`.
- Produces:
  ```ts
  export interface ViewOrderDeps {
    readSortedState(): unknown;             // may throw
    likedSongsPlaylistUri(): string | null;
    currentCollectionUri(): string | null;
    readFilterText(): string | null;
  }
  export function createViewOrder(deps: ViewOrderDeps): {
    viewFor(uri: string, type: CollectionType | null): ViewOptions;
  };
  ```

- [ ] **Step 1: Write the failing tests** with a `setup(overrides)` helper returning
  `createViewOrder({ readSortedState: () => state, likedSongsPlaylistUri: () => "spotify:playlist:liked", currentCollectionUri: () => page, readFilterText: () => text, ...overrides })`.
  Constants: `P = "spotify:playlist:P"`, `Q = "spotify:playlist:Q"`, `LIKED = "spotify:collection:tracks"`.
  Tests and exact expectations:
  - `V1: returns the saved sort for P` — state `{ [P]: { field: "ADDED_AT", order: "DESC" } }`, page `null` → `viewFor(P, "playlist")` equals `{ sort: { field: "ADDED_AT", order: "DESC" } }`.
  - `V2: no entry → no sort key` — state `{}` → `viewFor(P, "playlist")` equals `{}` and `"sort" in result` is false.
  - `V3: passes an unknown non-empty field through` — `{ [P]: { field: "MOOD", order: "ASC" } }` → `sort` equals `{ field: "MOOD", order: "ASC" }`.
  - `V4: a malformed entry yields no sort` — for each entry in `[null, "TITLE", 3, { field: "" }, { field: 5 }, { order: "ASC" }]` → `viewFor(P, "playlist").sort` is `undefined`.
  - `V4: a throwing read yields no sort` — `readSortedState: () => { throw new Error("x"); }` → `{}`.
  - `V4: a non-object sortedState map yields no sort` — for each state in `[null, undefined, "{}", 7, [ ]]` → `{}`.
  - `V5: an invalid order keeps the field only` — `{ [P]: { field: "TITLE", order: "UP" } }` → `sort` equals `{ field: "TITLE" }` (no `order` key).
  - `V6: filter when the open page is P` — page `P`, text `"  live  "` → `filter` is `"live"`.
  - `V7: no filter when the open page is a different collection` — page `P`, text `"live"`, state `{ [Q]: { field: "TITLE", order: "ASC" } }` → `viewFor(Q, "playlist")` equals `{ sort: { field: "TITLE", order: "ASC" } }`.
  - `V8: empty or absent box → no filter` — page `P`, text in `[null, "", "   "]` → `"filter" in viewFor(P, "playlist")` is false.
  - `V10: Liked Songs sort is keyed by the internal playlist URI only` — state `{ "spotify:playlist:liked": { field: "TITLE", order: "ASC" }, [LIKED]: { field: "ARTIST", order: "ASC" } }`, page `LIKED`, text `"x"` → `viewFor(LIKED, "likedSongs")` equals `{ sort: { field: "TITLE", order: "ASC" }, filter: "x" }`.
  - `V11: Liked Songs with no internal URI has no sort` — `likedSongsPlaylistUri: () => null`, same state → `viewFor(LIKED, "likedSongs").sort` is `undefined`.
  - `V13: albums, artists and unknown types get {}` — state has entries for all three URIs, page equals each URI, text `"x"` → `viewFor(A, "album")`, `viewFor(R, "artist")`, `viewFor(T, null)` each equal `{}`.
  - `V14: each call reads the readers afresh and returns an independent object` — call `viewFor(P, "playlist")`, then change `state` and `text`; the first result is unchanged and a second call reflects the new values.

- [ ] **Step 2: Run** `bunx vitest run src/collections/viewOrder.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `createViewOrder`** in `src/collections/viewOrder.ts`. Wrap
  `readSortedState()` in `try/catch`; treat the map as usable only when it is a non-null,
  non-array object. No `Spicetify` or `document` reference (V20).

- [ ] **Step 4: Run** `bunx vitest run src/collections/viewOrder.test.ts` — Expected: PASS. Then
  `grep -rnE "Spicetify|document" src/collections/*.ts | grep -v test` — Expected: no output (V20).

- [ ] **Step 5: Commit** — `git add src/collections/viewOrder.ts src/collections/viewOrder.test.ts && git commit -m "Add viewOrder to derive sort and filter for a preview"`

---

### Task 4: Live readers in `spotify/ports.ts`

**Files:**
- Modify: `src/spotify/ports.ts`
- Test: `src/spotify/ports.viewOrder.test.ts` (new; first line `// @vitest-environment happy-dom`)

**Interfaces:**
- Consumes: `ViewOrderDeps` (Task 3), `CollectionDeps.likedSongsPlaylistUri` (Task 2).
- Produces:
  - `export function likedSongsPlaylistUri(): string | null`
  - `export function readSortedState(): unknown`
  - `export function readFilterText(): string | null`
  - `createCollectionDeps()` returns `likedSongsPlaylistUri` (replacing Task 2's placeholder).

- [ ] **Step 1: Write the failing tests** (stub `Spicetify` with `vi.stubGlobal`, `afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; })`):
  - `V10/V11: likedSongsPlaylistUri accepts only a spotify:playlist: string` — `_likedSongsUri` of `"spotify:playlist:abc"` → that string; of `undefined`, `42`, `"spotify:collection:tracks"` → `null`; `LibraryAPI` missing → `null`.
  - `readSortedState returns LocalStorageAPI.getItem("sortedState")` — stub `getItem: vi.fn(() => ({ a: 1 }))` → returns `{ a: 1 }` and `getItem` was called with `"sortedState"`.
  - `V6: reads the filter box inside the main view` — body `<div class="main-view-container"><input class="x-filterBox-filterInput" value="live"></div>` → `"live"`.
  - `V8: no main-view filter box → null` — empty body → `null`.
  - `V8a: ignores a filter box outside .main-view-container` — body `<nav><input class="x-filterBox-filterInput" value="lib"></nav><div class="main-view-container"></div>` → `null`.

- [ ] **Step 2: Run** `bunx vitest run src/spotify/ports.viewOrder.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** the three readers exactly as the Global Constraints give the selector,
  storage key and URI prefix. `readSortedState` lets a throw propagate (viewOrder catches it).

- [ ] **Step 4: Run** `bun run check` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/spotify/ports.ts src/spotify/ports.viewOrder.test.ts && git commit -m "Bind the view-order readers to the live client"`

---

### Task 5: Wire the view into session start

**Files:**
- Modify: `src/index.ts` (around line 88–130)
- Modify: `src/index.test.ts` (the `./spotify/ports` mock)

**Interfaces:**
- Consumes: `createViewOrder` (Task 3), the readers (Task 4), `enumerate(…, view)` (Task 2).

- [ ] **Step 1:** Add `readSortedState: vi.fn(() => ({}))`, `readFilterText: vi.fn(() => null)`,
  `likedSongsPlaylistUri: vi.fn(() => null)` to the `./spotify/ports` mock in `src/index.test.ts`.

- [ ] **Step 2:** In `wire()`, build
  `const viewOrder = createViewOrder({ readSortedState, likedSongsPlaylistUri, currentCollectionUri, readFilterText });`
  and change the controller dep to
  `enumerate: (uri) => enumerate(uri, collectionDeps, classify, viewOrder.viewFor(uri, classify(uri))),`.
  `collectionTypeForUri: classify` and every other controller dep stay as they are (V12).

- [ ] **Step 3: Run** `bun run check` — Expected: PASS, including the existing controller test
  asserting a `spotify:collection:tracks` session has `removeLabel: null` (V12/R2).

- [ ] **Step 4: Commit** — `git add src/index.ts src/index.test.ts && git commit -m "Read the view order when a preview starts"`

---

### Task 6: Live verification

Requires the debug port (`curl -s 127.0.0.1:8088/json/version` answers). **Ask the user before
`spicetify apply`** — it restarts Spotify. Starting a preview pauses the user's playback.

- [ ] **Step 1:** `bun run build`, then (after the user agrees) `spicetify apply`. Confirm
  `node scripts/cdp-eval.mjs 'Spicetify.Modules.list()'` shows `track-playlist-preview` loaded.
- [ ] **Step 2 (V1, V9, V15):** On a playlist with ≥ 20 tracks, set a saved sort (Title) and
  filter text via the UI. Start **Preview all**; read the queue's first 5 URIs (via the panel's
  heading as each track plays, or `getContents(uri, { sort, filter, limit: 5, offset: 0 })` for
  the expected list) and compare to the page's rows. Then **Preview from here** on the 3rd visible
  row: the first previewed track is that row and the next is the 4th row.
- [ ] **Step 3 (V10):** Same on Liked Songs with a saved sort and filter.
- [ ] **Step 4 (V7, V8a):** With P filtered and open, start a different playlist from the sidebar
  menu: its queue matches its own saved sort, unfiltered. Type into the sidebar's "Search in Your
  Library" box and start P from its page with an empty page filter: the queue is unfiltered.
- [ ] **Step 5 (V14):** Start a filtered preview, clear the filter and change the sort: the panel's
  total ("n/N") does not change.
- [ ] **Step 6 (V17):** Filter to text that matches nothing, press **Preview all**: "Nothing to
  preview" appears; playback is not paused.
- [ ] **Step 7 (V21):** `node scripts/check-unload.mjs --no-session` — Expected: pass.
- [ ] **Step 8:** Restore any saved sort and filter changed for testing. Record results (pass/fail
  per criterion) in the PR description.

---

### Task 7: Update `docs/specs/2026-07-22-track-playlist-preview-design.md`

- [ ] Apply the spec's **Amendments to the v1 spec**: the **Order** bullet, AC1, AC3, strike AC7 —
  each with a pointer to `2026-09-28-view-order-design.md`. Mark #1 resolved under its Deferred
  Items. Commit: "Point the v1 spec's order criteria at the view-order spec".

### Task 8: Update `docs/spicetify-v3-platform.md`

- [ ] Add a short "Spotify Platform APIs" section recording findings 1, 3, 4 and 6 from the spec
  (one bullet each) and a pointer to the spec. Commit: "Record the sort and filter API findings".

### Task 9: Update `CLAUDE.md`

- [ ] Add one row under **Documentation**:
  `- [View-order spec](docs/specs/2026-09-28-view-order-design.md) — sort and filter in the preview queue, criteria V1–V22 and V8a.`
  Commit: "Link the view-order spec from CLAUDE.md".

### Task 10: Deferred-item verification

- [ ] `gh issue view 12 --json body | jq -r .body | grep -E '^## (Context|Required|Integration Points|Priority)$'`
  — Expected: all four headings.

### Task 11: Post-implementation check

- [ ] Read `git diff main...HEAD` and confirm: Tasks 7–9 docs landed; no config file changed (spec
  says none); no glossary or ADR is expected; `grep -rnE "Spicetify|document" src/collections/*.ts | grep -v test`
  is empty; no `addListener`/`MutationObserver`/`listen(` was added.

### Task 12: Final build

- [ ] `bun run build` — Expected: completes and writes `index.js`, `index.css`, `metadata.json`.
  Fix any failure and re-run until it succeeds.

---

## Implementation Plan Guidance (from the spec)

- Before every `git commit`, dispatch a verification subagent that runs `bun run check` and reports
  `STATUS: PASS` / `STATUS: FAIL`; commit only on PASS. Never `--no-verify`.
- Follow `superpowers:test-driven-development` and `superpowers:verification-before-completion`.
- After Task 12, if a cross-model helper is available, run an advisory review scoped to V1–V22 and
  V8a only. It never gates the merge.
