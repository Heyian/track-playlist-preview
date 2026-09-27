# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A [Spicetify](https://spicetify.app) v3 **module** that restores Spotify's removed track preview and
extends it to whole playlists, albums, artists and Liked Songs. Preview audio comes from Spotify's
own preview clips played in an `<Audio>` element — the Spotify player itself is only paused and
resumed, never seeked.

## Commands

```bash
bun run build        # bundle into <config>/modules/track-playlist-preview/
bun run build:local  # bundle into ./dist/track-playlist-preview/ (minified), without installing
bun run watch        # rebuild on change
bun run check        # typecheck + tests — the full quality gate
bun run test         # vitest only
bun run typecheck    # tsc --noEmit only
spicetify apply      # required after any build; force-kills and restarts Spotify
```

There is no linter. `bun run check` is the whole gate.

## Documentation

- [Design spec](docs/specs/2026-07-22-track-playlist-preview-design.md) — architecture, module
  boundaries, verified internal-API findings, and acceptance criteria AC1–AC45.
- [ADR 0001](docs/adr/0001-preview-audio-via-trackpreview-graphql.md) — why preview audio comes from
  the `trackPreview` GraphQL operation instead of driving `Spicetify.Player`.
- [Preview panel spec](docs/specs/2026-07-25-preview-modal-design.md) — the non-blocking preview
  panel and pending-removals stack, placement, and acceptance criteria AC46–AC70.
- [Remove-from-playlist spec](docs/specs/2026-09-26-remove-from-playlist-design.md) — Remove, the
  Undo window and exclusion, criteria R1–R16.

## Build

The bundler is a local Bun script, `build.ts` — **not** `spicetify-creator`, which is deprecated and
was removed. It does four things worth knowing:

1. Aliases `react` / `react-dom` to `Spicetify.React` / `Spicetify.ReactDOM` via a Bun plugin.
   Import them normally; never add them as dependencies. Bundling a second React breaks hooks.
2. Inlines imported CSS into the output JS as an injected `<style>` — a sibling `.css` file would
   never be loaded.
3. Wraps output in a loop awaiting `Spicetify.React`, `ReactDOM` and `Platform`. Other namespaces
   (`ContextMenu`, `GraphQL`, `Snackbar`) still need checking before use.
4. Writes `index.js` and a `metadata.json` generated from `package.json` into
   `<config>/modules/track-playlist-preview/`. v3 ignores the v2 `Extensions/` folder and rejects
   `spicetify -c`; the modules folder is parsed from `spicetify path`, falling back to
   `~/.config/spicetify/modules`.

The bundler does **not** typecheck. A green build says nothing about types — run `bun run check`.

## Architecture

Only adapter modules may touch `Spicetify` globals. `previewEngine` is pure — audio and timers
arrive as injected ports, which is what makes it unit-testable without a running client.

`previewSource` (clip URLs) · `collections/` (URI → ordered tracks) · `previewEngine` (session state
machine) · `playerCoordinator` (pause/resume only) · `pendingRemovals` (removal undo stack) ·
`settings` · `ui/` (including `ui/previewPanel`)

## Non-obvious constraints

These are load-bearing; violating any is a defect. Full rationale in the spec's "Design constraints".

- **Never hardcode an encore version string.** Action-bar button classes look like
  `e-10451-legacy-button…`; that number changes across Spotify updates. Read styling from a live
  sibling `[data-encore-id="buttonTertiary"]`. A grep for `e-[0-9]` in `src/` must return nothing.
- **Never copy a GraphQL `sha256Hash` into source.** Read operations from
  `Spicetify.GraphQL.Definitions` at runtime so a rotated hash self-heals.
- **`Spicetify.Player.data.position` does not exist.** Use `Spicetify.Player.getProgress()`.
- **`spotify:playlist:…` parses as `playlist-v2`, not `PLAYLIST`.** Gating a context-menu predicate
  on `URI.Type.PLAYLIST` silently never matches. Use `URI.isPlaylistV1OrV2()`.
- **Only `playerCoordinator` may call `Spicetify.Player`,** and only `pause` / `resume`.
- **Icons are always full `<svg>` markup, never a bare icon name.** Build markup from
  `Spicetify.SVGIcons[name]` and pass that. Under v3, stdlib's compat shim injects an icon string
  verbatim as SVG innerHTML, so a bare name like `"skip-forward"` renders an empty element. The
  preview panel's controls still rely on this.
- **Never use `Spicetify.PopupModal` for an in-session surface.** Notices render beneath it; use
  the panel instead (see the [panel spec](docs/specs/2026-07-25-preview-modal-design.md)).

## Debugging against the live client

Spotify is built on Chromium (CEF), so once `spicetify dev` has enabled developer mode it exposes the
Chrome DevTools Protocol on `127.0.0.1:8088`. Driving `Runtime.evaluate` over that socket is far faster than clicking through
the UI, and is how every internal-API finding in the spec was verified.

The committed harness is `scripts/cdp-eval.mjs`:
`node scripts/cdp-eval.mjs 'Spicetify.Player.isPlaying()'`.

- `Spicetify.Modules.report` shows which modules loaded and why any failed;
  `Spicetify.Modules.list()` shows the loaded version.
- stdlib's registries are importable ES modules, e.g. the Playbar buttons:
  `(await import(location.origin + "/modules/stdlib/src/registers/playbarButton.js")).default` (a
  `Set`). Source lives under `~/.config/spicetify/modules/stdlib/src/`.
- A probe that registers UI must remove it in a `finally`, or it leaks into the live client.
