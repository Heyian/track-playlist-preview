# Handoff: report the v3 Playbar icon-name bug upstream

Written 2026-09-26. Work from `~/DEV/track-playlist-preview` on the **`v3-beta` branch, in the main
checkout. Don't use a worktree.** Start with `git branch --show-current`. If it isn't `v3-beta`,
run `git checkout v3-beta`.

## Goal

1. File an issue on **`spicetify/modules`**, where stdlib's source lives. Under Spicetify v3,
   `Spicetify.Playbar.Button` and `Playbar.Widget` render an empty icon when given a Spicetify icon
   name such as `"skip-forward"`. v2 accepted icon names.
2. If the user wants it, open a PR with the fix described below.

Both are outward-facing. Show the user the issue text, and the PR diff if there is one, and get a
yes before posting either. Don't push `v3-beta` changes to `main`. v3 is still in beta, so v3 fixes
stay on `v3-beta`.

## State at handoff

- `main` (`fb7a3a4`) and `v3-beta` are both pushed. `v3-beta` is ahead of `main` by this handoff plus:
  - `1747d97`: the workaround in this repo. `src/ui/playbarControls.ts` passes full `<svg>` markup
    built from `Spicetify.SVGIcons[name]`, and `src/ui/playbarControls.test.ts` guards it.
  - `313d4cb`: `build.ts` writes a v3 module (`index.js` and `metadata.json`) into
    `<config>/modules/track-playlist-preview/`.
  - `b56f890`: v3 docs in CLAUDE.md and README.
- The user confirmed live that both Playbar icons render and work with the workaround deployed.
- Environment: Spicetify CLI 3.0.0-beta.19 (`spicetify-cli-beta-bin`), Spotify 1.2.96.518,
  stdlib 1.13.0. CDP is on `127.0.0.1:8088`: `node scripts/cdp-eval.mjs '<expr>'`.
- Our workaround stays after an upstream fix, because full markup works under v2 and v3 alike.

## The bug, verified

Upstream file: `spicetify/modules` → `modules/stdlib/src/playbar-compat.tsx`, introduced in
`8d54cc3` ("feat(stdlib): make Spicetify.Playbar.Button/Widget work again", 2026-07-28). It is still
present on `main` as of 2026-09-26. The installed copy is
`~/.config/spicetify/modules/stdlib/src/playbar-compat.js`.

- `PlaybarCompat` stores the icon string as-is. `register()` renders
  `PlaybarButton({ icon: innerSvg(self._icon) })`.
- `innerSvg` only strips an outer `<svg>…</svg>` wrapper. A bare name falls through unchanged.
- `createIconComponent` (`src/createIconComponent.tsx`) passes the string to
  `UI.Icon` as `dangerouslySetInnerHTML`. The name therefore becomes a text node inside the `<svg>`.
- Observed live: the button is a visible 32×32 `BUTTON` whose markup is
  `<svg … viewBox="0 0 16 16">skip-forward</svg>`, with no path. The button has a size but shows no
  icon, which is how an earlier probe mistook it for working.

v2's behaviour, the contract the shim should keep: `spicetify/cli` at tag `v2.45.1`,
`src/jsHelper/spicetifyWrapper/playbar.js` lines 37-43 (Button) and 122-128 (Widget):

```js
if (newInput && Spicetify.SVGIcons[newInput]) {
  newInput = `<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">${Spicetify.SVGIcons[newInput]}</svg>`;
}
```

The v2 type declarations also say `icon: Icon | string`.

### Minimal repro, over CDP, with cleanup

```js
(async () => {
  const b = new Spicetify.Playbar.Button("repro", "skip-forward");
  try {
    await new Promise((r) => setTimeout(r, 500));
    return document.querySelector('.spicetify-playbar-buttons [aria-label="repro"] svg')?.outerHTML;
  } finally {
    b.deregister();
  }
})()
```

Expected: the markup contains a `<path>`. Actual: the text `skip-forward`, with no path. Passing
`Spicetify.SVGIcons["skip-forward"]` wrapped in `<svg>` renders correctly, so the render path is
fine and only the name lookup is missing.

## Suggested fix (for the issue body or a PR)

In `playbar-compat.tsx`, resolve a known name before stripping the wrapper. This mirrors v2:

```ts
const toInnerSvg = (icon: string): string =>
  Spicetify.SVGIcons?.[icon as keyof typeof Spicetify.SVGIcons] ?? innerSvg(icon);
```

Use it where `innerSvg(self._icon)` is called today. `SVGIcons` values are already inner markup
(`<path …/>`), which is what `createIconComponent` expects. Check how stdlib reaches `SVGIcons`
before writing the PR. It may expose its own reference rather than the global.

## Before filing

- Unverified: whether other stdlib compat shims have the same gap. v2's `Topbar.Button`
  (`topbar.js:47-53`) resolved names the same way. Grep `modules/stdlib/src` for `innerSvg` and
  `createIconComponent` callers, and mention any confirmed siblings in the same issue.
- `spicetify/modules` has no issue templates (`.github/` holds only `actions`, `rulesets`,
  `workflows`). Check for a CONTRIBUTING file and whether PRs need a linked issue.
- Search again for duplicates just before filing. On 2026-09-26 there were none for "playbar icon"
  in `spicetify/modules` or "Playbar.Button icon v3" in `spicetify/cli`.
- Include versions: CLI 3.0.0-beta.19, stdlib 1.13.0, Spotify 1.2.96.518, Linux.
