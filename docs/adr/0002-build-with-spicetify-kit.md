# 0002 — Build with spicetify-kit

**Status:** Accepted
**Date:** 2026-09-28
**Context spec:** [`docs/specs/2026-09-28-store-publishing-design.md`](../specs/2026-09-28-store-publishing-design.md)

## Context

Until now the module was built by a local Bun script, `build.ts`, that bundled `src/index.ts`,
aliased `react` / `react-dom` to `Spicetify.React` / `Spicetify.ReactDOM`, collected CSS imported
from TypeScript into `index.css`, and generated `metadata.json` from `package.json`. That replaced
`spicetify-creator` before any feature code existed (see the
[original design spec](../specs/2026-07-22-track-playlist-preview-design.md)).

Issue #3 asks for store distribution. The Spicetify v3 module store accepts a zip only if its root
holds `spicetify-module.json`, the sidecar that `spicetify-kit build` writes. The validator checks
only that the file exists, but the store docs say the artifact must be "produced by the toolchain
rather than assembled by hand". A probe with `@spicetify/kit` 0.3.1 built this repo with small
changes: CSS moves from TS imports to `src/index.scss`, and React resolves through stdlib's
`react-shim.js`.

## Decision

`spicetify-kit build src` builds the module for development and for release. `build.ts` is a thin
wrapper: it runs kit into `.kit-build/`, then copies the versioned output into the Spicetify
`modules` folder (`bun run build`, `bun run watch`) or `dist/` (`bun run build:local`, the folder
the release zips). `src/metadata.json` is the only source of module metadata. `@spicetify/kit` is
pinned exactly, because it is 0.x.

## Alternatives considered

**Keep the Bun bundler and write the sidecar by hand.** Rejected. It fakes the marker that tells
store reviewers the artifact came from the toolchain, and it leaves us maintaining a bundler that
diverges from what the rest of the ecosystem ships.

**Bun for development, kit for release.** Rejected. Two bundlers mean the bytes tested during
development are not the bytes released: React resolution, CSS handling and minification all differ
between them.

## Consequences

**Positive.** Development and release ship the same bytes. Kit's module-standard check runs on every
build and fails on an error-tier finding. The React alias plugin and the metadata generator are gone.

**Negative.** Kit needs Node ≥ 22 and must run under Node: under Bun its sass compiler fails with
`Invalid protobuf`. Contributors need Node as well as Bun, and CI sets up both. The output is
unminified (about 53 KB plus a sourcemap). Kit rewrites `src/classmap.d.ts` on every build, so the
file is git-ignored and the watcher ignores it. Kit 0.x may change behaviour between releases, hence
the exact pin.

## Reversal cost

Medium. Going back means restoring the Bun plugin and metadata generator, moving styles back to TS
imports, and producing the store sidecar some other way.
