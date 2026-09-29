# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A [Spicetify](https://spicetify.app) v3 **module** that restores Spotify's removed track preview and
extends it to whole playlists, albums, artists and Liked Songs. Preview audio comes from Spotify's
own preview clips played in an `<Audio>` element — the Spotify player itself is only paused and
resumed, never seeked.

## Commands

```bash
bun run build        # build into <config>/modules/track-playlist-preview/
bun run build:local  # build into ./dist/track-playlist-preview@<version>/, without installing
bun run watch        # rebuild on change
bun run check        # typecheck + tests — the full quality gate
bun run check:dist   # check the build:local folder (files, metadata, css order, react-shim)
bun run test         # vitest only
bun run typecheck    # tsc --noEmit only
spicetify apply      # required after any build; force-kills and restarts Spotify
```

There is no linter. `bun run check` is the whole gate.

Commit subjects start with a Conventional Commit prefix (`feat:`, `fix:`, `docs:`, `chore:`,
`test:`, `refactor:`, `ci:`, `build:`) — release-please reads them to pick the version and write
the changelog.

## Documentation

- [Design spec](docs/specs/2026-07-22-track-playlist-preview-design.md) — architecture, module
  boundaries, verified internal-API findings, and acceptance criteria AC1–AC45.
- [ADR 0001](docs/adr/0001-preview-audio-via-trackpreview-graphql.md) — why preview audio comes from
  the `trackPreview` GraphQL operation instead of driving `Spicetify.Player`.
- [Preview panel spec](docs/specs/2026-07-25-preview-modal-design.md) — the non-blocking preview
  panel and pending-removals stack, placement, and acceptance criteria AC46–AC70.
- [Remove-from-playlist spec](docs/specs/2026-09-26-remove-from-playlist-design.md) — Remove, the
  Undo window and exclusion, criteria R1–R16.
- [Settings-page spec](docs/specs/2026-09-27-settings-page-design.md) — settings on the Spicetify
  Settings page, the `load(ctx)` entry, criteria S1–S18.
- [Panel-position spec](docs/specs/2026-09-27-panel-position-design.md) — the Panel position setting (Right edge / Over the Playbar / Window centre), criteria P1–P20.
- [Unload-teardown spec](docs/specs/2026-09-27-unload-teardown-design.md) — disposing everything on unload, the per-load wiring, criteria U1–U31.
- [View-order spec](docs/specs/2026-09-28-view-order-design.md) — sort and filter in the preview queue, criteria V1–V22 and V8a.
- [Store-publishing spec](docs/specs/2026-09-28-store-publishing-design.md) — the kit build,
  release-please, publishing to the module store, criteria M1–M25.
- [ADR 0002](docs/adr/0002-build-with-spicetify-kit.md) — why the build uses spicetify-kit.
- [Spicetify v3 platform notes](docs/spicetify-v3-platform.md) — read before relying on how the
  CLI, loader or stdlib behave: installs, dependencies, load order and readiness, Settings page,
  devtools. Record new verified findings there.

## Build

- `build.ts` runs `spicetify-kit build src` (`@spicetify/kit`, pinned) **under Node ≥ 22** — under
  Bun, kit's sass fails with `Invalid protobuf` — then copies `.kit-build/track-playlist-preview@<version>/`
  into the modules folder (`build`, `watch`) or `dist/` (`build:local`, the folder releases zip).
- `src/metadata.json` is the only source of module metadata; `src/index.scss` `@use`s the `.css`
  files. Never import CSS from TS — kit rejects it. React resolves via stdlib's `react-shim.js`.
- `index.js` exports only `load(ctx)`, which awaits a capped `waitForClient` for `React`, `ReactDOM`,
  `ContextMenu` and `Platform`; check other namespaces (`GraphQL`, `Snackbar`) before use.
- Kit fails the build on an error-tier module-standard finding, and rewrites the git-ignored
  `src/classmap.d.ts` each run.

Kit does **not** typecheck. A green build says nothing about types — run `bun run check`.

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
- **Only `ui/settingsSection.tsx` imports `/modules/stdlib/`** — type imports included; `index.ts`
  takes `ModuleRuntimeContext` from it.
- **Everything `wire()` mounts must have a teardown step** in `dispose()` and in its rollback
  (see the [unload-teardown spec](docs/specs/2026-09-27-unload-teardown-design.md)).
- **Never use `Spicetify.PopupModal` for an in-session surface.** Notices render beneath it; use
  the panel instead (see the [panel spec](docs/specs/2026-07-25-preview-modal-design.md)).

## Debugging against the live client

Spotify is built on Chromium (CEF) and exposes the Chrome DevTools Protocol on `127.0.0.1:8088`
when launched with `--remote-debugging-port=8088`. Driving `Runtime.evaluate` over that socket is
far faster than clicking through the UI, and is how every internal-API finding in the spec was
verified.

CLI 3.0.0-beta.19 passes no launch flags (`config-xpui.ini`'s `spotify_launch_flags` is ignored),
and every `spicetify apply` restarts Spotify without the port. After each apply, relaunch it:
`pkill -x spotify; sleep 3; setsid /opt/spotify/spotify --remote-debugging-port=8088 >/dev/null 2>&1 &`,
then confirm `curl -s 127.0.0.1:8088/json/version` answers.

The committed harness is `scripts/cdp-eval.mjs`:
`node scripts/cdp-eval.mjs 'Spicetify.Player.isPlaying()'`.

- `node scripts/check-unload.mjs [--no-session]` checks disable → enable live; without
  `--no-session` it previews Liked Songs, which interrupts playback.
- `Spicetify.Modules.report` shows which modules loaded and why any failed;
  `Spicetify.Modules.list()` shows the loaded version.
- stdlib's registries are importable ES modules, e.g. the Playbar buttons:
  `(await import(location.origin + "/modules/stdlib/src/registers/playbarButton.js")).default` (a
  `Set`). Source lives under `~/.config/spicetify/modules/stdlib/src/`.
- A probe that registers UI must remove it in a `finally`, or it leaks into the live client.
