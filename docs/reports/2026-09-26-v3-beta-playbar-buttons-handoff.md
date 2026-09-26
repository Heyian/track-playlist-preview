# Handoff — v3-beta branch + missing playbar Skip/Stop buttons under Spicetify v3

Written 2026-09-26 from a session in `~/DEV/pkgs/spicetify-cli` (the AUR package
`spicetify-cli-beta-bin`). Execute from `~/DEV/track-playlist-preview`.

## Goal

1. Create a `v3-beta` branch for Spicetify v3 support.
2. Fix: under Spicetify v3, the Playbar **Skip preview** / **Stop preview** buttons never appear
   when a preview session starts. Everything else tested works: previews start on playlists and on
   single tracks.
3. Port the build to v3's module layout (see "Other v3-beta work").

## Step 1 — create the branch

The implementation is **not on `main`**. `main` (7e4e4ca) holds only the scaffold. The deployed code
lives on `worktree-track-playlist-preview-impl`, checked out in the worktree
`.claude/worktrees/track-playlist-preview-impl`:

- Local HEAD is `080c8ef` ("Add preview-modal design spec"), 1 commit ahead of `origin` (`aa21068`).
- That worktree also has uncommitted edits to `docs/specs/2026-07-25-preview-modal-design.md` and
  an untracked `docs/superpowers/`. This is in-progress preview-modal work. Leave it alone.

Branch from the committed impl HEAD, in its own worktree, so neither the main checkout's untracked
files nor the modal WIP get involved:

```sh
cd ~/DEV/track-playlist-preview
git worktree add .claude/worktrees/v3-beta -b v3-beta worktree-track-playlist-preview-impl
```

Do **not** push until the user says to (`git push -u origin v3-beta`).

## Environment (as of this handoff)

- Spicetify CLI: `spicetify-cli-beta-bin` 3.0.0-beta.19 (AUR). This is the Rust rewrite. The v2
  `spicetify-cli` package was uninstalled.
- Spotify: 1.2.96.518 (`/opt/spotify`).
- Loaded modules: `stdlib@1.13.0`, `manager@1.4.0`, `store@1.7.8`, `track-playlist-preview@1.0.0`.
- The extension was deployed **by hand** as a v3 module. v3 ignores `~/.config/spicetify/Extensions/`:
  - `~/.config/spicetify/modules/track-playlist-preview/index.js` is a verbatim copy of the v2
    bundle `~/.config/spicetify/Extensions/track-playlist-preview.js`.
  - `~/.config/spicetify/modules/track-playlist-preview/metadata.json` has `version` `1.0.0` (a
    placeholder; `package.json` says `0.1.0`), `entries.js` `index.js`, `hasMixins` false, and no
    dependencies.
- CDP is live on `127.0.0.1:8088`. `node scripts/cdp-eval.mjs '<expr>'` works against v3
  (it's in the impl worktree).
- v3 module docs: `docs/v3-modules.md` at tag `v3.0.0-beta.19` of `spicetify/cli`.

## The bug — what has been verified

Under v3, `Spicetify.Playbar.Button` is **not** the v2 DOM-based class. stdlib replaces it with a
React compat shim. The live source was dumped via CDP with
`Spicetify.Playbar.Button.toString()`:

- `get element()` always returns `null`, and so does `get tippy()`.
- `register()` builds `jsx(Compat)` around stdlib's `PlaybarButton` and does
  `registry.add(node)`. It is idempotent via `this.node`. The constructor registers immediately,
  because `registerOnCreate` defaults to true.
- The registry and its render anchor live in stdlib:
  - `~/.config/spicetify/modules/stdlib/src/registers/playbarButton.js`: the registry.
    `add`/`delete` call `refresh?.()` and then mutate. The anchor is `.spicetify-playbar-buttons`,
    inserted as the first child of `.main-nowPlayingBar-extraControls`.
  - `.../src/registers/mount.js`: `mountRegistryAnchor` uses its own `createRoot(host)`. A body
    `MutationObserver` re-places the host if it gets detached.
  - The registry can be imported from CDP:
    `await import(location.origin + "/modules/stdlib/src/registers/playbarButton.js")` → `.default`
    (a `Set`).

**Replaying the extension's exact calls works in isolation.** The replay ran over CDP while Spotify
was **playing**. It ran `new Spicetify.Playbar.Button("Skip preview","skip-forward",…,false,false)`,
the same for `"Stop preview","x"`, and `.register()` on both. Result:

- Not in the DOM synchronously (async React render).
- After 2 s, both render as visible 32×32 `BUTTON`s inside
  `SPAN.spicetify-playbar-buttons > DIV.main-nowPlayingBar-extraControls > DIV.main-nowPlayingBar-right`.
- `deregister()` removes them.

So the API, the icons and the anchor all work. The failure is specific to the **real session
flow**, which has not been observed live yet.

Relevant code (impl branch):
- `src/ui/playbarControls.ts:13-25`: register/deregister. It calls the constructor (which
  registers) and then `.register()` again, which is a harmless no-op.
- `src/previewController.ts:51-52`: `beginSession` calls `coordinator.acquire()` (which **pauses
  Spotify**) *before* `playbar.register()`.
- `src/previewController.ts:32-34`: `sessionEnded` (any reason except `replaced`) calls
  `playbar.deregister()`.

## Hypotheses (untested, ranked)

1. **Pausing Spotify disturbs the anchor.** The only known difference from the working replay is
   that Spotify is paused first. If Spotify re-renders or swaps `.main-nowPlayingBar-extraControls`
   on pause, the host may be detached. It could also be re-placed into a stale node, or the
   `refresh` callback captured by `setRefresh` may belong to an unmounted `Wrapper`. Check
   `document.querySelector(".spicetify-playbar-buttons")?.isConnected` and the registry `size`
   during a session.
2. **The session deregisters right after registering.** Something emits `sessionEnded` early. That
   would also clear the row highlight, so compare with what the user sees.
3. **`ItemBoundary` caught a render crash.** stdlib renders a `⚠` span in place of a crashed item and
   logs `[stdlib] registered spicetify-playbar-buttons item crashed:`. The replay didn't crash, so
   this is less likely.

## Suggested next step — instrument, then have the user trigger a preview

Starting a preview pauses the user's music. **Ask the user to start one** instead of driving it
yourself. Install this over CDP first. It is non-destructive and lost on reload:

```js
(async () => {
  const reg = (await import(location.origin + "/modules/stdlib/src/registers/playbarButton.js")).default;
  const log = (globalThis.__tppLog = []);
  const B = Spicetify.Playbar.Button.prototype;
  for (const name of ["register", "deregister"]) {
    const orig = B[name];
    B[name] = function (...a) {
      log.push({ t: Date.now(), name, label: this._label, size: reg.size });
      return orig.apply(this, a);
    };
  }
  const origPause = Spicetify.Player.pause;
  Spicetify.Player.pause = function (...a) { log.push({ t: Date.now(), name: "Player.pause" }); return origPause.apply(this, a); };
  return "installed";
})()
```

Then read `JSON.stringify({ log: __tppLog, size: reg.size, anchor: document.querySelector(".spicetify-playbar-buttons")?.isConnected, labels: [...document.querySelectorAll(".spicetify-playbar-buttons [aria-label]")].map(e => e.getAttribute("aria-label")) })`.
Re-import `reg` in that expression.

**Probe hygiene:** always `deregister()` in a `finally`. The earlier session leaked two "probe"
buttons when a probe threw before cleanup. They were removed by importing the registry and deleting
the entries.

If the root cause is in stdlib (hypothesis 1), a workaround in this repo may still be possible, for
example registering before `coordinator.acquire()`. Report it upstream too
(spicetify stdlib / `spicetify/cli` `v3-beta`).

## Other v3-beta work (verified gaps)

- **`build.ts` is broken under v3.** `extensionsDir()` (`build.ts:45-52`) runs `spicetify -c`,
  which v3 rejects with `error: unexpected argument '-c' found`. v3 also only loads from
  `<config>/modules/<id>/`. The build should emit `index.js` plus a `metadata.json` generated from
  `package.json`, so the version stays in sync. `spicetify path` prints the config root, but as
  `INFO` log lines, so parsing it is fragile. Decide between that and the XDG default
  (`~/.config/spicetify`).
- **Module lifecycle (optional).** v3 imports `entries.js` as an ES module. The IIFE bundle works
  because top-level code runs on import. Exporting `load(ctx)`, and returning a dispose function
  that unregisters menus, observers and the style tag, would make
  `Spicetify.Modules.disable/reload("track-playlist-preview")` clean.
- **Types:** `src/types/spicetify.d.ts` (`namespace Playbar`, ~line 1887) describes v2. Under v3
  `.element`/`.tippy` are `null`. Nothing in `src/` uses them today; keep it that way.
- **CLAUDE.md:** add the v3 build target, `spicetify apply`, `Spicetify.Modules.report`, and the
  registry-import debugging trick.

## Useful commands

```sh
node scripts/cdp-eval.mjs 'JSON.stringify(Spicetify.Modules.report)'
node scripts/cdp-eval.mjs 'JSON.stringify(Spicetify.Modules.list())'
node scripts/cdp-eval.mjs 'Spicetify.Modules.reload("track-playlist-preview")'
spicetify apply        # after changing files under ~/.config/spicetify/modules/
```
