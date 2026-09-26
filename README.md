# Track & Playlist Preview

A [Spicetify](https://spicetify.app) extension that brings back Spotify's removed track preview —
and extends it to whole playlists, albums, artists and Liked Songs.

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
- **Stay in control** — Skip and Stop appear in the playbar while a preview session is running.

Previews use Spotify's own short preview clips, played through a separate audio element. That means:

- **Nothing is added to your listening history.**
- **No Premium required.**
- **Your playback is never disturbed** — the extension only pauses your music when a session starts
  and resumes it when the session ends. Your queue, context and position are left exactly as they
  were.

Tracks without a preview clip — local files, podcast episodes, some region-restricted tracks — are
skipped automatically and reported at the end of the session.

## Install

Requires [Spicetify](https://spicetify.app/docs/getting-started) **v3** and
[Bun](https://bun.com/docs/installation).

```bash
git clone https://github.com/Heyian/track-playlist-preview.git
cd track-playlist-preview
bun install
bun run build            # bundles into your Spicetify modules folder
spicetify apply          # restarts Spotify
```

## Settings

Open the profile menu in Spotify → **Track & Playlist Preview**.

| Setting | Default | Description |
| --- | --- | --- |
| Preview duration | 15 s | How long each clip plays before advancing. |
| Gap between tracks | 0 ms | Pause inserted between previews. |
| Enabled collections | all | Toggle the preview button per type: playlist, Liked Songs, album, artist. |

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
aliases `react` / `react-dom` to Spotify's own `Spicetify.React` / `Spicetify.ReactDOM`, inlines any
imported CSS into the output bundle, wraps everything so the module waits for Spicetify to finish
loading before running, and writes the v3 module's `index.js` and `metadata.json` (version taken from
`package.json`).

### Debugging against the live client

Spotify is an Electron app, so it can expose the Chrome DevTools Protocol. Under Spicetify v3,
`spicetify dev` enables developer mode, and Spotify started by `spicetify apply` listens on
`127.0.0.1:8088`, which you can drive programmatically — useful for probing internal APIs without
clicking through the UI:

```bash
node scripts/cdp-eval.mjs 'JSON.stringify(Spicetify.Modules.report)'
```

## Documentation

- [Design spec](docs/specs/2026-07-22-track-playlist-preview-design.md) — architecture, verified
  internal API findings, and acceptance criteria.
- [ADR 0001](docs/adr/0001-preview-audio-via-trackpreview-graphql.md) — why preview audio comes from
  the `trackPreview` GraphQL operation rather than from driving Spotify's player.

## Caveats

This extension depends on **internal, undocumented Spotify APIs**. They carry no compatibility
guarantee and can change without notice. In particular, a Spotify client update may move the action
bar and break button injection, or change the preview lookup. Findings in this repo were verified
against Spotify `1.2.92.147` with Spicetify `2.44.0`.

Not affiliated with, endorsed by, or sponsored by Spotify.

## License

[MIT](LICENSE) © Marc-Antoine Favreau
