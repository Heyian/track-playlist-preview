# Preview Panel + Remove From Playlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Playbar Skip/Stop buttons with a non-blocking preview panel (artwork, progress,
Stop / Next / Remove, keyboard shortcuts) and add Remove-from-playlist with a delayed commit and an
Undo stack.

**Architecture:** New pure modules (`pendingRemovals`, `ui/previewPanel.view`,
`spotify/collectionLabel`) plus engine and controller changes carry all the logic and are
unit-tested. The two React files (`ui/previewPanel.tsx`, `ui/pendingRemovalsStack.tsx`) only render
a view-model and call back into the controller. They are verified live over CDP. Only
`spotify/ports` touches the new Spotify APIs.

**Tech Stack:** TypeScript (strict), Bun bundler (`build.ts`), Vitest (+ happy-dom where a DOM
stub is needed), React via `Spicetify.React` (aliased in `build.ts`), Spicetify v3 on Spotify
1.2.96.518.

**Spec:** `docs/specs/2026-07-25-preview-modal-design.md` (the preview panel, AC46–AC70). It folds in
`docs/specs/2026-09-26-remove-from-playlist-design.md` (R1–R16). Read both before starting.

## Global Constraints

- Quality gate: `bun run check` (typecheck + vitest). No linter. `bun run build` does not typecheck.
- `grep -rE 'e-[0-9]' src/` returns nothing. Button classes are read from a live
  `[data-encore-id="buttonTertiary"]` element.
- No GraphQL `sha256Hash` in source. Operations come from `Spicetify.GraphQL.Definitions` at call time.
- Only `playerCoordinator` calls `Spicetify.Player`, and only `pause` / `resume`.
- Only `spotify/ports` calls `Spicetify.Platform.PlaylistAPI.remove` / `getMetadata` (R16).
  `pendingRemovals` and `previewEngine` import no `Spicetify` global.
- Icons are full `<svg>` markup built from `Spicetify.SVGIcons[name]`, never a bare name.
- Never use `Spicetify.PopupModal` for an in-session surface. In code the surface is the "panel",
  never "modal" / "popup" / "player".
- `.tsx` files `import React from "react"` (classic runtime, `"jsx": "react"`). Never add `react`
  as a dependency.
- `UNDO_WINDOW_MS = 5000` (exported constant, not a setting).
- Exact copy: `"Nothing to preview"` (unchanged) · `"No preview — skipping"` · `"From: <label> · <i>/<N>"` ·
  `"Single track"` · `"Remove"` (visible) · aria-label `"Remove from <playlist name>"` ·
  `"Removed <Title> from <Playlist>"` + `"Undo"` · error notice `"Couldn't remove <Title> from <Playlist>"` ·
  generic labels `"Playlist"`, `"Album"`, `"Artist"` · constant `"Liked Songs"`.
- Removal commit call: `PlaylistAPI.remove(playlistUri, [{ uri: trackUri, uid: "" }])` (R9;
  spike r1 may change the shape, see Task 2).
- Commits: capitalized imperative subject, no `feat:` prefix, no AI-attribution line.
- CDP: `node scripts/cdp-eval.mjs '<expr>'` with the Bash sandbox **disabled** (fetch to
  `127.0.0.1:8088` fails inside it). A probe that registers UI removes it in a `finally`.

## Review Focus

1. **Two starts in quick succession** (double-click *Preview all*, or a replacement while the
   first start's label/metadata lookup is still in flight): the later start wins. Exactly one
   `engine.start`, one panel view, no stale session context. Test in Task 10.
2. **`Delete` held down** (key auto-repeat): each repeat would remove the next track in turn, clearing
   a playlist in seconds. Auto-repeated `Delete` does nothing. Test in Task 8.
3. **A track that appears twice in the playlist**: removing the first copy excludes the later copy
   in the same session (R13), and the commit removes both (R9, spike r1). Test in Tasks 6 and 7.
4. **Single-track fallback with no artist** (AC69 lookup failure gives artist `""`): the heading
   shows the title alone, with no dangling `" — "`. Test in Task 8.
5. **Many pending removals** (no row limit): the stack scrolls inside the viewport rather than
   running under the top bar. Checked live in Task 11.

## Config & Infrastructure Impact → tasks

Every file in both specs' Config & Infrastructure Impact tables has an explicit task:

| File | Task |
| --- | --- |
| `src/types/domain.ts` | 3, 6, 7, 8 |
| `src/collections/eligibility.ts`, `playlist.ts`, `likedSongs.ts`, `artist.ts` (+ tests) | 3 |
| `src/spotify/fetchTrackRef.ts` (+ new test) | 4 |
| `src/spotify/collectionLabel.ts` (+ test) | 5 |
| `src/spotify/ports.ts` | 5, 6, 8 |
| `src/pendingRemovals.ts` (+ test) | 6 |
| `src/previewEngine.ts` (+ test) | 7 |
| `src/ui/previewPanel.view.ts` (+ test) | 8 |
| `src/ui/previewPanel.tsx`, `src/ui/pendingRemovalsStack.tsx`, `src/ui/previewPanel.css` | 9 |
| `src/previewController.ts`, `src/previewController.test.ts` (new) | 10 |
| `src/index.ts` | 10 |
| `src/ui/playbarControls.ts`, `src/ui/playbarControls.test.ts` (delete) | 10 |
| `CLAUDE.md`, `README.md`, `docs/specs/2026-07-22-…` | 12, 13, 14 |

---

### Task 1: Isolated workspace

- [ ] **Step 1:** Create an isolated workspace via `superpowers:using-git-worktrees`, branched from
  `v3-beta` (the spec and this plan must be committed on `v3-beta` first).
- [ ] **Step 2:** Run `bun install && bun run check`. Expected: PASS (baseline).

---

### Task 2: Live spikes (p1–p4, r1)

Nothing is built on an unverified API. Spotify must be running with the current `v3-beta` build.

**Files:**
- Modify: `docs/specs/2026-07-25-preview-modal-design.md` (append a "Spike results" subsection under
  Investigation Findings)

- [ ] **Step 1: p1 — body-level React root.** Over CDP: create `div#tpp-spike` in `<body>`, render
  a `Spicetify.React.createElement("section", { tabIndex: -1 }, "x")` into it with
  `Spicetify.ReactDOM.createRoot` if it exists, else `Spicetify.ReactDOM.render`. Record which API
  works. Give the host `position: fixed; right: 16px; bottom: 120px; z-index: 50`. Check
  `document.elementFromPoint` at its centre returns it, and a point on the page outside it returns
  a page element. Open the settings modal (`Spicetify.PopupModal.display({ title: "t", content: "c" })`)
  and confirm `elementFromPoint` at the host's centre returns the modal overlay. Confirm the
  `section` accepts `.focus()` (`document.activeElement`). Unmount and remove everything in a `finally`.
  If no z-index puts the host above the page and below the overlay, or it can't take focus, **STOP**
  and raise it with the user.
- [ ] **Step 2: p2 — CSS variables and geometry.** Confirm `getComputedStyle(document.documentElement)`
  resolves `--background-elevated-base`, `--text-base`, `--text-subdued`. Record a stable selector
  for the Playbar (try `.Root__now-playing-bar`, else `footer`) and its bounding box, and the
  notistack container's bounding box during `Spicetify.showNotification("probe")`.
- [ ] **Step 3: p3 — `getTrack`.** `Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.getTrack, { uri })`
  for a known track. Record the variables it needs and the paths for name,
  `firstArtist.items[].profile.name`, `otherArtists.items[].profile.name` (if present) and
  `albumOfTrack.coverArt.sources[]`.
- [ ] **Step 4: p4 — collection names.** Record the name source for each type: playlist
  `PlaylistAPI.getMetadata(uri).name`, album (try `PlaylistAPI.getMetadata(albumUri).name`, else
  `Definitions.getAlbum`), artist (`queryArtistOverview` → `data.artistUnion.profile.name`).
- [ ] **Step 5: r1 — URI-form removal of duplicates.** Create a throwaway playlist (record the
  `Platform.RootlistAPI` call used), add the same track twice plus one other, call
  `PlaylistAPI.remove(uri, [{ uri: trackUri, uid: "" }])`, and read `getContents`. Record whether
  both copies went. Delete the throwaway playlist in a `finally`. **Never touch a user playlist.**
  If only one copy is removed, Task 6's `playlistRemove` must first collect every matching row's
  `uid` via `getContents`, then remove those rows. Record the chosen shape.
- [ ] **Step 6:** Write the results (API chosen, selectors, paths, r1 outcome) into the spec's
  "Spike results" subsection, then commit: `Record preview panel spike results`.

---

### Task 3: Artwork on `TrackRef` (AC59)

**Files:**
- Modify: `src/types/domain.ts` (`TrackRef`)
- Modify: `src/collections/eligibility.ts`, `src/collections/artist.ts`
- Test: `src/collections/eligibility.test.ts` (new), `src/collections/playlist.test.ts`,
  `src/collections/likedSongs.test.ts`, `src/collections/artist.test.ts`

**Interfaces:**
- Produces: `TrackRef.artworkUrl?: string`.
  `pickArtwork(images: { url?: string; label?: string }[] | undefined): string | undefined` in
  `eligibility.ts`. `RawTrackItem.album?: { images?: { url?: string; label?: string }[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
// eligibility.test.ts
it("AC59: picks the standard-labelled image", () => {
  expect(pickArtwork([{ url: "spotify:image:s", label: "small" }, { url: "spotify:image:std", label: "standard" }])).toBe("spotify:image:std");
});
it("AC59: falls back to the first image when none is labelled standard", () => {
  expect(pickArtwork([{ url: "https://i.scdn.co/image/a" }, { url: "https://i.scdn.co/image/b" }])).toBe("https://i.scdn.co/image/a");
});
it("AC59: absent or empty images give undefined", () => {
  expect(pickArtwork(undefined)).toBeUndefined();
  expect(pickArtwork([])).toBeUndefined();
});
// playlist.test.ts (likedSongs.test.ts: same pair through enumerateLikedSongs)
it("AC59: artworkUrl comes from album.images", async () => {
  const all = [track("a", { album: { images: [{ url: "spotify:image:std", label: "standard" }] } })];
  expect((await enumeratePlaylistContents("spotify:playlist:p", pagedApi(all, 100)))[0]!.artworkUrl).toBe("spotify:image:std");
});
it("AC59: no album images → artworkUrl undefined", async () => {
  expect((await enumeratePlaylistContents("spotify:playlist:p", pagedApi([track("a")], 100)))[0]!.artworkUrl).toBeUndefined();
});
// artist.test.ts — extend overview() so a track can carry albumOfTrack.coverArt.sources
it("AC59: artworkUrl is the first coverArt source", async () => { /* sources [{url:"https://i.scdn.co/image/a"},{url:"…/b"}] → "https://i.scdn.co/image/a" */ });
it("AC59: missing coverArt → artworkUrl undefined", async () => { /* … */ });
```

- [ ] **Step 2:** `bun run test src/collections` → FAIL (`pickArtwork` not exported; `artworkUrl` undefined).
- [ ] **Step 3: Implement.** Add `artworkUrl?` to `TrackRef`, then `pickArtwork` and `album` on
  `RawTrackItem`. `toTrackRef` sets `artworkUrl: pickArtwork(item.album?.images)`. In `artist.ts`,
  extend `OverviewShape` with `albumOfTrack?.coverArt?.sources?: { url?: string }[]` and set
  `artworkUrl: pickArtwork(sources)`. Existing `toEqual` assertions still pass because `toEqual`
  ignores `undefined` properties.
- [ ] **Step 4:** `bun run test src/collections` → PASS.
- [ ] **Step 5:** Pre-commit verification, then commit: `Carry album artwork on TrackRef`.

---

### Task 4: Single-track metadata via `getTrack` (AC69)

**Files:**
- Modify: `src/spotify/fetchTrackRef.ts`
- Test: `src/spotify/fetchTrackRef.test.ts` (new)

**Interfaces:**
- Consumes: `pickArtwork` (Task 3).
- Produces: `parseGetTrack(uri: string, res: unknown): TrackRef | null` (null when no name).
  `fetchTrackRef(uri)` has the same signature as today.

- [ ] **Step 1: Write the failing tests**

```ts
const res = { data: { trackUnion: {
  name: "Song",
  firstArtist: { items: [{ profile: { name: "A" } }] },
  otherArtists: { items: [{ profile: { name: "B" } }] },
  albumOfTrack: { coverArt: { sources: [{ url: "https://i.scdn.co/image/x", width: 300, height: 300 }] } },
} } };
it("AC69: parses name, joined artists and artwork", () => {
  expect(parseGetTrack("spotify:track:1", res)).toEqual({ uri: "spotify:track:1", name: "Song", artist: "A, B", artworkUrl: "https://i.scdn.co/image/x" });
});
it("AC69: no name → null", () => { expect(parseGetTrack("spotify:track:1", { data: {} })).toBeNull(); });
it("AC69: a failed lookup falls back to the URI label, empty artist, no artwork", async () => {
  (globalThis as any).Spicetify = { GraphQL: { Definitions: { getTrack: {} }, Request: vi.fn(async () => { throw new Error("x"); }) } };
  const ref = await fetchTrackRef("spotify:track:abc");
  expect(ref).toEqual({ uri: "spotify:track:abc", name: "abc", artist: "" });
  expect(ref.artworkUrl).toBeUndefined();
});
```

- [ ] **Step 2:** `bun run test src/spotify` → FAIL.
- [ ] **Step 3: Implement.** Use the paths and variables from spike p3. Drop `otherArtists` if p3
  showed it doesn't exist, and adjust the test to match. `fetchTrackRef` calls
  `Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.getTrack, <p3 variables>)`, returns
  `parseGetTrack(...) ?? fallback`, and uses the fallback on rejection. Update the header comment:
  it no longer serves the Snackbar.
- [ ] **Step 4:** `bun run test src/spotify` → PASS.
- [ ] **Step 5:** Pre-commit verification, then commit: `Fetch single-track metadata via getTrack`.

---

### Task 5: Collection label (AC48 Liked Songs, AC64)

**Files:**
- Modify: `src/types/domain.ts`, `src/spotify/ports.ts`
- Create: `src/spotify/collectionLabel.ts`
- Test: `src/spotify/collectionLabel.test.ts`

**Interfaces:**
- Produces (domain): `interface PlaylistMetadata { name?: unknown; canRemove?: unknown }`,
  `type PlaylistMetadataPort = (uri: string) => Promise<PlaylistMetadata>`.
- Produces: `GENERIC_LABEL: Record<CollectionType, string>` = `{ playlist: "Playlist", album: "Album", artist: "Artist", likedSongs: "Liked Songs" }`.
  `createCollectionLabel(apis: { playlistMetadata: PlaylistMetadataPort; artistOverview: ArtistOverviewApi }): (uri: string, type: CollectionType) => Promise<string>`,
  which never rejects.
- Produces (ports): `playlistMetadata: PlaylistMetadataPort` over `Spicetify.Platform.PlaylistAPI.getMetadata`.

- [ ] **Step 1: Write the failing tests**

```ts
it("AC48: Liked Songs is the constant label, no lookup", async () => {
  const apis = { playlistMetadata: vi.fn(), artistOverview: vi.fn() };
  expect(await createCollectionLabel(apis)("spotify:collection:tracks", "likedSongs")).toBe("Liked Songs");
  expect(apis.playlistMetadata).not.toHaveBeenCalled();
});
it("uses the playlist's metadata name", async () => { /* name "Chill Mix" → "Chill Mix" */ });
it("AC64: rejected / empty / non-string name → generic type label", async () => {
  // playlist reject → "Playlist"; playlist name "" → "Playlist"; name 42 → "Playlist";
  // album reject → "Album"; artist reject → "Artist"
});
it("uses the artist profile name", async () => { /* artistOverview → { data: { artistUnion: { profile: { name: "Band" } } } } → "Band" */ });
```

- [ ] **Step 2:** `bun run test src/spotify/collectionLabel` → FAIL.
- [ ] **Step 3: Implement.** Use the per-type sources spike p4 confirmed. For album, if p4 showed
  `getMetadata` fails, inject the album source through `apis` instead. Keep all Spicetify calls in
  `ports.ts`. Add `playlistMetadata` to `ports.ts`.
- [ ] **Step 4:** `bun run test src/spotify` → PASS.
- [ ] **Step 5:** Pre-commit verification, then commit: `Resolve collection display labels`.

---

### Task 6: `pendingRemovals` (R9–R15, stack data for AC67)

**Files:**
- Create: `src/testing/fakeTimer.ts` (move `fakeTimer` out of `previewEngine.test.ts`, and add
  `msOf(id): number | undefined` recording the requested delay)
- Modify: `src/previewEngine.test.ts` (import the shared fake)
- Modify: `src/types/domain.ts`, `src/spotify/ports.ts`
- Create: `src/pendingRemovals.ts`
- Test: `src/pendingRemovals.test.ts`

**Interfaces:**
- Produces (domain): `type RemovePort = (playlistUri: string, trackUri: string) => Promise<void>`.
- Produces:
  ```ts
  export const UNDO_WINDOW_MS = 5000;
  export interface PendingRemovalEntry { handle: number; trackTitle: string; playlistName: string }
  export function removalFailedMessage(trackTitle: string, playlistName: string): string; // "Couldn't remove X from Y"
  export function createPendingRemovals(deps: { timer: TimerPort; remove: RemovePort; onError(trackTitle: string, playlistName: string): void }): {
    schedule(playlistUri: string, playlistName: string, track: TrackRef): number;
    undo(handle: number): boolean;
    marker(): number;                     // monotonic; a session records it at start
    isExcluded(playlistUri: string, trackUri: string, sessionMarker: number): boolean;
    list(): PendingRemovalEntry[];        // pending only, oldest first
    subscribe(listener: () => void): () => void;
  };
  export type PendingRemovals = ReturnType<typeof createPendingRemovals>;
  ```
- Produces (ports): `playlistRemove: RemovePort` using the r1 call shape (Task 2).

**Decision (states it for the implementer):** once issued, a removal is no longer pending, so it
leaves `list()` at issuance (AC67). It keeps excluding T on P while the call is **in flight**, and
stops if the call rejects. If the call succeeds, it excludes T only in sessions whose marker
predates the success.

- [ ] **Step 1: Write the failing tests** (`P = "spotify:playlist:P"`, `a = { uri: "spotify:track:a", name: "Title", artist: "X" }`)

```ts
it("R9: no call before the deadline; one URI-form call when it fires", () => {
  const h = setup(); h.pr.schedule(P, "Chill Mix", a);
  expect(h.remove).not.toHaveBeenCalled();
  const [id] = h.timer.ids(); expect(h.timer.msOf(id!)).toBe(UNDO_WINDOW_MS);
  h.timer.fire(id!); expect(h.remove).toHaveBeenCalledExactlyOnceWith(P, "spotify:track:a");
});
it("R11: undo before issuance cancels; undo after issuance returns false", async () => {
  // undo → true, timer cleared, remove never called
  // second removal: fire → undo(handle) false (in flight) → resolve → undo(handle) false
});
it("R12: two removals of the same URI are independent", () => { /* undo(h1); fire h2 → one call */ });
it("R13: a pending removal excludes T on P for sessions started before and after it, never on Q", () => {
  const m0 = h.pr.marker(); h.pr.schedule(P, "Chill Mix", a); const m1 = h.pr.marker();
  expect(h.pr.isExcluded(P, a.uri, m0)).toBe(true); expect(h.pr.isExcluded(P, a.uri, m1)).toBe(true);
  expect(h.pr.isExcluded("spotify:playlist:Q", a.uri, m0)).toBe(false);
});
it("R13: in flight still excludes; after success only sessions started before it", async () => { /* m0 before; fire; excluded(m0); resolve; excluded(m0) true; m2 = marker(); excluded(m2) false */ });
it("R14: undone or failed removals exclude nothing", async () => { /* undo → false for m0; reject → false for m0 */ });
it("R15: a rejected commit reports the captured title and playlist name, no retry", async () => {
  // reject → onError called once with ("Title", "Chill Mix"); remove called once in total
  expect(removalFailedMessage("Title", "Chill Mix")).toBe("Couldn't remove Title from Chill Mix");
});
it("AC67: list is pending-only, oldest first; listeners fire on schedule, undo and issuance", () => {
  // schedule a, b → list handles [ha, hb] with trackTitle/playlistName; undo(ha) → [hb];
  // fire hb → [] before remove settles; listener call count 4; unsubscribe stops calls
});
it("marker() is monotonic", () => { /* m1 > m0 after any schedule / settle */ });
```

- [ ] **Step 2:** `bun run test src/pendingRemovals` → FAIL (module missing).
- [ ] **Step 3: Implement** `createPendingRemovals`, `removalFailedMessage`, `UNDO_WINDOW_MS`, and
  `playlistRemove` in `ports.ts`. Keep the per-handle state `pending | inFlight | done`.
  Succeeded removals are kept as `{ playlistUri, trackUri, succeededAt: marker }`.
- [ ] **Step 4:** `bun run test` → PASS (engine tests still pass on the shared fake).
- [ ] **Step 5:** Pre-commit verification, then commit: `Add pending removals with undo window`.

---

### Task 7: Engine — excluded tracks, `trackCompleted`, `currentTrack` (R6–R8, R13, AC53)

**Files:**
- Modify: `src/types/domain.ts` (`EngineEvent`)
- Modify: `src/previewEngine.ts`
- Test: `src/previewEngine.test.ts`

**Interfaces:**
- Produces: `EngineDeps.isExcluded?: (uri: string) => boolean`. A new event
  `{ type: "trackCompleted"; index: number; total: number; track: TrackRef }`, emitted only on
  normal completion (duration expiry or natural end), before the gap. It tells the panel to hold
  the bar full (AC53). `engine.currentTrack(): TrackRef | null`: `queue[index]` while previewing,
  including during resolution and during the gap; `null` when idle.

- [ ] **Step 1: Write the failing tests** (extend `harness` with `isExcluded`)

```ts
it("R13: an excluded entry is not resolved, emits nothing and is not counted", async () => {
  // queue [a,b,c], excluded = {b}; after a's timer fires → trackStarted c (index 2);
  // resolve never called with b; no event for b; final sessionEnded.skipped === 0
});
it("R13: an excluded starting entry is passed over", async () => { /* [a,b], excluded {a} → first event trackStarted index 1 */ });
it("R13: exclusion is evaluated when the entry is reached", async () => { /* start [a,b]; then exclude b; fire a's timer → sessionEnded completed */ });
it("Review focus 3: a later copy of a removed track is passed over", async () => { /* [a,b,a']; a and a' share a uri; exclude that uri after start → after b, sessionEnded completed */ });
it("R8: skip with an all-excluded suffix ends completed", async () => { /* [a,b], exclude b, skip() on a → sessionEnded { reason: "completed", skipped: 0 } */ });
it("AC53: trackCompleted on duration expiry and natural end, not on skip/missing/error", async () => { /* four cases */ });
it("R6: currentTrack is the entry while resolving and during the gap; null when idle", async () => { /* deferred resolve → a; gap>0 after timer → a; after stop → null */ });
it("R7: after skip during resolution, a late URL plays nothing and emits nothing", async () => {});
it("R7: after skip during resolution, a late null is not counted", async () => {});
it("R7: after skip during resolution, a late rejection does not abort", async () => {});
```

- [ ] **Step 2:** `bun run test src/previewEngine` → FAIL.
- [ ] **Step 3: Implement.** In `playCurrent`, before the end-of-queue check, run
  `while (index < queue.length && deps.isExcluded?.(queue[index]!.uri)) index += 1;` (a loop, not
  recursion, so a long excluded run can't grow the stack). Emit `trackCompleted` at the top of
  `onNormalComplete`, after the generation guard.
- [ ] **Step 4:** `bun run test` → PASS. The controller's `switch` compiles because it lists cases
  and has no exhaustiveness check.
- [ ] **Step 5:** Pre-commit verification, then commit: `Pass over excluded tracks and report normal completion`.

---

### Task 8: Panel view-model, key mapping, progress (AC47, AC48, AC52, AC53, AC61, AC66, AC68)

**Files:**
- Modify: `src/types/domain.ts`, `src/spotify/ports.ts`
- Create: `src/ui/previewPanel.view.ts`
- Test: `src/ui/previewPanel.view.test.ts`

**Interfaces:**
- Produces (domain):
  ```ts
  export type ProgressMode = "live" | "full" | "empty";
  export interface PanelView {
    state: "playing" | "skipping";
    heading: string;              // "Title — Artist", or "Title" when artist is ""
    artworkUrl: string | null;    // null → placeholder (always null when skipping)
    sourceText: string;           // "From: Chill Mix · 4/37" or "Single track"
    indicator: string | null;     // "No preview — skipping" when skipping
    nextDisabled: boolean;        // current entry is the last queue entry
    removeLabel: string | null;   // "Remove from Chill Mix"; null → no Remove button
    progress: ProgressMode;
  }
  export interface PanelPort { open(view: PanelView): void; update(view: PanelView): void; close(): void }
  export interface ProgressSample { elapsedMs: number; clipDurationMs: number }
  export interface ProgressSource { sample(): ProgressSample | null }  // null when no clip is loaded
  ```
  `AudioPort` stays unchanged, so the engine can't see progress (spec purity note).
  `createAudioPort()` returns `AudioPort & ProgressSource`.
- Produces (`previewPanel.view.ts`):
  ```ts
  export interface SessionContext { label: string | null /* null = single-track */; removable: boolean }
  export function toPanelView(i: { state: "playing" | "skipping"; track: TrackRef; index: number; total: number; session: SessionContext; progress: ProgressMode }): PanelView;
  export const PANEL_KEYS: ReadonlySet<string>; // "ArrowRight", "Delete", "Escape" — always consumed inside the panel
  export function panelKeyAction(e: { key: string; repeat: boolean }, view: PanelView): "next" | "remove" | "close" | null;
  export function progressFraction(sample: ProgressSample | null, durationCapMs: number): number; // 0..1
  ```

- [ ] **Step 1: Write the failing tests**

```ts
const song = { uri: "spotify:track:s", name: "Song", artist: "Band", artworkUrl: "u" };
const coll = { label: "Chill Mix", removable: true };
it("AC47/AC48/AC68: playing view in a removable collection session", () => {
  expect(toPanelView({ state: "playing", track: song, index: 3, total: 37, session: coll, progress: "live" })).toEqual({
    state: "playing", heading: "Song — Band", artworkUrl: "u", sourceText: "From: Chill Mix · 4/37",
    indicator: null, nextDisabled: false, removeLabel: "Remove from Chill Mix", progress: "live" });
});
it("AC48: single-track session shows the indicator and no counter", () => {
  const v = toPanelView({ state: "playing", track: song, index: 0, total: 1, session: { label: null, removable: false }, progress: "live" });
  expect(v.sourceText).toBe("Single track"); expect(v.sourceText).not.toMatch(/\d+\/\d+/); expect(v.nextDisabled).toBe(true);
});
it("AC52: Next disabled on the last entry only", () => { /* index 36/37 → true; 35/37 → false */ });
it("AC68/R2: not removable → no Remove label", () => {});
it("AC47: absent artwork → null", () => {});
it("AC61: skipping view — indicator, placeholder, empty bar, counter only for collections", () => {
  // collection: state "skipping", indicator "No preview — skipping", artworkUrl null (despite "u"), progress "empty", sourceText "From: Chill Mix · 4/37"
  // single-track: sourceText "Single track"
});
it("Review focus 4: empty artist → heading is the title alone", () => { /* artist "" → "Song" */ });
it("AC66: key mapping", () => {
  // ArrowRight → "next"; ArrowRight with nextDisabled → null; Delete removable → "remove";
  // Delete not removable → null; Escape → "close"; "a" → null; PANEL_KEYS has exactly the three
});
it("Review focus 2: auto-repeated Delete does nothing", () => { /* { key: "Delete", repeat: true } → null */ });
it("AC53: progress against the effective preview window", () => {
  expect(progressFraction({ elapsedMs: 5000, clipDurationMs: 30000 }, 15000)).toBeCloseTo(1 / 3);
  expect(progressFraction({ elapsedMs: 3000, clipDurationMs: 10000 }, 15000)).toBeCloseTo(0.3);
  expect(progressFraction({ elapsedMs: 3000, clipDurationMs: NaN }, 15000)).toBeCloseTo(0.2);
  expect(progressFraction({ elapsedMs: 99999, clipDurationMs: 30000 }, 15000)).toBe(1);
  expect(progressFraction(null, 15000)).toBe(0);
});
```

- [ ] **Step 2:** `bun run test src/ui/previewPanel.view` → FAIL.
- [ ] **Step 3: Implement** the view module and the domain types. In `createAudioPort`, `sample()`
  returns `null` while `handlers === null`, else `{ elapsedMs: el.currentTime * 1000, clipDurationMs: el.duration * 1000 }`.
- [ ] **Step 4:** `bun run test` → PASS.
- [ ] **Step 5:** Pre-commit verification, then commit: `Add preview panel view-model`.

---

### Task 9: Panel and pending-removals stack UI (AC46 mount, AC47, AC66 focus/keys, AC67, AC68, AC70)

No unit tests: vitest has no React (it is aliased to `Spicetify.React`). Behaviour is checked live
in Task 11. The pure logic is already tested in Tasks 6 and 8.

**Files:**
- Create: `src/ui/previewPanel.tsx`, `src/ui/pendingRemovalsStack.tsx`, `src/ui/previewPanel.css`

**Interfaces:**
- Consumes: `PanelView`, `PanelPort`, `panelKeyAction`, `PANEL_KEYS` (Task 8); `PendingRemovalEntry` (Task 6).
- Produces:
  ```ts
  export interface PreviewPanelDeps {
    onStop(): void; onClose(): void; onNext(): void; onRemove(): void;
    progress(): number;   // live fraction 0..1, polled per animation frame while view.progress === "live"
    removals: { list(): PendingRemovalEntry[]; subscribe(l: () => void): () => void; undo(handle: number): boolean };
  }
  export function createPreviewPanel(deps: PreviewPanelDeps): PanelPort;  // previewPanel.tsx
  export function PendingRemovalsStack(props: { removals: PreviewPanelDeps["removals"] }): React.ReactElement | null; // pendingRemovalsStack.tsx
  ```

Behaviour the code must have:

- [ ] **Step 1: Mount.** `createPreviewPanel` creates `div#tpp-preview-root` in `<body>` once
  (reuses it if present) and renders one tree with the stack and the panel, using the render API
  from spike p1. The stack is always mounted. The panel renders only while a view is set.
- [ ] **Step 2: Port.** `open(view)` sets the view and moves keyboard focus to the panel's root
  `<section tabIndex={-1} aria-label="Preview">`, every call, including a replacement.
  `update(view)` sets the view without touching focus. `close()` clears the view and **never**
  calls `onClose` or `onStop` (AC51).
- [ ] **Step 3: Keys.** Handle `onKeyDown` on the section. If `PANEL_KEYS.has(e.key)`, call
  `preventDefault()` + `stopPropagation()`, then dispatch `panelKeyAction` to `onNext` / `onRemove` /
  `onClose`. Other keys, and keys outside the panel, are untouched (AC66).
- [ ] **Step 4: Contents.** From top to bottom:
  - ✕ close (aria-label "Close preview", icon `x`) → `onClose`.
  - Artwork `<img key={artworkUrl}>`, which swaps to a neutral placeholder box on `onError` or when
    `artworkUrl` is null.
  - `heading`, `sourceText`, and `indicator` when set.
  - Progress bar: width `1` for `"full"`, `0` for `"empty"`, `deps.progress()` per rAF for `"live"`.
    Cancel the loop when the mode changes or on unmount.
  - Buttons: Stop (hand-written square `<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10"/></svg>`
    + "Stop"), Next (`skip-forward` + "Next", `disabled={nextDisabled}`), and Remove only when
    `removeLabel` is set (`minus` + "Remove", `aria-label={removeLabel}`, pushed right with
    `margin-left: auto`).

  `SVGIcons` markup goes through `dangerouslySetInnerHTML` on an `<svg viewBox="0 0 16 16" fill="currentColor">`.
  Button `className` is read at render time from
  `document.querySelector('[data-encore-id="buttonTertiary"]')?.className ?? ""`.
- [ ] **Step 5: Stack.** Subscribe on mount and unsubscribe on unmount. Render nothing when
  `list()` is empty. Otherwise render one row per entry, oldest first, so the newest sits at the
  bottom, nearest the panel: `Removed {trackTitle} from {playlistName}` + an "Undo" button →
  `removals.undo(handle)`.
- [ ] **Step 6: CSS (`previewPanel.css`, imported by `previewPanel.tsx`).**
  - Panel: `position: fixed`, `right: 16px`, width `280px`, and a **fixed height** so the stack's
    anchor doesn't move when the panel closes. `bottom` sits 16 px above the Playbar: at `open()`,
    measure the p2 Playbar selector's height and write it to a CSS variable, falling back to `104px`.
  - Stack: `position: fixed; right: 16px; bottom: <panel bottom + panel height + 8px>`, with
    `max-height` bounded to the viewport below the top bar, `overflow-y: auto`, and a flex column.
  - `z-index` from spike p1.
  - Colours only from `--background-elevated-base`, `--text-base`, `--text-subdued`. No `e-NNNNN` class.
- [ ] **Step 7:** `bun run check && bun run build:local`. Expected: PASS and a bundle in `./dist/`.
  `grep -rE 'e-[0-9]' src/` → empty.
- [ ] **Step 8:** Pre-commit verification, then commit: `Add preview panel and pending-removals stack UI`.

---

### Task 10: Controller + wiring (AC46, AC49–AC52, AC55–AC57, AC61, R1–R6, R13 binding)

The controller changes, `index.ts` and the Playbar deletion land in one commit, because `tsc`
checks `index.ts` against the new `ControllerDeps`.

**Files:**
- Modify: `src/previewController.ts`, `src/index.ts`
- Delete: `src/ui/playbarControls.ts`, `src/ui/playbarControls.test.ts`
- Test: `src/previewController.test.ts` (new)

**Interfaces:**
- Consumes: `PanelPort`, `toPanelView` (Task 8); `PendingRemovals` (Task 6);
  `createCollectionLabel`, `playlistMetadata` (Task 5); `engine.currentTrack`, `trackCompleted`,
  `isExcluded` (Task 7); `createPreviewPanel` (Task 9); `playlistRemove` (Task 6);
  `createAudioPort().sample` (Task 8).
- Produces:
  ```ts
  export interface ControllerDeps {
    engine: PreviewEngine; coordinator: PlayerCoordinator;
    enumerate(uri: string): Promise<TrackRef[]>; fetchTrackRef(uri: string): Promise<TrackRef>;
    collectionTypeForUri(uri: string): CollectionType | null;
    notify: { info(m: string): void; error(m: string): void };
    highlight: { set(uri: string): void; clear(): void };
    onActiveCollection(uri: string | null): void;
    panel: PanelPort;
    collectionLabel(uri: string, type: CollectionType): Promise<string>;
    playlistMetadata: PlaylistMetadataPort;
    pendingRemovals: Pick<PendingRemovals, "schedule" | "marker" | "isExcluded">;
  }
  // returned object adds: next(): void; removeCurrent(): void; isExcluded(trackUri: string): boolean
  ```

Session start (`beginSession`):
1. Empty queue → `"Nothing to preview"`, no panel.
2. Bump a start sequence number.
3. Resolve `label` (collection sessions only) and `removable` in parallel.
   `removable = type === "playlist" && (await playlistMetadata(uri)).canRemove === true`, and a
   rejection gives `false`.
4. If the sequence has moved on, return (Review focus 1).
5. Store `session = { collectionUri, type, label, removable, marker: pendingRemovals.marker() }`.
6. `coordinator.acquire()`, `onActiveCollection`, then `panel.open(toPanelView({ state: "playing", track: queue[startIndex], index: startIndex, total, session, progress: "empty" }))`,
   then `engine.start`.

Keep the last view so `trackCompleted` / `next()` can re-emit it with a different `progress`.

- [ ] **Step 1: Write the failing tests** (fake engine `{ start, skip, stop, isActive, currentIndex, currentTrack }`,
  fake panel, `pendingRemovals` with `marker: () => 7`, `playlistMetadata` resolving `{ canRemove: true }`,
  `collectionLabel` resolving `"Chill Mix"`, classify by URI prefix)

```ts
it("AC46: start opens the panel on the starting entry, then starts the engine", async () => { /* open called once before engine.start(queue, 0) */ });
it("AC46: empty queue → notice, no panel, no acquire", async () => {});
it("AC49/AC56: trackStarted updates in place with live progress, highlights, no per-track notice", () => {});
it("AC61: trackSkipped updates with the skipping view", () => {});
it("AC53: trackCompleted re-emits the last view with progress full", () => {});
it("AC55: completed/stopped/aborted close the panel and release; replaced does neither", () => {});
it("AC55: a replacement re-opens (focus) on its starting entry", async () => { /* startFromHere at index 2 → open view heading of queue[2] */ });
it("AC50: stop() stops the engine once; the stopped sessionEnded releases the coordinator", () => {});
it("AC51: a controller-driven close never stops the engine", () => { /* sessionEnded stopped → engine.stop not called */ });
it("AC52: next() empties the bar then skips; idle → nothing", () => {});
it("R1: literal true canRemove gives a Remove label; metadata read once per session", async () => {});
it("R2: 'true', 1, undefined, Liked Songs, album, artist, single track, from-here fallback → no Remove", async () => {});
it("R3: metadata rejection → session starts, no Remove", async () => {});
it("R4: Preview from here inside P starts at the selected entry and removes from P", async () => {});
it("R5: removeCurrent in a non-removable session schedules nothing and does not skip", async () => {});
it("R6: removeCurrent schedules the current entry on P with the label, then skips, synchronously", async () => {
  // expect(schedule).toHaveBeenCalledWith("spotify:playlist:P", "Chill Mix", a); schedule before skip (invocationCallOrder)
});
it("R15 name: a playlist with no name uses the generic label for removals", async () => { /* collectionLabel → "Playlist" → schedule(..., "Playlist", ...) */ });
it("R13: isExcluded binds to the source playlist and the session marker", async () => { /* → pendingRemovals.isExcluded(P, uri, 7); album session / idle → false, not called */ });
it("Review focus 1: the later of two overlapping starts wins", async () => {
  // A's metadata deferred; start A; start B (resolves); resolve A → engine.start called once, with B's queue
});
```

- [ ] **Step 2:** `bun run test src/previewController` → FAIL.
- [ ] **Step 3: Implement the controller.** Also:
  - `stop()` is unchanged.
  - `next()`: when active, `panel.update({ ...lastView, progress: "empty" })`, then `engine.skip()`.
  - `removeCurrent()`: return unless `session?.removable && engine.isActive()`. Otherwise
    `schedule(session.collectionUri, session.label, engine.currentTrack())`, then the same
    update + skip as `next()`.
  - `isExcluded(uri)`: `session?.type === "playlist"` → `pendingRemovals.isExcluded(session.collectionUri, uri, session.marker)`, else `false`.
  - On non-replaced `sessionEnded`: `panel.close()`, `highlight.clear()`, `coordinator.release()`,
    `session = null`, then the existing notices.
- [ ] **Step 4: Wire `index.ts`.**
  - Drop `Spicetify.Playbar` from the namespace wait loop, and the `playbar` import and dep.
  - `const audio = createAudioPort()`.
  - `pendingRemovals = createPendingRemovals({ timer: realTimer, remove: playlistRemove, onError: (t, p) => notifications.error(removalFailedMessage(t, p)) })`.
  - `panel = createPreviewPanel({ onStop: () => controller.stop(), onClose: () => controller.stop(), onNext: () => controller.next(), onRemove: () => controller.removeCurrent(), progress: () => progressFraction(audio.sample(), settings.getDurationMs()), removals: pendingRemovals })`.
  - The engine gets `isExcluded: (uri) => controller.isExcluded(uri)`.
  - The controller gets `panel`,
    `collectionLabel: createCollectionLabel({ playlistMetadata, artistOverview: artistOverviewRequest })`,
    `playlistMetadata` and `pendingRemovals`.
- [ ] **Step 5:** Delete `src/ui/playbarControls.ts` and `.test.ts`. `grep -rn 'playbarControls\|Playbar' src/`
  → only the stale comment in `index.ts`, if any. Remove that too (AC57).
- [ ] **Step 6:** `bun run check` → PASS.
- [ ] **Step 7:** Pre-commit verification, then commit: `Drive the preview panel from the controller and remove Playbar controls`.

---

### Task 11: Live verification over CDP

**Files:** none, unless a defect is found (fix it inside this task and commit it).

- [ ] **Step 1:** `bun run build && spicetify apply` (restarts Spotify). Confirm
  `Spicetify.Modules.report` shows the module loaded.
- [ ] **Step 2: Verify each item over `scripts/cdp-eval.mjs`, recording expression → result:**
  - AC46/AC49: start a playlist session. `#tpp-preview-root section` exists, and heading and
    counter change after a skip.
  - AC65: `Spicetify.Platform.History.push("/search")`. The panel persists, the engine stays active,
    and `elementFromPoint` outside the panel hits the page.
  - AC66: `document.activeElement` is inside the panel after start. A dispatched `ArrowRight`
    keydown on the panel advances. The same keydown on `document.body` does not.
  - AC70: at a 1280×800 window, the panel's and stack's rects don't intersect the Playbar rect or
    the notice container rect. `PopupModal.display` puts the overlay above the panel
    (`elementFromPoint`).
  - AC53: sample the bar's width twice during a clip (increasing). Set gap to 3000 ms and read the
    width during the gap (100%). After Next, the width is 0 until the next track starts.
  - AC47/AC61: a track with no preview shows "No preview — skipping" and the placeholder.
  - R1/R2: Remove is present on an owned throwaway playlist and absent on a followed playlist,
    Liked Songs and an album.
  - R6/R9/R11/AC67, **on a throwaway playlist the agent creates and deletes in a `finally`**:
    - Remove shows a stack row and advances.
    - Undo keeps the track.
    - Remove again and wait for `UNDO_WINDOW_MS`: the row leaves and `getContents` no longer lists
      the track.
  - Review focus 5: schedule 15 removals on the throwaway playlist. The stack scrolls within the
    viewport. Undo all of them.
  - Greps: `grep -rE 'e-[0-9]' src/`, `grep -rn sha256Hash src/`, `grep -rn Spicetify src/pendingRemovals.ts src/previewEngine.ts`,
    and `grep -rn 'PlaylistAPI\.\(remove\|getMetadata\)' src/` (only `spotify/ports.ts`). All
    empty or as stated.
- [ ] **Step 3:** If you fixed anything: pre-commit verification, then commit:
  `Fix <defect> found in live panel verification`.

---

### Task 12: Update `CLAUDE.md`

- [ ] **Step 1:** Architecture line: add `ui/previewPanel` and `pendingRemovals`. Add one
  non-obvious constraint: *Never use `Spicetify.PopupModal` for an in-session surface; notices
  render beneath it (see the panel spec).* Keep the file ≤300 lines.
- [ ] **Step 2:** Pre-commit verification, then commit: `Document the preview panel in CLAUDE.md`.

### Task 13: Update `README.md`

- [ ] **Step 1:** Replace the "Skip and Stop appear in the playbar" bullet with the preview panel:
  artwork, progress, Stop / Next / Remove, shortcuts `→` / `Delete` / `Esc` while the panel has
  focus, the Undo stack, and Remove on editable playlists only.
- [ ] **Step 2:** Pre-commit verification, then commit: `Document the preview panel in the README`.

### Task 14: Update `docs/specs/2026-07-22-track-playlist-preview-design.md`

- [ ] **Step 1:** Back-annotate AC33 (superseded → panel spec AC57), AC38 (superseded → AC56), and
  AC8 / AC13 (Playbar clause struck; AC8 gains "no panel opens"; AC13 panel closes with
  `sessionEnded`). Each gets a pointer to `2026-07-25-preview-modal-design.md`. Confirm the remove
  spec's "Documentation Updates" rows are already done (no edit expected).
- [ ] **Step 2:** Commit: `Back-annotate shipped criteria superseded by the preview panel`.

---

### Task 15: Deferred-item check

- [ ] **Step 1:** All deferred items in both specs are **UNFILED** by the user's choice: Add to
  playlist from the panel, and Un-like from Liked Songs. Ask the user whether to file them before
  finishing the branch. **Never auto-file.** If they file any, run `gh issue view <#> --json body | jq -r .body`
  and grep for the four headings: Context, Required, Integration Points, Priority.

### Task 16: Post-implementation check

- [ ] **Step 1:** Read `git diff v3-beta...HEAD --stat` and the diff itself. Confirm:
  - every file in the Config & Infrastructure Impact mapping above changed as stated;
  - docs Tasks 12–14 landed;
  - spike results are recorded;
  - no glossary or ADR work was expected (both dropped in the spec).

  Don't trust checkbox markings.

### Task 17: Final build

- [ ] **Step 1:** `bun run build`. Fix any issue until it builds. Then `bun run check` → PASS.

**Before finishing the branch (advisory, never gates):** if the Codex plugin is available, run its
adversarial review with focus: *"Judge correctness against the spec's acceptance criteria (AC46–AC70
as listed in the preview-panel spec, the shipped-spec changes it lists, and R1–R16 of the remove
spec) only. Do not flag anything outside the stated criteria — no design alternatives, hardening,
or scope the spec did not claim."* Then use `superpowers:finishing-a-development-branch`.
