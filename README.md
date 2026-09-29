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

Requires [Spicetify](https://spicetify.app/docs/getting-started) **v3** (CLI 3.x). v2 is not
supported.

### From the module store

Install **Track & Playlist Preview** from the in-client store, or from a terminal:

```bash
spicetify pkg install track-playlist-preview
spicetify pkg enable track-playlist-preview
spicetify apply          # restarts Spotify
```

### From source

Also requires [Bun](https://bun.com/docs/installation) and [Node.js](https://nodejs.org) ≥ 22.

```bash
git clone https://github.com/Heyian/track-playlist-preview.git
cd track-playlist-preview
bun install
bun run build            # builds into your Spicetify modules folder
spicetify apply          # restarts Spotify
```

A source build replaces a store install of the module in the `modules` folder; the store's copy is
left in place.

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
bun run build:local  # build into ./dist/track-playlist-preview@<version>/, without installing
bun run watch        # rebuild on change and install as `build` does
bun run check        # typecheck + tests
bun run check:dist   # check the build:local folder's files and metadata
bun run test         # tests only
```

After any build, run `spicetify apply` for Spotify to pick up the change. It force-restarts Spotify.

[`build.ts`](build.ts) runs [spicetify-kit](https://www.npmjs.com/package/@spicetify/kit)
(`spicetify-kit build src`) under Node ≥ 22, then copies its output into place. Kit bundles
`src/index.ts`, compiles `src/index.scss` to `index.css`, copies `src/metadata.json`, and fails the
build on an error-tier finding against the module standard. React resolves through stdlib's
react-shim. The output is unminified and ships its sourcemap. `build:local` writes the folder the
release zips.

`src/metadata.json` is the source of the module metadata. Its `version` must equal `package.json`'s;
release-please bumps both.

Commits use Conventional Commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `test:`,
`refactor:`, `ci:`, `build:`): release-please reads them to choose the next version and write the
changelog. Merging a release PR tags the release, and CI attaches the zip and submits it to the
module store.

### Debugging against the live client

Spotify's desktop client is built on Chromium (CEF), so it can expose the Chrome DevTools Protocol.
Spicetify CLI 3.0.0-beta.19 passes no launch flags, so after `spicetify apply` restart Spotify
yourself with `/opt/spotify/spotify --remote-debugging-port=8088` (adjust the path). It then listens
on `127.0.0.1:8088`, which you can drive programmatically — useful for probing internal APIs without
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
