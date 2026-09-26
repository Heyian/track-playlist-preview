# Remove From Playlist — Design Spec

**Date:** 2026-09-26
**Status:** Approved — amends the preview panel; built as part of it, not on its own
**Builds on:** [`2026-07-25-preview-modal-design.md`](2026-07-25-preview-modal-design.md) (revised
2026-09-26 into the non-blocking **preview panel**, not yet implemented) and [`2026-07-22-track-playlist-preview-design.md`](2026-07-22-track-playlist-preview-design.md)
(the shipped extension). Criteria here are numbered **R1…** so they cannot collide with the panel
spec's AC numbering; they keep these ids after the 2026-09-26 re-grill.

---

## Problem

Previewing a playlist is often triage: you listen to each clip and decide whether it stays. Today,
dropping a track means leaving the preview flow and using Spotify's own row menu. This feature adds
a one-click **Remove** control to the preview panel. It removes the track being previewed from the
playlist the session was started from and moves straight on to the next track.

## Scope decision

Remove is a **third control of the preview panel**, alongside Stop and Next. It is **not** a
Playbar button: the panel spec removes the Playbar controls (its AC57), so a Playbar Remove would
be thrown away. Nothing in this spec is built until the panel is built. This document is an input
to the panel's own design session and implementation plan.

**Decided in the panel re-grill (2026-09-26)**, see the panel spec:

- **Undo surface:** the panel spec's own **pending-removals stack** (AC67), one row per pending
  removal, independent of the panel's open state. Spotify's Snackbar was rejected: its default
  variant ignores action buttons and it shows at most 3 toasts, queueing the rest, so a burst of
  removals would break R11.
- **Remove control:** icon (`minus`) + text "Remove", apart from Stop/Next (AC68); `Delete` shortcut
  while the panel has focus (AC66).

## Terms

Spec-local (no `CONTEXT.md` glossary exists). Extends the Terms of both prior specs.

| Term | Meaning |
| --- | --- |
| **Source playlist** | The playlist URI a preview session was started from: via the action bar, the collection context menu, or *Preview from here* inside that playlist. Single-track sessions have none. |
| **Removable session** | A session whose source playlist classifies as `playlist` **and** whose `PlaylistAPI.getMetadata(uri).canRemove` is `true` when the session starts. |
| **Pending removal** | A removal the user has requested but that has not yet been sent to Spotify. It lasts one undo window. |
| **Undo window** | `UNDO_WINDOW_MS` (constant, 5000 ms). The time between pressing Remove and the `PlaylistAPI.remove` call. |
| **Excluded track** | In a session on playlist P, a track URI T that has either (a) a pending removal from P, or (b) a removal from P that **succeeded after this session started**. Undone and failed removals exclude nothing. The engine passes over excluded tracks. |
| **Current entry** | The engine's current preview-queue entry (`queue[currentIndex()]`), including while its clip is still resolving. During the inter-track gap it is the entry that just finished. |

_Avoid:_ "delete" (Spotify's term for deleting a whole playlist); "unlike" (Liked Songs are out of
scope, see Deferred Items).

---

## Investigation Findings

Verified live over CDP (`scripts/cdp-eval.mjs`, Spotify 1.2.96.518) on 2026-09-26.

- **`PlaylistAPI.remove(playlistUri, rows)`**: `rows` is `[{ uri, uid }]`. If any `uid` is
  non-empty, the request removes those **rows**. If every `uid` is empty, it sends
  `{ uris: [...] }` and removes **by track URI**. This design uses the URI form (R9). Still to
  confirm by spike: the URI form removes **all** copies of a duplicated track.
- **`PlaylistAPI.getMetadata(uri)`** exposes `canAdd`, `canRemove`, `canEditItems` and
  `permissions`. `canRemove` is `true` on an owned playlist and `false` on a followed one
  (both checked).
- **`PlaylistAPI.getContents`** items carry a per-row `uid`. It is not needed for URI-form removal
  and is not added to `TrackRef`.
- **`LibraryAPI.remove`** exists (un-liking a track from Liked Songs). Not used; see Deferred Items.
- **`Spicetify.Snackbar.enqueueSnackbar`** is live (notistack, `maxSnack` 3), but Spotify's default
  variant ignores `action`; only `enqueueCustomSnackbar` renders a button. See the panel spec for
  why the Undo surface is our own stack instead.

---

## Design

### Behaviour

1. At session start, the controller decides **once** whether the session is a **removable
   session**: the source URI classifies as `playlist` and `getMetadata(uri).canRemove === true`
   (only literal `true`). The decision is fixed for the session. The same lookup captures the
   playlist's `name` for the failure notice (behaviour 8). If it rejects, the session is **not**
   removable, and the session itself still starts normally. *Preview from here* inside playlist P
   uses P as the source playlist; when the controller falls back to a single-track session, there
   is no source playlist and no Remove.
2. The panel shows the Remove control only in a removable session. `removeCurrent()` in a
   non-removable session is a no-op: nothing scheduled, no call, no advance.
3. Pressing Remove targets the **current entry**. It synchronously:
   - schedules a **pending removal** of that entry's track URI from the source playlist, capturing
     the track title and the playlist name from session start, then
   - invokes Next's engine advance (`skip()`): no inter-track gap, and Remove itself adds nothing
     to the "skipped, no preview" count. What follows is ordinary engine behaviour: the next entry
     resolves, is skipped for no clip, aborts, or, when nothing remains, the session ends
     `completed` and the panel closes. The skipped entry's in-flight resolution or audio callbacks
     are invalidated and have no effect.
4. When its `UNDO_WINDOW_MS` deadline fires, a pending removal commits by calling
   `PlaylistAPI.remove(sourcePlaylist, [{ uri, uid: "" }])`, which removes **every** copy of the
   track.
5. **Undo** cancels only its own pending removal, and only before the commit call is issued. No
   Spotify call is made and the playlist is untouched (original position, date added and row id
   preserved). Undo never rewinds or restarts playback. After the commit call is issued, Undo
   reports failure.
6. Each removal has its **own** independent window and Undo. Removals are independent of sessions:
   Stop, closing the panel, completion, abort or replacement neither cancel, flush nor retarget a
   pending removal. Next does not affect pending removals either.
7. **Excluded tracks:** when the engine reaches an **excluded track**, it passes over it immediately
   without resolving its preview, without playing it, without emitting `trackStarted` or
   `trackSkipped`, and without counting it in the end-of-session summary. Exclusion follows the
   removal, not the session: a pending removal of T from P excludes T in **every** session on P,
   including one started after the Remove press. A successful removal keeps excluding T only in
   sessions on P that started before it committed; later sessions no longer enumerate T, and if T
   is re-added to P afterwards it plays normally. Removals from P never affect a session on another
   playlist.
8. **Failure:** if the commit call rejects, show an error notice "Couldn't remove *Title* from
   *Playlist*", using the title and name captured at Remove time (the panel's generic playlist
   label if no name was available). No retry. The removal stops excluding T, and any later copy
   plays normally. The playlist is unchanged.

### Modules

| Module | Change | Responsibility |
| --- | --- | --- |
| `pendingRemovals` | **new, pure** | `schedule(playlistUri, playlistName, track) → handle`, `undo(handle) → boolean`, and an exclusion query that takes the playlist and the session's start marker (e.g. a monotonic sequence), per behaviour 7. Timer and remove call are injected ports (`TimerPort`, `RemovePort`), the same pattern as `previewEngine`. Owns the window, the commit, and failure reporting via an injected `onError(trackTitle, playlistName)`. |
| `previewEngine` | change | Optional `isExcluded(uri): boolean` dep. Checked in `playCurrent` before resolving. An excluded track advances immediately with no event and no count. |
| `previewController` | change | Computes the removable-session flag once at session start via a `canRemove(uri)` port (also returning the name). Exposes it to the panel view. Adds `removeCurrent()`, which calls `pendingRemovals.schedule(...)` then `engine.skip()`, and is a no-op when not removable. Binds the engine's `isExcluded` to the current source playlist and session start marker. |
| `types/domain` | change | Add `RemovePort` (`(playlistUri, trackUri) => Promise<void>`) and the `isExcluded` engine dep type. |
| `spotify/ports` | change | `playlistRemove: RemovePort` over `Platform.PlaylistAPI.remove`; `canRemove(uri)` over `getMetadata`. These are the only new `Spicetify` touches. |
| `ui/previewPanel` | change (panel spec) | Renders Remove when the view says the session is removable. Wires it to `controller.removeCurrent()`. |
| `ui/pendingRemovalsStack` | new (panel spec) | The Undo surface (panel spec AC67). |
| `index.ts` | change | Build `pendingRemovals` with `realTimer`, `playlistRemove`, `notifications.error`. Pass it to the engine and controller. |

`pendingRemovals` is deliberately not inside the engine: removals outlive sessions (behaviour 6),
and the engine resets per session.

### Testing

Vitest, `*.test.ts` convention, fake `TimerPort` and `RemovePort`:

- `pendingRemovals.test.ts`: no call before the deadline, exactly one URI-form call when the
  deadline callback runs; undo before commit prevents it; undo once the call is issued (resolved
  or not) returns `false`; independent handles, including two for the same URI; exclusion per
  behaviour 7 (pending → all sessions on P; succeeded → only sessions started before commit;
  undone/failed → none; other playlists → never); a rejected commit reports via `onError` with the
  captured title and name.
- `previewEngine.test.ts`: excluded entries are not resolved, emit no `trackStarted`/`trackSkipped`
  and do not raise the `skipped` count; an all-excluded suffix ends the session `completed`; a
  skip during resolution discards the late URL, `null` or rejection.
- `previewController.test.ts` (created by the panel work): removable flag from literal `true`
  only, fixed per session, false on rejection; *Preview from here* uses the playlist, single-track
  fallback has no Remove; `removeCurrent` schedules then skips synchronously; not removable →
  complete no-op.

Manual CDP verification: the URI-form spike (R9 duplicates) and the Undo surface (R11).

---

## Acceptance Criteria

Revised after the cross-model critique (2026-09-26). Timing criteria are asserted with a fake
`TimerPort`.

**Availability**

- **R1**: Given a session whose source playlist's `getMetadata` reports `canRemove` as literal
  `true` at session start, the preview panel shows a Remove control. The lookup runs once per
  session and its result is fixed for that session.
- **R2**: Given a session started from a playlist whose `canRemove` is anything other than literal
  `true`, from Liked Songs, an album, an artist, or as a single-track session (including a
  *Preview from here* that fell back to a single track), the preview panel shows **no** Remove
  control.
- **R3**: Given the `canRemove` lookup rejects at session start, the session starts and runs
  normally and the panel shows no Remove control.
- **R4**: Given *Preview from here* on a track inside playlist P, P is the source playlist for both
  the R1 lookup and the removal, and the session starts at the selected entry.
- **R5**: Given a non-removable session, calling `removeCurrent()` schedules nothing, makes no
  `PlaylistAPI.remove` call, and does not advance playback.

**Pressing Remove**

- **R6**: When Remove is pressed, it targets the **current entry**, including one whose preview is
  still resolving, or the just-finished entry during the inter-track gap. It schedules that entry's
  removal and invokes Next's engine advance synchronously, without waiting for `UNDO_WINDOW_MS` or
  any Spotify call. No inter-track gap is applied, and Remove itself adds nothing to the
  end-of-session "skipped" count. Later entries follow normal resolution, skip and abort rules,
  subject to R13.
- **R7**: Given Remove was pressed on an entry whose preview was still resolving, that entry's late
  URL, `null` result or rejection, and any stale audio callback, play no audio, emit no track event,
  change no count, cause no further advance, and do not abort the session.
- **R8**: Given Remove is pressed on the last entry, or every entry after it is excluded, the
  session ends as `completed` and the panel closes, and the removal still commits per R9 unless
  undone.

**Commit and Undo**

- **R9**: Given Remove was pressed and not undone, no `PlaylistAPI.remove` call is made before
  `UNDO_WINDOW_MS` elapses, and exactly one call
  `PlaylistAPI.remove(sourcePlaylist, [{ uri: trackUri, uid: "" }])` is made when that removal's
  deadline callback runs. After the call **succeeds**, the playlist contains no row with that track
  URI (all duplicates removed; spike r1). A rejected call follows R15.
- **R10**: Given Remove was pressed and the session then ends by any cause (Stop, panel close,
  completion, abort, or engine-level replacement) inside the undo window, the removal keeps its
  original playlist, track and deadline and commits per R9 unless undone. Ending the session
  neither cancels nor commits it early, and its later commit or failure does not alter the
  playback of any other session.
- **R11**: Given Remove was pressed, an Undo affordance is available until the commit call is
  issued, including after the session has ended. Using it cancels **only that removal**: no
  `PlaylistAPI.remove` call is made for it, the playlist's rows (position, date added, row id) are
  unchanged by it, and playback is neither rewound nor restarted. Undo once the commit call has
  been issued, resolved or not, reports failure and changes nothing.
- **R12**: Given two Removes pressed at different times, each commits at its own deadline, and
  undoing one has no effect on the other. Pressing Next during a window does not cancel, hasten or
  retarget any pending removal.

**Excluded tracks**

- **R13**: Given a session on playlist P reaches an entry for track T that is an **excluded
  track**, it passes over it immediately: no preview resolution, no audio, no
  `trackStarted`/`trackSkipped` event (the panel shows no skipping state), and no count in the
  end-of-session summary. T is excluded in a session on P exactly when (a) a removal of T from P is
  pending, in any session on P, including one started after the Remove press, or (b) a removal of
  T from P succeeded after that session started. A removal from P never excludes anything in a
  session on another playlist.
- **R14**: Given every removal of T from P that excluded it has been undone, failed, or succeeded
  before the session started, a later copy of T in that session plays normally. This includes a T
  re-added to P after a successful removal.

**Failure and boundaries**

- **R15**: Given the commit call rejects, an error notice "Couldn't remove *Title* from
  *Playlist*" is shown, using the track title and the source playlist's name captured when Remove
  was pressed (the panel's generic playlist label if no name was available), even if the session
  has ended. No retry is made, the active session (if any) is unaffected, and the removal no longer
  excludes T (R14).
- **R16**: Only `spotify/ports` calls `Spicetify.Platform.PlaylistAPI.remove` / `getMetadata` for
  this feature; `pendingRemovals` and `previewEngine` import no `Spicetify` global (verified by
  grep in review).

---

## Deferred Items

Recorded as **UNFILED**. The user opens tracker issues themselves (see the panel spec's Deferred
Items). Not yet filed against `Heyian/track-playlist-preview`:

- **UNFILED**: Remove (un-like) from **Liked Songs** during a Liked Songs session.
  - *Context:* R2 excludes Liked Songs; un-liking is `LibraryAPI.remove`, a different action with a
    different scope (affects the whole library, not one playlist).
  - *Required:* a removable-session rule for `spotify:collection:tracks`, a `LibraryAPI.remove`
    commit path in `pendingRemovals`, and wording that says "unlike" rather than "remove".
  - *Integration points:* `pendingRemovals` `RemovePort`, `spotify/ports`, controller removable flag.
  - *Priority:* low. Revisit after the panel ships.

The Undo surface and the Remove control were decided in the panel re-grill; see **Scope decision**.

## Glossary Updates & ADRs

**Glossary:** no `CONTEXT.md`. New spec-local terms are in **Terms** (source playlist, removable
session, pending removal, undo window, excluded track).

**ADRs:** none. The delayed-commit removal is cheap to reverse (one module), so it fails the
hard-to-reverse criterion. No conflict with ADR 0001. (The panel spec cancelled its planned ADR 0002.)

---

## Config & Infrastructure Impact

Scanned: containers (none), CI/CD (none, no `.github/`), IaC (none), env config (no env vars
introduced), schemas (none), scripts (`scripts/cdp-eval.mjs` unchanged), API collections (none),
settings (no new key: `UNDO_WINDOW_MS` is a constant).

| File | Change needed |
| --- | --- |
| `src/pendingRemovals.ts` + `.test.ts` | **New.** |
| `src/previewEngine.ts` + `.test.ts` | Optional `isExcluded` dep and pass-over logic. |
| `src/previewController.ts` (+ test from panel work) | Removable flag, `removeCurrent()`, `isExcluded` binding. |
| `src/types/domain.ts` | `RemovePort`, engine `isExcluded` dep type. |
| `src/spotify/ports.ts` | `playlistRemove`, `canRemove`. |
| `src/ui/previewPanel.tsx`, `src/ui/pendingRemovalsStack.tsx` (panel spec) | Remove control and Undo stack. |
| `src/index.ts` | Wire `pendingRemovals`. |

## Manual Operator Steps

None. No credentials, consoles or cutovers. Live CDP spikes are agent-runnable against the running
client.

## Documentation Updates

| Doc | Change |
| --- | --- |
| `docs/specs/2026-07-25-preview-modal-design.md` | One-line pointer in the header to this spec (done). Revised 2026-09-26 into the panel spec, which folds R1–R16 into its plan. |
| `CLAUDE.md` | At implementation: add `pendingRemovals` to the Architecture module line. |
| `README.md` | At implementation: document Remove + Undo in the preview panel (editable playlists only). |

---

## Implementation Plan Guidance

**No standalone plan.** This spec is implemented inside the preview panel's plan. That plan must
include tasks for every file in **Config & Infrastructure Impact** and the spikes below, and must
extend its cross-model review focus to cover R1–R16.

Spikes to add before building Remove:

- (r1) Confirm `PlaylistAPI.remove(uri, [{ uri: trackUri, uid: "" }])` removes **all** copies of a
  duplicated track (R9). If it removes only one, collect every row's `uid` via `getContents` at
  commit time instead, and update R9's call shape.
- (r2) *Superseded by the panel spec's spike (p1):* the Undo surface is our own body-level stack.

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
> After the final build passes — and before wrapping up via `superpowers:finishing-a-development-branch` — if a cross-model review helper is available (e.g. the Codex plugin's adversarial review), run it with focus: *"Judge correctness against the spec's acceptance criteria (R1–R16, plus the panel spec's ACs) only. Do not flag anything outside the stated criteria — no design alternatives, hardening, or scope the spec did not claim."*
>
> This **never gates a merge** — the gate stays `bun run check` plus `bun run build`; the review only flags what deserves a second look. If no helper is available, finish the branch without it.
