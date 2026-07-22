// Entry point for the Track & Playlist Preview extension.
//
// The bundle is already wrapped in a wait-for-Spicetify loop by build.ts, so by
// the time this runs `Spicetify.React`, `Spicetify.ReactDOM` and
// `Spicetify.Platform` exist. Anything else — Playbar, ContextMenu, GraphQL —
// still needs checking before use.
//
// See docs/specs/2026-07-22-track-playlist-preview-design.md for the design.

async function main(): Promise<void> {
  // Entry points, engine and UI are wired up here. See the design spec.
}

void main();
