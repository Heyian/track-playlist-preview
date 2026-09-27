# Panel Position Setting — Design Spec

**Date:** 2026-09-27
**Status:** Approved design — spec pending review
**Issue:** #9
**Builds on:** [`2026-07-25-preview-modal-design.md`](2026-07-25-preview-modal-design.md) (the preview
panel, its Layering → Placement rules and AC70) and
[`2026-09-27-settings-page-design.md`](2026-09-27-settings-page-design.md) (the module's section on
the Spicetify Settings page, S1–S18). Criteria here are numbered **P1…** so they cannot collide with
AC1–AC70, R1–R16 or S1–S18.

---

## Problem

The preview panel always opens on the right edge. Its exact spot follows the Playbar's measured
position (panel spec, Layering → Placement). The right edge was one reasonable choice among several:
placing the panel over the Playbar was the main alternative, and some people will prefer a panel in
the middle of the window. This should be the user's choice, with today's placement as the default so
nobody sees a change unless they ask for one.

## Terms

Spec-local (no `CONTEXT.md` glossary exists). Extends the Terms of the panel and Settings-page specs.

| Term | Meaning |
| --- | --- |
| **Panel position** | The setting that picks where the preview panel and the pending-removals stack are placed. One of three **positions**: `right` (label **Right edge**), `playbar` (label **Over the Playbar**) and `centre` (label **Window centre**). |
| **Playbar** | Spotify's now-playing area, `.Root__now-playing-bar`. In the current `global-nav-centered` layout it is a block in the top-right corner; other layouts may dock it as a strip along the bottom. Same meaning as in the panel spec. |
| **Stack ceiling** | The lowest y the pending-removals stack may grow up to: `.Root__globalNav`'s bottom + 8, or 72 px when that element is missing (panel spec, `topClearancePx`). |

_Avoid:_ "layout" for Panel position (Spotify's layouts are a different thing: where the Playbar
docks); "now playing" for the Playbar (Spotify's Now Playing view is the right sidebar, below the
Playbar in the current layout).

## Investigation Findings

Verified 2026-09-27 against Spotify 1.2.96.518 over CDP (`scripts/cdp-eval.mjs`), window 1909×1143,
`.Root` class `global-nav centered-layout`:

| Element | left, top, right, bottom |
| --- | --- |
| `.Root__now-playing-bar` (Playbar) | 1473, 56, 1893, 472 |
| `.Root__globalNav` | 0, 0, 1909, 64 |
| `.Root__main-view` | 88, 64, 1473, 1135 |
| `.Root__right-sidebar` | 1481, 472, 1901, 1135 |

Notices render bottom-centre (panel spec, Notice geometry: x 517–763, y 724–772 at 1280×800). A
bottom-docked Playbar has not been seen in this client. Only the existing placement code (rule 2)
handles it.

stdlib 1.13.0's React kit (`/modules/stdlib/lib/primitives.js`) exports `SettingsRow({ label,
htmlFor?, children })` and `Select<T>({ options: {value, label}[], value, onChange, ariaLabel? })`,
a native `<select>`. There is no ready-made select row. Neither component is in
`src/types/stdlib.d.ts` yet.

Today placement is measured only in `panel.open()`. Nothing re-measures on a settings change or a
window resize.

## Design

### Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | **Over the Playbar covers the Playbar.** The panel is centred on the Playbar's box and kept inside the window. | Placing it *next to* the Playbar would land almost exactly where Right edge already puts it in the current layout, so the choice would change nothing. Covering the now-playing block also fits the session: Spotify's player is paused while previewing, and the panel takes its place. |
| D2 | **The stack follows the panel.** Same width and horizontal position, directly above the panel. For Over the Playbar, it goes below the panel when one row doesn't fit above. | Undo is used right after Remove, so it belongs next to the panel. |
| D3 | **A change applies immediately.** Placement is re-measured on every settings change, whether or not the panel is open. | The panel is visible on the Settings page during a session, so users see the effect without starting a new preview. |
| D4 | **Labels:** Right edge / Over the Playbar / Window centre. | Matches the issue and the specs' term. |
| D5 | **Right edge is today's rules, unchanged.** | Existing users see no change (issue #9). |
| D6 | **Window centre is centred in CSS** (`50%` offsets), so it stays centred when the window is resized. Other positions keep today's behaviour: no re-measure on resize. | Only a centred panel visibly drifts on resize; CSS handles it without a resize listener. |

### Setting

`PreviewSettings` gains `panelPosition: PanelPosition`, where
`type PanelPosition = "right" | "playbar" | "centre"`. `DEFAULT_SETTINGS.panelPosition` is `"right"`.

- Stored in the same JSON under the same key (`track-playlist-preview:settings`). Loading validates
  the value: a missing field or anything other than the three strings loads as `"right"`. Other
  fields load exactly as today (S11, S14).
- `settings.getPanelPosition()` and `settings.setPanelPosition(p)`. The setter ignores a value that
  is not one of the three strings (the `<select>` hands back a raw string). Otherwise it persists and
  then notifies each `onChange` listener once, like the existing setters (S10, S17).

### Settings page

A **Panel position** row goes after "Gap between tracks (seconds)" and before the collection
toggles. It is built from stdlib's `SettingsRow` + `Select`. The options, in order, come from a
pure list in `settingsSection.view.ts`:
`[{value:"right",label:"Right edge"}, {value:"playbar",label:"Over the Playbar"}, {value:"centre",label:"Window centre"}]`.
The row keeps the selected value in local state initialised from `getPanelPosition()`. A change
updates that state and calls `setPanelPosition`. `SettingsRow` and `Select` are typed in
`stdlib.d.ts`. `settingsSection.tsx` stays the only stdlib importer (S16).

### Geometry

`panelPlacement()` in `previewPanel.view.ts` stays pure and gains two inputs: `position` and the
Playbar's `right` edge. Its result becomes a union keyed by position. Suggested shape:

```ts
type PanelPlacement =
  | { position: "right";   rightPx: number; bottomPx: number; topClearancePx: number }            // today's fields
  | { position: "playbar"; rightPx: number; topPx: number; stack: "above" | "below"; topClearancePx: number }
  | { position: "centre";  topClearancePx: number };
```

Constants as today: panel 280 × `PANEL_HEIGHT_PX` (384), edge gap 16, stack gap 8, one stack row 64
(`MIN_STACK_ROOM_PX`). "Stack ceiling" = `topClearancePx` as defined in Terms.

**Right edge (`right`).** Rules 1–4 of the panel spec, unchanged. The stack sits 8 px above the
panel, as today.

**Over the Playbar (`playbar`).**

- Playbar missing → the Right edge result for the same inputs.
- Otherwise, with the Playbar box `{left, top, right, bottom}`:
  `panelLeft = clamp((left + right) / 2 − 140, 16, innerWidth − 16 − 280)`,
  `panelTop = clamp((top + bottom) / 2 − 192, 16, innerHeight − 16 − 384)`.
  The panel is anchored by `right = innerWidth − panelLeft − 280` and `top = panelTop`.
- Stack: **above** when `panelTop − 8 − stackCeiling ≥ 64`. Its bottom edge is then 8 px above
  the panel and it grows up to the stack ceiling. Otherwise **below**: its top edge is 8 px under
  the panel and it grows down to 16 px from the window bottom.
- Worked example (the live layout, 1909×1143, nav bottom 64): the panel is at x 1543–1823,
  y 72–456 (`right 86`, `top 72`). The room above is `72 − 8 − 72 < 64`, so the stack goes below,
  from y 464 with at most 663 px of height.
- Worked example (bottom strip, 1280×800, Playbar 0,720,1280,800, nav bottom 64): the panel is at
  x 500–780. Its top is clamped to 400. The room above is `400 − 8 − 72 = 320`, so the stack goes
  above, bottom 408 px from the window bottom.

**Window centre (`centre`).** The panel is placed by CSS: `left: calc(50% − 140px)`,
`top: calc(50% − 192px)`. The stack is always above it, with `bottom: calc(50% + 200px)`, growing
up to the stack ceiling. At 1280×800 the panel spans x 500–780, y 208–592, and the stack has
128 px (two rows) before it scrolls.

**Stack alignment.** In every position the stack is 280 px wide and has the panel's left and right
edges. As today, the stack keeps its position when the panel closes.

### Wiring

`createPreviewPanel` gets a `getPanelPosition()` dep and an `onSettingsChange(listener)` dep
(`settings.onChange`). One internal `place()` measures the Playbar and nav, calls `panelPlacement`,
and writes the result to the root element: CSS variables plus a `data-position` attribute that the
CSS keys off. `place()` runs:

- in `open()`, as today;
- from the settings listener, on every change. The panel may be open or closed. The stack moves
  even when the panel is closed. A change to any other setting yields the same placement, so
  nothing moves.

`place()` never touches focus and never changes the panel's view: the session is not restarted.
The listener's unsubscribe function is left for #8 to call on unload (noted on #8).

`previewPanel.css` gets per-`data-position` rules for the panel's anchor (`right`/`bottom`,
`right`/`top`, or the centred `left`/`top`) and the stack's anchor (`bottom` + ceiling-based
`max-height` when above, `top` + window-bottom-based `max-height` when below). The existing
right-edge rules stay as they are under `data-position="right"`.

### Error handling

| Case | Behaviour |
| --- | --- |
| Stored `panelPosition` missing or invalid | Loads as `"right"`; other fields unaffected. |
| `setPanelPosition` given an unknown string | Ignored: nothing stored, no listener called. |
| Over the Playbar with `.Root__now-playing-bar` missing | Right edge placement. |
| `.Root__globalNav` missing | Stack ceiling 72 px, as today. |

### Testing

- `settings.test.ts`: default, valid round-trip, invalid stored values, setter validation and
  notification.
- `settingsSection.view.test.ts`: option list values, labels and order.
- `previewPanel.view.test.ts`: the existing `panelPlacement` cases get `position: "right"`. Their
  expected `rightPx`/`bottomPx`/`topClearancePx` stay unchanged; only the added `position` field
  may be added to the expectations. New cases cover `playbar` (both worked examples, unclamped centring,
  horizontal clamp, top and bottom clamp, missing Playbar, stack above and below) and `centre`.
- Live via CDP (`scripts/cdp-eval.mjs`): each position's boxes against the Playbar and notice
  area, the stack's bounds and scrolling (P20), the immediate move from the Settings page for all
  six transitions, and focus staying on the `<select>`.

## Acceptance Criteria

**Setting**

- **P1** — Given no stored `panelPosition`, `getPanelPosition()` returns `"right"`. Given stored
  JSON with `panelPosition` `"playbar"` or `"centre"`, it returns that value. Given any other stored
  value (for example `"left"`, `"Right"`, `""`, `42` or `null`), it returns `"right"`, and
  `durationMs`, `gapMs` and `enabled` load as they would without the field.
- **P2** — `setPanelPosition` with `"right"`, `"playbar"` or `"centre"` stores the value under
  `track-playlist-preview:settings` and then calls each `onChange` listener exactly once. With any
  other string, it stores nothing and calls no listener.
- **P3** — On `/bespoke/settings`, the **Track & Playlist Preview** section has a row labelled
  **Panel position** between "Gap between tracks (seconds)" and the first collection toggle. The
  row's `<select>` offers, in order, **Right edge**, **Over the Playbar** and **Window centre**, and
  shows the stored choice. Choosing an option calls `setPanelPosition` with `"right"`, `"playbar"`
  or `"centre"` respectively.
- **P4** — Only `src/ui/settingsSection.tsx` imports a `/modules/stdlib/` path (grep; S16 still
  holds).

**Placement**

- **P5** — Given position **Right edge**, every existing `panelPlacement` test case (inputs as
  today, plus the new `position` input) returns the same `rightPx`, `bottomPx` and `topClearancePx`
  as before, so placement rules 1–4 of the panel spec hold unchanged, including rule 4's
  left-of-Playbar fallback. The live panel and stack satisfy P15.
- **P6** — Given position **Over the Playbar**, window 1909×1143, Playbar box 1473,56,1893,472 and
  nav bottom 64, `panelPlacement` places the panel at `right 86`, `top 72`, with the stack
  **below**.
- **P7** — Given position **Over the Playbar**, window 1280×800, Playbar box 0,720,1280,800 and
  nav bottom 64, the panel's left edge is at x 500, its top is at y 400 (clamped to
  `innerHeight − 16 − 384`), and the stack is **above**.
- **P8** — Given position **Over the Playbar**, the stack is **above** exactly when
  `panelTop − 8 − stack ceiling ≥ 64`, and **below** otherwise. When no clamp applies, the panel's
  centre equals the Playbar box's centre. A Playbar box whose centre is less than 156 px from a
  window side yields a panel exactly 16 px from that side. A Playbar box whose centre is less than
  208 px from the window top yields a panel top of 16; less than 208 px from the window bottom
  yields a panel bottom of `innerHeight − 16`.
- **P9** — Given position **Over the Playbar** and no `.Root__now-playing-bar`, `panelPlacement`
  returns the same panel and stack placement as **Right edge** for the same inputs.
- **P10** — Given position **Window centre**, in the live client, the panel's centre is within 1 px
  of the window's centre. After the window is resized with the panel open, it is still within 1 px
  of the new centre, with no reopen.
- **P11** — In every position, with at least one pending removal, the stack's left and right edges
  equal the panel's. The stack is 8 px from the panel's nearer edge: its bottom edge above the
  panel, or its top edge below it. Its box does not change when the panel closes.

**Applying a change**

- **P12** — Given the panel is open at any position, when **Panel position** is changed to any
  other position on the Settings page (all six transitions), the panel and stack move to the new
  placement without closing. The new placement uses the window size and the Playbar's and nav's
  boxes as measured at the moment of the change, not as they were when the panel opened. The panel
  shows the same track with no restart of its progress, and keyboard focus stays on the `<select>`.
- **P13** — Given the panel is closed and a removal is pending, a **Panel position** change moves
  the stack to where the new position would place it, measured at the moment of the change.
- **P14** — Given no change to the window size or to the Playbar's or `.Root__globalNav`'s box,
  changing any other setting (duration, gap, a collection toggle) leaves the panel's and stack's
  boxes unchanged.

**AC70, amended per position** (at a window of at least 1280×800, `global-nav-centered` layout)

- **P15** — **Right edge**: placement follows rules 1–4 of the panel spec (P5). AC70's other
  clauses hold unchanged: the stack is directly above the panel and keeps its position whether the
  panel is open or closed, and the panel's and stack's boxes don't intersect the Playbar or the
  notice container's area. AC70's "on the right edge" wording is superseded by rules 1–4 (rule 4
  places the panel left of the Playbar's column).
- **P16** — **Over the Playbar**: when neither window clamp moved the panel, the panel's box lies
  inside the Playbar's box widened by `max(0, (280 − Playbar width) / 2)` on each side and
  `max(0, (384 − Playbar height) / 2)` above and below. The panel's and stack's boxes do not
  intersect the notice container's area.
- **P17** — **Window centre**: the panel's and stack's boxes intersect neither the Playbar nor the
  notice container's area.
- **P18** — In every position, the panel and stack render above page content and below
  `Spicetify.PopupModal`'s overlay, and no `e-[0-9]` class literal appears in `src/` (grep).

**Stack bounds**

- **P19** — Given position **Window centre**, with at least one pending removal, the stack is
  **above** the panel at every window size.
- **P20** — Given position **Over the Playbar** or **Window centre**: a stack **above** the panel
  never extends above the stack ceiling (`.Root__globalNav`'s bottom + 8, or 72 px when that
  element is missing); a stack **below** the panel never extends below `innerHeight − 16`. When
  the pending rows need more height than that, the stack's box stays within those bounds and its
  rows scroll.

## Deferred Items

None filed by this spec. Related: #8 (unload teardown) now also covers removing the panel's
settings listener. A comment was added there on 2026-09-27.

## Glossary Updates & ADRs

None to a glossary file: no `CONTEXT.md` exists, and the terms are spec-local (see **Terms**).

No ADR. A preference with a safe default is easy to reverse: an unknown stored value falls back to
Right edge. It fails the "hard to reverse" criterion. No conflict with ADR 0001.

AC70 (panel spec) is amended by P15–P17: its "on the right edge" wording yields to placement rules 1–4, and the other positions get their own clauses. The panel spec is back-annotated (see Documentation
Updates).

## Config & Infrastructure Impact

| File | Change |
| --- | --- |
| `src/types/stdlib.d.ts` | Add `SettingsRow` and `Select<T>` declarations to the `primitives.js` module. |
| Stored settings (`localStorage` key `track-playlist-preview:settings`) | Gains the `panelPosition` field. Same key, no migration: a missing field loads as `"right"` (P1). |
| `build.ts`, `package.json`, `metadata.json` | None. Scanned: no new imports outside stdlib, whose dependency is already declared (`^1.13.0` covers `Select` and `SettingsRow`). |
| `tsconfig.json` | None. |
| CI | None: no `.github/` directory. |
| Env / secrets | None. |
| `scripts/cdp-eval.mjs` | None. |

## Manual Operator Steps

None beyond the usual: after `bun run build`, run `spicetify apply` (restarts Spotify). CDP is
already enabled (`spotify_launch_flags = --remote-debugging-port=8088`, verified answering
2026-09-27).

## Documentation Updates

| Doc | Change |
| --- | --- |
| `README.md` | Settings table: add a row: **Panel position**, default Right edge, "Where the preview panel and Undo list appear: Right edge, Over the Playbar (covers Spotify's now-playing area), or Window centre. Applies immediately." |
| `CLAUDE.md` | Documentation list: add a pointer row to this spec (criteria P1–P20). |
| `docs/specs/2026-07-25-preview-modal-design.md` | Annotate the Layering → Placement paragraph and AC70: "These are the **Right edge** rules. AC70's "on the right edge" means rules 1–4, including rule 4's left-of-Playbar fallback. See the [panel-position spec](2026-09-27-panel-position-design.md), P15–P17, for the other positions." |
| `docs/specs/2026-09-27-settings-page-design.md` | Deferred Items, #9 entry: append "— addressed by the [panel-position spec](2026-09-27-panel-position-design.md)". |

## Implementation Plan Guidance

Spike to run before the Settings-page task:

- (s1) Over CDP, render stdlib's `SettingsRow` + `Select` in a throwaway root and confirm that a
  controlled `value` and `onChange` behave as typed (the change handler gets the option's `value`
  string). Unmount it in a `finally`.

Required Task 2 (glossary) and Task 3 (ADRs) do not apply: no `CONTEXT.md`, no ADRs listed. Required
Task 4 has nothing to verify: no Deferred Items were filed.

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
> 2. **Glossary application** — IF the spec's "Glossary Updates & ADRs" section lists new or changed terms, add an early task: *"Apply terms to `CONTEXT.md` (using the existing file's format) before any code, test, issue title, or commit message references them."* Code must use the canonical terms; never the synonyms listed under `_Avoid_`.
> 3. **ADR creation** — FOR EACH ADR listed in the spec, add a task: *"Create `docs/adr/NNNN-<slug>.md` following sequential numbering (start at `0001-` if the directory is empty)."* IF the spec lists ADR conflicts surfaced, also add a task: *"Update the conflicting ADR's status (superseded / amended) and link to the new ADR."*
> 4. **Deferred-item verification** — Add a task: *"Confirm every issue referenced in the 'Deferred Items' section exists and has all four required body sections (Context, Required, Integration Points, Priority)."* Run `gh issue view <#> --json body | jq -r .body` and grep for the four headings.
> 5. **Config file tasks** — FOR EACH file listed in the spec's "Config & Infrastructure Impact" section, add one explicit task: *"Update `<path>`."*
> 6. **Manual Operator Steps** — IF the spec's "Manual Operator Steps" section is non-empty, add a task ahead of every task that depends on those values existing: *"Hand the operator the Manual Operator Steps and wait for confirmation; if a wizard-generation skill is available, generate the script first."* The agent never performs these steps itself and never substitutes a placeholder credential to unblock itself.
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
> After the final build passes — and before wrapping up via `superpowers:finishing-a-development-branch` — if a cross-model review helper is available (e.g. the Codex plugin's adversarial review), run it with focus: *"Judge correctness against the spec's acceptance criteria (P1–P20) only. Do not flag anything outside the stated criteria — no design alternatives, hardening, or scope the spec did not claim."*
>
> This **never gates a merge** — the gate stays `bun run check` plus `bun run build`; the review only flags what deserves a second look. If no helper is available, finish the branch without it.
