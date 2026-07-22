# 0001 — Preview audio via the `trackPreview` GraphQL operation

**Status:** Accepted
**Date:** 2026-07-22
**Context spec:** [`docs/specs/2026-07-22-track-playlist-preview-design.md`](../specs/2026-07-22-track-playlist-preview-design.md)

## Context

Spotify removed the per-track preview button from playlist and Liked Songs views around mid-2026.
This extension restores it and extends it to whole collections.

The obvious implementation — and the one the original handoff plan specified — is to drive Spotify's
own player: snapshot the current playback state, call `Spicetify.Player.playUri()` on the target
track, wait ~15s, then restore the snapshot. A prototype did exactly this.

While investigating enumeration APIs against the live client (Spotify `1.2.92.147`,
Spicetify `2.44.0`), we found that `Spicetify.GraphQL.Definitions` contains an undocumented
`trackPreview` operation. Called with a `uris` array it returns preview-clip URLs:

```js
await Spicetify.GraphQL.Request(
  Spicetify.GraphQL.Definitions.trackPreview,
  { uris: ["spotify:track:0QnjcR3CzjZAibq74RW02x"] }
);
// → data.lookup[].data.previews.audioPreviewsV2.items[].url
```

Measured: 343 URIs accepted in one 445 ms request; 403/403 tracks across two playlists returned a
clip; each URL serves HTTP 200, CORS-enabled, `audio/mpeg`, ~23 s, and plays in a bare `<Audio>`
element with no authentication.

## Decision

All preview audio is produced by an HTML5 `<Audio>` element fed from `trackPreview` clip URLs.
Spotify's player is never used to produce preview audio. It is touched only to `pause()` when a
preview session starts and `resume()` when it ends — never `seek`, `playUri`, or any context change.

The `trackPreview` definition is read from `Spicetify.GraphQL.Definitions` at runtime. Its
`sha256Hash` is never copied into our source.

## Alternatives considered

**Drive `Spicetify.Player` (the original plan).** Rejected. It writes every previewed track into
listening history — unacceptable when previewing a 397-track playlist. It requires Premium for
reliable arbitrary `playUri()`. And restoring state correctly is genuinely hard: the prototype got
it wrong twice, reading a non-existent `Player.data.position` (so it always restored to 0:00) and
restoring a bare track URI (which discards playback context and a 50-item queue).

**Hybrid — clips where available, real playback otherwise.** Rejected for v1. Measured clip coverage
was 403/403, so the fallback would carry the entire fragile restore state machine for a path that
did not occur once in testing. Retained as a deferred, opt-in item.

**Spotify Web API `preview_url`.** Rejected. Deprecated for new applications in November 2024, and
it would require separate OAuth credentials — whereas `Spicetify.GraphQL` rides the client's
existing session.

## Consequences

**Positive.** No listening-history pollution. No Premium requirement. No snapshot/restore state
machine at all — the largest source of defects in the prototype disappears rather than being fixed.
The user's playback context, queue and position are structurally untouchable, because the only
player calls in the codebase are `pause` and `resume`. Batch resolution makes a whole playlist's
clips available in one sub-second request.

**Negative.** The feature rests on an undocumented internal operation that Spotify may change or
remove without notice; there is no contract and no deprecation channel. Preview clips are Spotify's
own ~23–30s edit, so we cannot preview an arbitrary offset within a track, and clip length varies.
Tracks without a clip — local files, podcast episodes, some region-restricted tracks — cannot be
previewed at all and are skipped.

**Mitigation.** Reading the definition from `Spicetify.GraphQL.Definitions` at runtime means a
rotated `sha256Hash` self-heals on the next Spicetify update, so only outright removal of the
operation breaks us. If that happens the fallback is the deferred full-playback path, and the
failure is loud: `previewSource` aborts the session with an explicit "Spotify API error" message
rather than degrading silently.

## Reversal cost

High. The engine, its ports and its entire error model are built around clip URLs and an `<Audio>`
element. Reverting to player-driven preview means rebuilding the audio path and writing the correct
snapshot/restore logic that this decision let us delete.
