# Track & Playlist Preview

A [Spicetify](https://spicetify.app) **v3** module that brings back Spotify's removed track
preview — and extends it to whole playlists, albums, artists and Liked Songs.

> **Spicetify v3 only.** This module targets the Spicetify v3 CLI (3.x) and its module system.
> Spicetify v2 (`spicetify-cli` 2.x and its `Extensions/` folder) is not supported.

Spotify quietly removed the per-track preview button (the small triangle that played a short snippet
without committing to full playback) from playlist and Liked Songs views around mid-2026. There was
no changelog entry. This extension restores it.

## What it does

- **Preview a single track** — right-click any track → *Preview track (15s)*.
- **Preview from a track onward** — right-click → *Preview from here* to walk the rest of the
  collection from that point.
- **Preview a whole collection** — a preview button in the action bar (next to Play / Shuffle /
  Download) on playlist, album, artist and Liked Songs pages, plus a right-click item on
  collections.
- **Stay in control** — a non-blocking preview panel shows the current track's artwork and
  progress, with Stop / Next / Remove controls. While the panel has focus, `→` skips to the next
  track, `Delete` removes the current track, and `Esc` stops the session. Removing a track shows an
  Undo option for 5 seconds; Remove is only offered on playlists you can edit.

Previews use Spotify's own short preview clips, played through a separate audio element. That means:

- **Nothing is added to your listening history.**
- **No Premium required.**
- **Your playback is never disturbed** — the module only pauses your music when a session starts
  and resumes it when the session ends, if it was playing. Your queue, context and position are left exactly as they
  were.

Tracks without a preview clip — local files, podcast episodes, some region-restricted tracks — are
skipped automatically and reported at the end of the session.

## Install

Requires [Spicetify](https://spicetify.app/docs/getting-started) **v3** (CLI 3.x) and
[Bun](https://bun.com/docs/installation). v2 is not supported: the build installs into the v3
`modules` folder, and `spicetify config extensions …` is not used.

```bash
git clone https://github.com/Heyian/track-playlist-preview.git
cd track-playlist-preview
bun install
bun run build            # bundles into your Spicetify modules folder
spicetify apply          # restarts Spotify
```

The module depends on Spicetify's **stdlib** module (≥ 1.13.0), declared in its `metadata.json`.
`spicetify apply` installs stdlib and keeps it current, so there is nothing to install by hand. If
you disable stdlib, this module stops loading: `Spicetify.Modules.report.failed` then names the
missing dependency.

## Settings

Open the profile menu in Spotify → **Spicetify Settings** → **Track & Playlist Preview** section.

| Setting | Default | Description |
| --- | --- | --- |
| Preview duration (seconds) | 15 | How long each clip plays before advancing. Minimum 1. |
| Gap between tracks (seconds) | 0 | Pause inserted between previews. |
| Panel position | Right edge | Where the preview panel and Undo list appear: Right edge, Over the Playbar (covers Spotify's now-playing area), or Window centre. Applies immediately. |
| Playlists / Liked Songs / Albums / Artists | on | Toggle the action-bar button and the collection right-click item per type. |

## Development

```bash
bun run build        # build into <spicetify config>/modules/track-playlist-preview/
bun run build:local  # build into ./dist/track-playlist-preview/ instead (minified), without installing
bun run watch        # rebuild on change
bun run check        # typecheck + tests
bun run test         # tests only
```

After any build, run `spicetify apply` for Spotify to pick up the change. It force-restarts Spotify.

The bundler is a small [Bun](https://bun.com/docs/bundler) script in [`build.ts`](build.ts). It
aliases `react` / `react-dom` to Spotify's own `Spicetify.React` / `Spicetify.ReactDOM` and writes
the v3 module's `index.js`, `index.css` and `metadata.json` (version taken from `package.json`).
Imported CSS goes to `index.css`, which `metadata.json` declares as `entries.css`: Spicetify's loader
adopts the stylesheet when the module loads and removes it when the module is disabled. `index.js`
exports `load(ctx)`, which waits (capped) for Spicetify to finish loading before wiring anything.

### Debugging against the live client

Spotify's desktop client is built on Chromium (CEF), so it can expose the Chrome DevTools Protocol. Under Spicetify v3,
`spicetify dev` enables developer mode, and Spotify started by `spicetify apply` listens on
`127.0.0.1:8088`, which you can drive programmatically — useful for probing internal APIs without
clicking through the UI:

```bash
node scripts/cdp-eval.mjs 'JSON.stringify(Spicetify.Modules.report)'
```

`node scripts/check-unload.mjs` checks that disabling the module removes everything it added and that
re-enabling it adds each piece back exactly once. It previews Liked Songs first, which interrupts
Spotify playback for a few seconds; pass `--no-session` to skip that part.

## Caveats

This module depends on **internal, undocumented Spotify APIs**. They carry no compatibility
guarantee and can change without notice. In particular, a Spotify client update may move the action
bar and break button injection, or change the preview lookup. Last verified against Spotify
`1.2.96.518` with Spicetify CLI `3.0.0-beta.19` and stdlib `1.13.0`.

Not affiliated with, endorsed by, or sponsored by Spotify.

## License

[MIT](LICENSE) © Marc-Antoine Favreau
