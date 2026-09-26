# Remove From Playlist — Design Spec

**Date:** 2026-09-26
**Status:** Approved — amends the preview modal; built as part of it, not on its own
**Builds on:** [`2026-07-25-preview-modal-design.md`](2026-07-25-preview-modal-design.md) (approved,
not yet implemented) and [`2026-07-22-track-playlist-preview-design.md`](2026-07-22-track-playlist-preview-design.md)
(the shipped extension). Criteria here are numbered **R1…** so they cannot collide with the modal
spec's AC numbering, which is expected to change when the modal is re-grilled.

---

## Problem

Previewing a playlist is often triage: you listen to each clip and decide whether it stays. Today,
dropping a track means leaving the preview flow and using Spotify's own row menu. This feature adds
a one-click **Remove** control to the preview modal. It removes the track being previewed from the
playlist the session was started from and moves straight on to the next track.

## Scope decision

Remove is a **third control of the preview modal**, alongside Stop and Next. It is **not** a
Playbar button: the modal spec removes the Playbar controls (its AC57), so a Playbar Remove would
be thrown away. Nothing in this spec is built until the modal is built. This document is an input
to the modal's own design session and implementation plan.

**Left to the modal design session** (deliberately not decided here):

- **Where the Undo affordance appears**: native `Spicetify.Snackbar.enqueueSnackbar` action
  vs. an in-modal "Removed *X* · Undo" strip. Whichever is chosen must satisfy R8 for **every**
  removal, including one that ends the session (R6). A Snackbar survives the modal closing, and an
  in-modal strip does not. If the Snackbar is chosen, spike that it renders above an open
  `PopupModal` and is clickable there.
- The Remove control's placement, label and icon (`Spicetify.SVGIcons` has `minus` and `block`).

## Terms

Spec-local (no `CONTEXT.md` glossary exists). Extends the Terms of both prior specs.

| Term | Meaning |
| --- | --- |
| **Source playlist** | The playlist URI a preview session was started from: via the action bar, the collection context menu, or *Preview from here* inside that playlist. Single-track sessions have none. |
| **Removable session** | A session whose source playlist classifies as `playlist` **and** whose `PlaylistAPI.getMetadata(uri).canRemove` is `true` when the session starts. |
| **Pending removal** | A removal the user has requested but that has not yet been sent to Spotify. It lasts one undo window. |
| **Undo window** | `UNDO_WINDOW_MS` (constant, 5000 ms). The time between pressing Remove and the `PlaylistAPI.remove` call. |
| **Excluded track** | A track URI with a pending or committed removal from the current source playlist that has not been undone. The engine passes over excluded tracks. |

_Avoid:_ "delete" (Spotify's term for deleting a whole playlist); "unlike" (Liked Songs are out of
scope, see Deferred Items).

---

## Investigation Findings

Verified live over CDP (`scripts/cdp-eval.mjs`, Spotify 1.2.96.518) on 2026-09-26.

- **`PlaylistAPI.remove(playlistUri, rows)`**: `rows` is `[{ uri, uid }]`. If any `uid` is
  non-empty, the request removes those **rows**. If every `uid` is empty, it sends
  `{ uris: [...] }` and removes **by track URI**. This design uses the URI form (R4). Still to
  confirm by spike: the URI form removes **all** copies of a duplicated track.
- **`PlaylistAPI.getMetadata(uri)`** exposes `canAdd`, `canRemove`, `canEditItems` and
  `permissions`. `canRemove` is `true` on an owned playlist and `false` on a followed one
  (both checked).
- **`PlaylistAPI.getContents`** items carry a per-row `uid`. It is not needed for URI-form removal
  and is not added to `TrackRef`.
- **`LibraryAPI.remove`** exists (un-liking a track from Liked Songs). Not used; see Deferred Items.
- **`Spicetify.Snackbar.enqueueSnackbar`** is live (native toast, can take an action button).
  Relevant to the Undo-surface choice left to the modal session.

---

## Design

### Behaviour

1. At session start, the controller decides whether the session is a **removable session**: the
   source URI classifies as `playlist` and `getMetadata(uri).canRemove === true`. The lookup runs
   once per session and also captures the playlist's `name` for the failure Snackbar (behaviour 8).
   If it rejects, the session is **not** removable, and the session itself still starts normally.
2. The modal shows the Remove control only in a removable session.
3. Pressing Remove:
   - schedules a **pending removal** of the current track's URI from the source playlist, and
   - advances to the next track **immediately**. This is the same path as Next: no inter-track gap,
     and not counted as a "skipped, no preview" track. On the last queue entry, the session ends
     normally (`completed`) and the modal closes.
4. After `UNDO_WINDOW_MS`, the pending removal commits by calling
   `PlaylistAPI.remove(sourcePlaylist, [{ uri, uid: "" }])`. This removes **every** copy of the
   track.
5. **Undo** within the window cancels the pending removal. No Spotify call is made and the playlist
   is untouched (original position, date added and row id preserved).
6. Each removal has its **own** independent window and Undo. Removals are independent of the
   session: Stop, closing the modal, completion or abort neither cancel nor flush a pending removal.
7. **Excluded tracks:** when the engine reaches a track whose URI has a pending or committed removal
   from this session's source playlist (not undone), it passes over it without playing it, without
   emitting `trackStarted` or `trackSkipped`, and without counting it in the end-of-session summary.
   If Undo happened before the engine reached it, the track plays normally.
8. **Failure:** if the commit call rejects, show an error Snackbar "Couldn't remove *Title* from
   *Playlist*". No retry. The track stays excluded for the rest of the session (the user already
   rejected it); the playlist is unchanged.

### Modules

| Module | Change | Responsibility |
| --- | --- | --- |
| `pendingRemovals` | **new, pure** | `schedule(playlistUri, track) → handle`, `undo(handle) → boolean`, `isExcluded(playlistUri, uri)`. Timer and remove call are injected ports (`TimerPort`, `RemovePort`), the same pattern as `previewEngine`. Owns the window, the commit, and failure reporting via an injected `onError(track, playlistUri)`. |
| `previewEngine` | change | Optional `isExcluded(uri): boolean` dep. Checked in `playCurrent` before resolving. An excluded track advances immediately with no event and no count. |
| `previewController` | change | Computes the removable-session flag at session start via a `canRemove(uri)` port. Exposes it to the modal view. Adds `removeCurrent()`, which calls `pendingRemovals.schedule(...)` then `engine.skip()`. Binds the engine's `isExcluded` to the current source playlist. |
| `types/domain` | change | Add `RemovePort` (`(playlistUri, trackUri) => Promise<void>`) and the `isExcluded` engine dep type. |
| `spotify/ports` | change | `playlistRemove: RemovePort` over `Platform.PlaylistAPI.remove`; `canRemove(uri)` over `getMetadata`. These are the only new `Spicetify` touches. |
| `ui/previewModal` | change (modal spec) | Renders Remove when the view says the session is removable. Wires it to `controller.removeCurrent()`. Hosts or triggers the Undo affordance the modal session picks. |
| `index.ts` | change | Build `pendingRemovals` with `realTimer`, `playlistRemove`, `notifications.error`. Pass it to the engine and controller. |

`pendingRemovals` is deliberately not inside the engine: removals outlive sessions (behaviour 6),
and the engine resets per session.

### Testing

Vitest, `*.test.ts` convention, fake `TimerPort` and `RemovePort`:

- `pendingRemovals.test.ts`: commit fires exactly once after `UNDO_WINDOW_MS` with URI-form rows;
  undo inside the window prevents the call; undo after commit returns `false`; independent
  handles; `isExcluded` true while pending/committed, false after undo; a rejected commit reports
  via `onError` and keeps the URI excluded.
- `previewEngine.test.ts`: excluded tracks pass over with no `trackStarted`/`trackSkipped` and do
  not raise the `skipped` count; an excluded last entry ends the session `completed`.
- `previewController.test.ts` (created by the modal work): removable flag true/false/rejected;
  `removeCurrent` schedules then skips synchronously; not removable → `removeCurrent` is a no-op.

Manual CDP verification: the URI-form spike (R4 duplicates) and the Undo surface (R8).

---

## Acceptance Criteria

- **R1**: Given a session started from a playlist whose `getMetadata` reports `canRemove: true`,
  the preview modal shows a Remove control.
- **R2**: Given a session started from a playlist with `canRemove: false`, from Liked Songs, an
  album, an artist, or as a single-track session, the preview modal shows **no** Remove control.
- **R3**: Given the `canRemove` lookup rejects at session start, the session starts and runs
  normally and the modal shows no Remove control.
- **R4**: When Remove is pressed, the next track starts without waiting for `UNDO_WINDOW_MS` or
  any Spotify call. No inter-track gap is applied, and the end-of-session "skipped" count does not
  increase.
- **R5**: Given Remove was pressed and not undone, exactly `UNDO_WINDOW_MS` later exactly one
  `PlaylistAPI.remove(sourcePlaylist, [{ uri: trackUri, uid: "" }])` call is made, and afterwards
  the playlist contains **no** row with that track URI (all duplicates removed; spike-verified).
- **R6**: Given Remove is pressed on the last entry in the preview queue, the session ends as
  `completed` and the modal closes, and the removal still commits per R5 unless undone.
- **R7**: Given Remove was pressed and the session then ends by any cause (Stop, modal close,
  completion, abort) inside the undo window, the removal still commits per R5 at the end of its
  window unless undone. Ending the session neither cancels nor commits it early.
- **R8**: Given Remove was pressed, an Undo affordance is available for the full `UNDO_WINDOW_MS`,
  including after the session has ended. Using it makes no `PlaylistAPI.remove` call, and the
  playlist's rows (position, date added, row id) are unchanged.
- **R9**: Given two Removes pressed at different times, each commits at the end of its own window,
  and undoing one has no effect on the other.
- **R10**: Given track T was removed and not undone, and T appears again later in the preview
  queue, then when the engine reaches it, T is not played, no `trackStarted`/`trackSkipped` event is
  emitted for it (the modal shows no skipping state), and it is not counted in the end-of-session
  summary.
- **R11**: Given track T was removed and then undone before the engine reached a later copy of T,
  that copy plays normally.
- **R12**: Given the commit call rejects, an error Snackbar "Couldn't remove *Title* from
  *Playlist*" is shown, no retry is made, the session (if still active) is unaffected, and T stays
  excluded for the rest of that session (R10 still applies).
- **R13**: Only `spotify/ports` calls `Spicetify.Platform.PlaylistAPI.remove` / `getMetadata` for
  this feature; `pendingRemovals` and `previewEngine` import no `Spicetify` global (verified by
  grep in review).

---

## Deferred Items

Recorded as **UNFILED**. The user opens tracker issues themselves (see the modal spec's Deferred
Items). Not yet filed against `Heyian/track-playlist-preview`:

- **UNFILED**: Remove (un-like) from **Liked Songs** during a Liked Songs session.
  - *Context:* R2 excludes Liked Songs; un-liking is `LibraryAPI.remove`, a different action with a
    different scope (affects the whole library, not one playlist).
  - *Required:* a removable-session rule for `spotify:collection:tracks`, a `LibraryAPI.remove`
    commit path in `pendingRemovals`, and wording that says "unlike" rather than "remove".
  - *Integration points:* `pendingRemovals` `RemovePort`, `spotify/ports`, controller removable flag.
  - *Priority:* low. Revisit after the modal ships.

**Handed to the modal design session (not deferred):** the Undo surface and the Remove control's
placement/icon. See **Scope decision**.

## Glossary Updates & ADRs

**Glossary:** no `CONTEXT.md`. New spec-local terms are in **Terms** (source playlist, removable
session, pending removal, undo window, excluded track).

**ADRs:** none. The delayed-commit removal is cheap to reverse (one module), so it fails the
hard-to-reverse criterion. No conflict with ADR 0001 or the modal spec's planned ADR 0002.

---

## Config & Infrastructure Impact

Scanned: containers (none), CI/CD (none, no `.github/`), IaC (none), env config (no env vars
introduced), schemas (none), scripts (`scripts/cdp-eval.mjs` unchanged), API collections (none),
settings (no new key: `UNDO_WINDOW_MS` is a constant).

| File | Change needed |
| --- | --- |
| `src/pendingRemovals.ts` + `.test.ts` | **New.** |
| `src/previewEngine.ts` + `.test.ts` | Optional `isExcluded` dep and pass-over logic. |
| `src/previewController.ts` (+ test from modal work) | Removable flag, `removeCurrent()`, `isExcluded` binding. |
| `src/types/domain.ts` | `RemovePort`, engine `isExcluded` dep type. |
| `src/spotify/ports.ts` | `playlistRemove`, `canRemove`. |
| `src/ui/previewModal.tsx` (modal spec) | Remove control and Undo affordance. |
| `src/index.ts` | Wire `pendingRemovals`. |

## Manual Operator Steps

None. No credentials, consoles or cutovers. Live CDP spikes are agent-runnable against the running
client.

## Documentation Updates

| Doc | Change |
| --- | --- |
| `docs/specs/2026-07-25-preview-modal-design.md` | One-line pointer in the header to this spec (done with this spec). The modal session folds R1–R13 into its plan. |
| `CLAUDE.md` | At implementation: add `pendingRemovals` to the Architecture module line. |
| `README.md` | At implementation: document Remove + Undo in the preview modal (editable playlists only). |

---

## Implementation Plan Guidance

**No standalone plan.** This spec is implemented inside the preview modal's plan. That plan must
include tasks for every file in **Config & Infrastructure Impact** and the spikes below, and must
extend its cross-model review focus to cover R1–R13.

Spikes to add before building Remove:

- (r1) Confirm `PlaylistAPI.remove(uri, [{ uri: trackUri, uid: "" }])` removes **all** copies of a
  duplicated track (R5). If it removes only one, collect every row's `uid` via `getContents` at
  commit time instead, and update R5's call shape.
- (r2) Depending on the modal session's Undo-surface choice: confirm the chosen surface is visible
  and clickable above an open `PopupModal`, and still available after the modal closes (R8).

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
> 2. **Glossary application** — *Dropped: this repo has no `CONTEXT.md` glossary; terms are spec-local.*
> 3. **ADR creation** — *Dropped: this spec creates no ADR and surfaces no ADR conflict.*
> 4. **Deferred-item verification** — Add a task: *"Confirm every issue referenced in the 'Deferred Items' section exists and has all four required body sections (Context, Required, Integration Points, Priority)."* Run `gh issue view <#> --json body | jq -r .body` and grep for the four headings. The one item here is UNFILED by the user's choice; skip the check unless it has been filed.
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
> After the final build passes — and before wrapping up via `superpowers:finishing-a-development-branch` — if a cross-model review helper is available (e.g. the Codex plugin's adversarial review), run it with focus: *"Judge correctness against the spec's acceptance criteria (R1–R13, plus the modal spec's ACs) only. Do not flag anything outside the stated criteria — no design alternatives, hardening, or scope the spec did not claim."*
>
> This **never gates a merge** — the gate stays `bun run check` plus `bun run build`; the review only flags what deserves a second look. If no helper is available, finish the branch without it.
