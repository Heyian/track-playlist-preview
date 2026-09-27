# Panel Position Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user choose where the preview panel and the pending-removals stack appear:
**Right edge** (today's rules, the default), **Over the Playbar** or **Window centre**. A change
takes effect immediately.

**Architecture:** The setting (`panelPosition`) lives in the existing settings store. The
Settings-page section gets a `SettingsRow` + `Select` row. Placement stays a pure function:
`panelPlacement()` returns a union keyed by position, and a new pure `placementStyle()` turns that
result into CSS variables and two `data-` attributes. The panel adapter (`previewPanel.tsx`) runs
one `place()` on every `open()` and on every settings change, and CSS rules keyed on the attributes
anchor the panel and stack.

**Tech Stack:** TypeScript (strict), Bun bundler (`build.ts`), Vitest, React via `Spicetify.React`,
stdlib 1.13.0 primitives, Spicetify CLI v3 on Spotify 1.2.96.518.

**Spec:** `docs/specs/2026-09-27-panel-position-design.md` (criteria P1–P20). Read it before
starting. It builds on `docs/specs/2026-07-25-preview-modal-design.md` (Layering → Placement, AC70)
and `docs/specs/2026-09-27-settings-page-design.md` (S1–S18).

## Global Constraints

- Quality gate: `bun run check` (typecheck + vitest). No linter. `bun run build` does not typecheck.
- `type PanelPosition = "right" | "playbar" | "centre"`. Labels, in this order: **Right edge**,
  **Over the Playbar**, **Window centre**. Row label **Panel position**. Spelling is `centre`, never
  `center`.
- Default `"right"`. Storage key stays `track-playlist-preview:settings`, same JSON, no migration.
- Constants as today: panel 280 × `PANEL_HEIGHT_PX` (384), edge gap 16, stack gap 8, one stack row
  `MIN_STACK_ROOM_PX` (64). Stack ceiling = `.Root__globalNav` bottom + 8, or 72 without it.
- Right edge = the panel spec's placement rules 1–4, unchanged. The existing `panelPlacement`
  expectations for `rightPx`/`bottomPx`/`topClearancePx` must not change (P5).
- Only `src/ui/settingsSection.tsx` imports a `/modules/stdlib/` path, type imports included (S16).
- No `e-[0-9]` class literal in `src/`. Never use `Spicetify.PopupModal` for the panel.
- The settings listener's unsubscribe is not called. Unload teardown is #8.
- Commits: capitalized imperative subject, no `feat:` prefix, no AI-attribution line.
- Before every commit, a verification subagent runs `bun run check` from the repo root and reports
  `STATUS: PASS` / `STATUS: FAIL` with a terse per-issue list. Commit only on PASS. Never
  `--no-verify`.
- CDP: `node scripts/cdp-eval.mjs '<expr>'` with the Bash sandbox **disabled** (fetch to
  `127.0.0.1:8088` fails inside it). A probe that registers UI removes it in a `finally`.

## Review Focus

1. **US spelling stored** — a stored `panelPosition` of `"center"` or `"Centre"` loads as
   `"right"`, and `setPanelPosition("center")` stores nothing. → Task 2.
2. **Window smaller than the panel plus gaps** — at `innerHeight` 300 or `innerWidth` 250, Over
   the Playbar puts the panel's top (or left) at 16, not at a negative offset: the lower clamp bound
   wins, so the close button stays on screen. → Task 4.
3. **Stale anchor after a switch** — going from Over the Playbar with the stack **below** to Right
   edge or Window centre must clear the stack's `top`. Otherwise the stack stretches between the old
   `top` and the new `bottom`. → Task 5 (CSS sets the unused anchor to `auto`) and Task 6 (live).
4. **Change before any preview** — changing Panel position before a session has ever opened
   throws nothing. The first preview then opens at the chosen position. → Task 6.
5. **Settings page revisited** — after leaving and returning to `/bespoke/settings`, the select
   shows the stored position, not Right edge. → Task 3.

---

### Task 1: Isolated workspace and spec carry-over

**Files:** none in `src/`.

- [ ] **Step 1:** Create an isolated workspace via `superpowers:using-git-worktrees` (branch
  `panel-position`).
- [ ] **Step 2:** The critique-folded spec and this plan are uncommitted in the main worktree. Copy
  `docs/specs/2026-09-27-panel-position-design.md` and
  `docs/superpowers/plans/2026-09-27-panel-position.md` into the new worktree. Then in the main
  worktree run `git checkout -- docs/specs/2026-09-27-panel-position-design.md` and delete the plan
  copy.
- [ ] **Step 3:** Commit in the worktree: `Fold the spec critique into the panel-position criteria and add its plan`.
- [ ] **Step 4:** Confirm CDP answers: `curl -s 127.0.0.1:8088/json/version` (sandbox disabled).
  Expected: a JSON object with a `Browser` field.

No deferred items were filed (spec → Deferred Items), so there are no issue bodies to verify.

### Task 2: The `panelPosition` setting (P1, P2)

**Files:**
- Modify: `src/types/domain.ts` (next to `PreviewSettings`)
- Modify: `src/settings.ts`
- Test: `src/settings.test.ts`

**Interfaces:**
- Produces (in `domain.ts`): `type PanelPosition = "right" | "playbar" | "centre"`;
  `PANEL_POSITIONS: readonly PanelPosition[] = ["right", "playbar", "centre"]`;
  `isPanelPosition(v: unknown): v is PanelPosition`; `PreviewSettings.panelPosition: PanelPosition`;
  `DEFAULT_SETTINGS.panelPosition = "right"`.
- Produces (on `Settings`): `getPanelPosition(): PanelPosition`; `setPanelPosition(p: string): void`
  (takes a raw string because the `<select>` hands one back).

- [ ] **Step 1: Write the failing tests** in a new `describe("panelPosition (P1, P2)")`, using the
  file's `memoryStorage` helper and `KEY` constant:
  - `"P1: defaults to right when the field is missing"`: stored `{ durationMs: 3000 }` →
    `getPanelPosition()` is `"right"`, and an empty store also gives `"right"`.
  - `"P1: a stored playbar or centre round-trips"`: `it.each(["playbar", "centre"])`. The stored
    value is returned, and after `setPanelPosition(v)` a fresh instance over the same storage
    returns it too.
  - `"P1: any other stored value loads as right; other fields are unaffected"`:
    `it.each(["left", "Right", "", "center", "Centre", 42, null, {}])` stored with
    `durationMs: 3000, gapMs: 500, enabled: { album: false }` → `getPanelPosition()` is `"right"`,
    `getDurationMs()` 3000, `getGapMs()` 500, `isEnabled("album")` false.
  - `"P2: a valid value is stored, then each listener is called once"`: two `vi.fn()` listeners.
    Each listener asserts `JSON.parse(storage.get(KEY)!).panelPosition === "centre"` when called.
    After `setPanelPosition("centre")`, each listener has been called exactly once.
  - `"P2: an unknown string stores nothing and calls no listener"`:
    `it.each(["left", "center", "", "RIGHT"])`. The stored JSON is unchanged (`storage.get(KEY)`
    before equals after) and the listener is not called.
- [ ] **Step 2:** `bun run test src/settings.test.ts` → the new tests FAIL (`getPanelPosition is not
  a function`).
- [ ] **Step 3:** Add the `domain.ts` items. In `settings.ts`, `load()` reads
  `panelPosition: isPanelPosition(parsed.panelPosition) ? parsed.panelPosition : DEFAULT_SETTINGS.panelPosition`.
  Add the getter, and a setter that returns early when `!isPanelPosition(p)`, otherwise assigns and
  calls `commit()`.
- [ ] **Step 4:** `bun run check` → PASS (existing `snapshot()`/`DEFAULT_SETTINGS` equality tests
  still pass because both gain the field).
- [ ] **Step 5:** Pre-commit verification, then commit: `Add the panel position setting`.

### Task 3: Panel position row on the Settings page (P3, P4)

**Files:**
- Modify: `src/types/stdlib.d.ts` (the `*/modules/stdlib/lib/primitives.js` module)
- Modify: `src/ui/settingsSection.view.ts`, `src/ui/settingsSection.tsx`
- Test: `src/ui/settingsSection.view.test.ts`

**Interfaces:**
- Consumes: `PanelPosition`, `Settings.getPanelPosition()`, `Settings.setPanelPosition(p: string)` (Task 2).
- Produces: `PANEL_POSITION_OPTIONS: readonly { value: PanelPosition; label: string }[]` in
  `settingsSection.view.ts`.

stdlib 1.13.0's source (`~/.config/spicetify/modules/stdlib/lib/primitives.js`) shows the real
shapes. `Select` renders `<select value aria-label onChange={e => props.onChange(e.target.value)}>`
and has **no `id` prop**. `SettingsRow` renders a `<label htmlFor>` only when `htmlFor` is given.
So the row passes `ariaLabel="Panel position"` and no `htmlFor`.

- [ ] **Step 1: Spike (s1)** over CDP. Import `SettingsRow` and `Select` from
  `location.origin + "/modules/stdlib/lib/primitives.js"`. Render them with `Spicetify.ReactDOM.createRoot`
  into a throwaway `div` appended to `document.body`, as a controlled `Select` whose `onChange`
  records its argument. Dispatch a `change` on the `<select>` after setting `.value = "playbar"`
  via the native setter (`Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set`)
  plus `new Event("change", { bubbles: true })`. Unmount and remove the div in a `finally`.
  Expected: the recorded argument is the string `"playbar"`. If it differs, stop and report.
- [ ] **Step 2: Write the failing test** `"P3: panel position options — values, labels, order"`:
  `expect(PANEL_POSITION_OPTIONS).toEqual([{ value: "right", label: "Right edge" }, { value: "playbar", label: "Over the Playbar" }, { value: "centre", label: "Window centre" }])`.
- [ ] **Step 3:** `bun run test src/ui/settingsSection.view.test.ts` → FAIL (not exported).
- [ ] **Step 4:** Add `PANEL_POSITION_OPTIONS` (import `PanelPosition` as a type from
  `../types/domain`). In `stdlib.d.ts` add:
  `SettingsRow(props: { label: string; htmlFor?: string; children?: ReactNode }): ReactElement` and
  `Select(props: { options: readonly { value: string; label: string }[]; value: string; onChange(value: string): void; ariaLabel?: string }): ReactElement`.
- [ ] **Step 5:** In `settingsSection.tsx` add a `PositionRow({ settings })`. Its local state is
  initialised from `settings.getPanelPosition()`. `onChange(v)` sets the state and calls
  `settings.setPanelPosition(v)`. It renders `<SettingsRow label="Panel position"><Select options={PANEL_POSITION_OPTIONS} value={…} onChange={…} ariaLabel="Panel position" /></SettingsRow>`.
  Place it after the "Gap between tracks (seconds)" `SecondsRow` and before the `TYPES.map` toggles.
- [ ] **Step 6:** `bun run check` → PASS. P4: `grep -rn "from \"/modules/stdlib/" src/` lists
  only `src/ui/settingsSection.tsx`. (`stdlib.d.ts` declares modules; it does not import them.)
- [ ] **Step 7: Live.** Run `bun run build && spicetify apply`, then
  `Spicetify.Platform.History.push("/bespoke/settings")`. In the **Track & Playlist Preview**
  section, the row order is: Preview duration, Gap, **Panel position**, Playlists, …. The select's
  `[...options].map(o => o.textContent)` is `["Right edge","Over the Playbar","Window centre"]`.
  Set it to `centre` (native setter + `change`). `JSON.parse(localStorage.getItem("track-playlist-preview:settings")).panelPosition`
  is `"centre"` (read through `Spicetify.LocalStorage.get` if the plain key is absent).
  **Review Focus 5:** push `/search`, then `/bespoke/settings` again. The select's `value` is
  `"centre"`. Set it back to `right`.
- [ ] **Step 8:** Pre-commit verification, then commit: `Add the Panel position row to the Settings page`.

### Task 4: `panelPlacement` per position (P5–P9, P16)

**Files:**
- Modify: `src/ui/previewPanel.view.ts`
- Test: `src/ui/previewPanel.view.test.ts` (`describe("panelPlacement")`)

**Interfaces:**
- Consumes: `PanelPosition` (Task 2).
- Produces:
  ```ts
  export type StackSide = "above" | "below";
  export type PanelPlacement =
    | { position: "right"; rightPx: number; bottomPx: number; topClearancePx: number }
    | { position: "playbar"; rightPx: number; topPx: number; stack: StackSide; topClearancePx: number }
    | { position: "centre"; topClearancePx: number };
  export function panelPlacement(i: {
    position: PanelPosition;
    bar: { top: number; bottom: number; left: number; right: number } | null;
    nav: { bottom: number } | null;
    innerWidth: number;
    innerHeight: number;
  }): PanelPlacement;
  ```
  `topClearancePx` is the stack ceiling. For `playbar` and `centre` it is always the nav-based
  value (nav bottom + 8, or 72), never rule 3's `bar.bottom + 8`.

- [ ] **Step 1: Update the existing cases (P5).** Every existing `panelPlacement` call gets
  `position: "right"`. Every `bar` fixture gets a `right`: `topDockedBar` → `right: 1264`, the
  bottom-docked bar → `right: 1280`, the `left: 514` bar → `right: 934`. Every `toEqual`
  expectation gets `position: "right"` and **no other change**. Rename nothing.
- [ ] **Step 2: Write the failing new cases:**
  - `"P6: Over the Playbar, live layout → right 86, top 72, stack below"`: `position: "playbar"`,
    bar `{ left: 1473, top: 56, right: 1893, bottom: 472 }`, nav `{ bottom: 64 }`, 1909×1143 →
    `toEqual({ position: "playbar", rightPx: 86, topPx: 72, stack: "below", topClearancePx: 72 })`.
  - `"P16: the live-layout panel box lies inside the Playbar box"`: from the P6 result,
    `left = 1909 − 86 − 280 = 1543 ≥ 1473`, `left + 280 ≤ 1893`, `top 72 ≥ 56`, `top + 384 ≤ 472`.
  - `"P7: bottom strip, 1280×800 → left 500, top clamped to 400, stack above"`: bar
    `{ left: 0, top: 720, right: 1280, bottom: 800 }` → `rightPx 500` (so left = 1280 − 500 − 280 =
    500), `topPx 400`, `stack "above"`.
  - `"P8: stack above exactly when panelTop − 8 − ceiling ≥ 64"`: with nav bottom 64 (ceiling 72),
    choose bar centres giving `topPx` 144 → `"above"` and 143 → `"below"` (bar
    `{ left: 0, right: 420, top: cy − 100, bottom: cy + 100 }` with `cy` = 336 and 335, window
    1280×1143).
  - `"P8: unclamped panel is centred on the Playbar"`: bar `{ left: 400, right: 800, top: 300,
    bottom: 700 }`, 1280×1143 → panel left 460 (`rightPx` 540), `topPx` 308.
  - `"P8: horizontal clamp to 16 px from either side"`: bar centre x 155 → left 16; bar centre
    x 1280 − 155 → `rightPx` 16 (window 1280). At centre x 156 → left exactly 16 (156 − 140).
  - `"P8: vertical clamp — centre within 208 px of the top or bottom"`: bar centre y 207 →
    `topPx` 16; centre y `innerHeight − 207` → `topPx` = `innerHeight − 400`.
  - `"Review focus 2: window smaller than panel plus gaps keeps top/left at 16"`: bar centred in a
    250×300 window → `topPx` 16 and `rightPx` = 250 − 16 − 280 (= −46; left stays 16).
  - `"P9: Over the Playbar without a Playbar element → the Right edge result"`: for nav
    `{ bottom: 64 }` and nav `null`, `panelPlacement({ position: "playbar", bar: null, … })`
    `toEqual` `panelPlacement({ position: "right", bar: null, … })`.
  - `"Window centre → ceiling only"`: `position: "centre"`, nav `{ bottom: 64 }` →
    `{ position: "centre", topClearancePx: 72 }`, and nav `null` → `topClearancePx` 72, nav
    `{ bottom: 80 }` → 88.
- [ ] **Step 3:** `bun run test src/ui/previewPanel.view.test.ts` → the new cases FAIL.
- [ ] **Step 4:** Implement. `right` runs today's body unchanged, with `position: "right"` added
  to each return. `playbar` with `bar === null` returns `panelPlacement({ ...i, position: "right" })`.
  Otherwise it computes, with `clamp(v, lo, hi) = Math.max(lo, Math.min(v, hi))` (lower bound
  wins, Review Focus 2):
  `left = clamp((bar.left + bar.right) / 2 − 140, 16, innerWidth − 16 − 280)`,
  `top = clamp((bar.top + bar.bottom) / 2 − PANEL_HEIGHT_PX / 2, 16, innerHeight − 16 − PANEL_HEIGHT_PX)`,
  `rightPx = innerWidth − left − 280`, and
  `stack = top − STACK_GAP_PX − ceiling >= MIN_STACK_ROOM_PX ? "above" : "below"`.
  `centre` returns only the ceiling. Add a `PANEL_WIDTH_PX = 280` constant next to
  `PANEL_HEIGHT_PX`.
- [ ] **Step 5:** Keep `previewPanel.tsx` compiling until Task 6 replaces this code. Its
  `measurePlacement` passes `position: "right"`. Because the result is now a union, `open()` wraps
  its three `setProperty` calls in `if (place.position === "right")`. Then `bun run check` → PASS.
- [ ] **Step 6:** Pre-commit verification, then commit: `Compute panel placement for each panel position`.

### Task 5: Placement → CSS (`placementStyle` and per-position rules)

**Files:**
- Modify: `src/ui/previewPanel.view.ts`, `src/ui/previewPanel.css`
- Test: `src/ui/previewPanel.view.test.ts` (new `describe("placementStyle")`)

**Interfaces:**
- Consumes: `PanelPlacement`, `StackSide` (Task 4).
- Produces:
  ```ts
  export interface PlacementStyle {
    position: PanelPosition;           // written to data-position
    stack: StackSide;                  // written to data-stack
    vars: Partial<Record<"--tpp-panel-right" | "--tpp-panel-bottom" | "--tpp-panel-top" | "--tpp-top-clearance", string>>;
  }
  export function placementStyle(p: PanelPlacement): PlacementStyle;
  ```

- [ ] **Step 1: Write the failing tests:**
  - `right` `{ rightPx: 16, bottomPx: 104, topClearancePx: 72 }` → `{ position: "right", stack: "above", vars: { "--tpp-panel-right": "16px", "--tpp-panel-bottom": "104px", "--tpp-top-clearance": "72px" } }`.
  - `playbar` P6 result → `{ position: "playbar", stack: "below", vars: { "--tpp-panel-right": "86px", "--tpp-panel-top": "72px", "--tpp-top-clearance": "72px" } }`.
  - `centre` `{ topClearancePx: 72 }` → `{ position: "centre", stack: "above", vars: { "--tpp-top-clearance": "72px" } }`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (a `switch` on `p.position`).
- [ ] **Step 4: CSS.** Leave every existing rule in `previewPanel.css` as it is. Those rules are the
  Right edge placement and also apply before the first `place()`. Add `--tpp-panel-top: 16px;` to
  `#tpp-preview-root`'s defaults. Then append these rules. Each rule sets the anchor it does not
  use to `auto` (Review Focus 3):
  ```css
  /* Over the Playbar: panel anchored by right + top (spec: Geometry). */
  #tpp-preview-root[data-position="playbar"] .tpp-panel {
    bottom: auto;
    top: var(--tpp-panel-top);
  }
  #tpp-preview-root[data-position="playbar"][data-stack="above"] .tpp-removals-stack {
    top: auto;
    bottom: calc(100vh - var(--tpp-panel-top) + 8px);
    max-height: calc(var(--tpp-panel-top) - 8px - var(--tpp-top-clearance));
  }
  #tpp-preview-root[data-position="playbar"][data-stack="below"] .tpp-removals-stack {
    bottom: auto;
    top: calc(var(--tpp-panel-top) + var(--tpp-panel-height) + 8px);
    max-height: calc(100vh - var(--tpp-panel-top) - var(--tpp-panel-height) - 8px - 16px);
  }
  /* Window centre: centred in CSS, so it follows a resize (D6). */
  #tpp-preview-root[data-position="centre"] .tpp-panel {
    right: auto;
    bottom: auto;
    left: calc(50% - 140px);
    top: calc(50% - var(--tpp-panel-height) / 2);
  }
  #tpp-preview-root[data-position="centre"] .tpp-removals-stack {
    right: auto;
    top: auto;
    left: calc(50% - 140px);
    bottom: calc(50% + var(--tpp-panel-height) / 2 + 8px);
    max-height: calc(50vh - var(--tpp-panel-height) / 2 - 8px - var(--tpp-top-clearance));
  }
  ```
  The base rules never set `top`, and an override stops matching as soon as the attribute changes,
  so switching back to Right edge leaves no stale anchor. Update the
  root's header comment: the variables are written by `place()` at each open and on every
  settings change.
- [ ] **Step 5:** `bun run check` → PASS.
- [ ] **Step 6:** Pre-commit verification, then commit: `Anchor the panel and stack per panel position`.

### Task 6: Re-place on open and on every settings change (P10–P15, P17–P20)

**Files:**
- Modify: `src/ui/previewPanel.tsx`, `src/index.ts`

**Interfaces:**
- Consumes: `panelPlacement` (Task 4), `placementStyle` (Task 5), `Settings.getPanelPosition()`
  and `Settings.onChange` (Task 2).
- Produces: two new `PreviewPanelDeps` fields: `getPanelPosition(): PanelPosition;` and
  `onSettingsChange(listener: () => void): () => void;`.

- [ ] **Step 1:** In `previewPanel.tsx`, `measurePlacement(position: PanelPosition)` passes
  `position` and the Playbar rect's `right`. Inside `createPreviewPanel`, a `place()` measures,
  calls `placementStyle`, writes every entry of `vars` with `rootEl.style.setProperty`, and sets
  `rootEl.dataset.position` / `rootEl.dataset.stack`. It never touches focus or the store.
  `open()` calls `place()` in place of the three inline `setProperty` calls. Right after the root
  renders, call `deps.onSettingsChange(place)`. Do not keep the unsubscribe; add a one-line comment
  that teardown is #8.
- [ ] **Step 2:** In `index.ts`, pass `getPanelPosition: () => settings.getPanelPosition()` and
  `onSettingsChange: (listener) => settings.onChange(listener)` to `createPreviewPanel`. Update the
  file header comment of `previewPanel.tsx` to cite P1–P20.
- [ ] **Step 3:** `bun run check` → PASS. `index.test.ts` mocks `createPreviewPanel`, so it needs
  no change.
- [ ] **Step 4:** `bun run build && spicetify apply`. Confirm `Spicetify.Modules.report` shows the
  module loaded.
- [ ] **Step 5: Live verification over CDP**, recording expression → result. Use a 1280×800 window
  (resize via `window.resizeTo` or the OS if that has no effect) unless a step says otherwise.
  Measure with `getBoundingClientRect()` on `#tpp-preview-root .tpp-panel`,
  `#tpp-preview-root .tpp-removals-stack`, `.Root__now-playing-bar` and the notice container
  (`.notistack-Snackbar` during `Spicetify.showNotification("probe")`). Build pending removals on
  a throwaway playlist the agent creates, and undo them and delete the playlist in a `finally`, as in
  the preview-panel plan's Task 11.
  - **Review Focus 4:** before any preview has run since the restart, set Panel position to
    `centre` from the Settings page. No console error. Start a playlist preview: the panel opens
    centred.
  - **P10:** at `centre`, the panel's centre is within 1 px of `(innerWidth/2, innerHeight/2)`.
    Resize the window with the panel open. Still within 1 px of the new centre, with no reopen.
  - **P19/P20 (centre):** with 1 pending removal, the stack's bottom is 8 px above the panel's top.
    With enough removals to overflow, the stack's top is ≥ the stack ceiling, its `scrollHeight` is
    greater than its `clientHeight`, and the panel is unmoved.
  - **P11:** in each position, with ≥1 pending removal, the stack's `left`/`right` equal the
    panel's. The gap between them is 8 px. Close the panel (Stop): the stack's rect is unchanged.
  - **P12:** with the panel open, walk all six transitions from the Settings page
    (right→playbar→centre→right→centre→playbar→right). After each change: `#tpp-preview-root section`
    still exists, the heading is unchanged, the progress-bar fill width has not reset to 0, and
    `document.activeElement` is the Panel position `<select>`. The rects match the new position.
  - **Review Focus 3:** at `playbar` in the live layout (stack **below**) with ≥1 removal, switch to
    `right`, then `centre`. After each switch the stack's height is ≤ its rows' total height plus
    gaps (no stretching), and its computed `top`/`bottom` match the position's rules.
  - **P13:** close the panel with a removal pending, then change the position. The stack moves to the
    new position's spot, measured now. Resize the window first, then change the position. Compare
    the result with the spot worked out by hand (spec, Geometry) from the rects after the resize.
  - **P14:** with the panel open, change duration, gap and one collection toggle. The panel's and
    stack's rects are identical before and after.
  - **P15/P17/P18:** at `right` and `centre` (and P16's notice clause at `playbar`), the panel's
    and stack's rects intersect neither the notice container (nor, for right and centre, the
    Playbar). `Spicetify.PopupModal.display({ title: "probe", content: "" })` covers the panel
    (`elementFromPoint` at the panel's centre hits the modal). Hide it in a `finally`.
    `grep -rE 'e-[0-9]' src/` → empty.
  - **P6/P16 live:** at `playbar` in the default 1909×1143 layout, the panel's rect is x 1543–1823,
    y 72–456, and the stack is below it.
- [ ] **Step 6:** Pre-commit verification, then commit: `Re-place the panel on every settings change`.
  If a defect was fixed during Step 5, include it in this commit and say so in the body.

### Task 7: Update `README.md`

- [ ] **Step 1:** In the Settings table, add after the Gap row:
  `| Panel position | Right edge | Where the preview panel and Undo list appear: Right edge, Over the Playbar (covers Spotify's now-playing area), or Window centre. Applies immediately. |`
- [ ] **Step 2:** Pre-commit verification, then commit: `Document the Panel position setting`.

### Task 8: Update `CLAUDE.md`

- [ ] **Step 1:** In the Documentation list, after the Settings-page spec entry, add one pointer:
  `- [Panel-position spec](docs/specs/2026-09-27-panel-position-design.md) — the Panel position setting (Right edge / Over the Playbar / Window centre), criteria P1–P20.`
- [ ] **Step 2:** Pre-commit verification, then commit: `Point CLAUDE.md at the panel-position spec`.

### Task 9: Annotate `docs/specs/2026-07-25-preview-modal-design.md`

- [ ] **Step 1:** Below the **Placement.** paragraph (Layering) and below AC70, add in italics:
  _These are the **Right edge** rules. AC70's "on the right edge" means rules 1–4, including rule
  4's left-of-Playbar fallback. See the [panel-position spec](2026-09-27-panel-position-design.md),
  P15–P17, for the other positions._
- [ ] **Step 2:** Pre-commit verification, then commit: `Mark the panel spec's placement as the Right edge rules`.

### Task 10: Annotate `docs/specs/2026-09-27-settings-page-design.md`

- [ ] **Step 1:** In Deferred Items, append to the `#9` entry:
  ` — addressed by the [panel-position spec](2026-09-27-panel-position-design.md)`.
- [ ] **Step 2:** Pre-commit verification, then commit: `Link the Settings-page spec's #9 entry to its spec`.

### Task 11: Post-implementation check

- [ ] **Step 1:** Read `git diff main...HEAD --stat` and the diff itself. Confirm each Required
  Task happened: `src/types/stdlib.d.ts` declares `SettingsRow` and `Select` (Config table); the
  stored settings gained `panelPosition` with no key change; README, CLAUDE.md and both spec
  annotations are present. No glossary or ADR work applies (spec: none). Fix anything missing in
  this task.
- [ ] **Step 2:** If anything was fixed: pre-commit verification, then commit:
  `Complete the panel-position documentation`.

### Task 12: Final build

- [ ] **Step 1:** `bun run build`. Expected: exits 0 and writes `index.js` and `metadata.json` to
  the modules folder. Fix any failure and re-run until it passes.
- [ ] **Step 2:** `spicetify apply`, then `Spicetify.Modules.report` shows the module loaded
  without error.
- [ ] **Step 3:** If a fix was needed: pre-commit verification, then commit:
  `Fix the build after the panel-position changes`.

---

## Before finishing the branch

After Task 12, if a cross-model review helper is available (e.g. the Codex plugin's adversarial
review), run it with focus: *"Judge correctness against the spec's acceptance criteria (P1–P20)
only. Do not flag anything outside the stated criteria — no design alternatives, hardening, or
scope the spec did not claim."* This never gates the merge. Then, per `CLAUDE.md`, ask the user
whether to remove the CDP launch flag.
