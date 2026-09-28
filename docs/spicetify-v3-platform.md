# Spicetify v3 platform notes

Verified facts about how the Spicetify v3 CLI, module loader and stdlib behave. Each section names
the version it was checked against and the source that proves it. When the installed version is
newer (`spicetify --version`, `Spicetify.Modules.list()`), re-read the cited source before relying on
the fact, then update the section.

Last full check: 2026-09-27 — CLI 3.0.0-beta.19, stdlib 1.13.0, manager 1.4.0, Spotify 1.2.96.518.

## Installing stdlib and other system modules

- Every `spicetify apply` installs **stdlib**, **store** and **manager** when missing and updates
  them to the registry's latest when outdated. No manual install step exists for stdlib.
- Best-effort: with the registry unreachable, apply warns and continues. A system module the user
  disabled while installed stays off.
- Apply never reads a module's `metadata.json` `dependencies`; it does not install dependencies.

Source: `spicetify/cli` `rust/crates/spicetify/src/commands/apply.rs` (`stage_modules` calls
`pkg::ensure_system_modules`) and `commands/pkg.rs` (`SYSTEM_MODULES`, `ensure_system_modules`).

## Declared dependencies

- The loader enforces `dependencies` at boot. A missing dependency fails the module with
  "`<id> needs <dep>, which is not installed`"; a version outside the range fails with
  "`<id> needs <dep>@<range>, installed is <v>`". Both appear in
  `Spicetify.Modules.report.failed`.
- Modules load in dependency order (topological), so a declared dependency is loaded first.

Source: `spicetify/cli` `src/jsHelper/modularLoader/registry.ts` (`checkDependencies`, `topoOrder`).

## Module entry and readiness

- `entries.js` is an ES module exporting any of `mixin(transformer, ctx)`, `preload(ctx)`,
  `load(ctx)`. `preload`/`load` may return a dispose function. A bundle with no exports still runs
  as a side effect of import, but never receives `ctx`.
- Before `load`, the loader waits up to 15 s for `main` and `Spicetify.Platform`, then for
  `Spicetify.Events.webpackLoaded` (React, ReactDOM, GraphQL definitions). **On timeout it runs
  `load()` anyway** and logs "client did not come up in time; running module loads anyway".
- `Spicetify.URI` is completed by a separate retry loop the loader does not await.
  `Spicetify.LocalStorage` and `Spicetify.SVGIcons` are set synchronously, before any of this.
- The loader awaits `load()`; an unbounded wait inside it blocks every later module. Cap waits.
- An ES-module `index.js` whose only export is `load` loads cleanly, and its top-level code runs
  once at import. When a module is evaluated, `Spicetify.React` is already set: a bundle that reads
  it at top level (Bun's `react` → `Spicetify.React` alias does) loads and renders.
  Verified 2026-09-27 over CDP: `Modules.report.loaded` lists `stdlib` then
  `track-playlist-preview`, and `failed` is empty. (The stylesheet now ships as `entries.css`; see
  "Unload, enable and reload".)
- Bun's bundler, with `format: "esm"` and `external: ["/modules/stdlib/*"]`, leaves both stdlib
  import specifiers verbatim in the output (no plugin needed).

Source: `spicetify/cli` `docs/v3-modules.md`; `src/jsHelper/modularLoader/index.ts`
(`waitForClient`); `src/jsHelper/spicetifyWrapper/webpack/uri.js` (`waitForURI`);
`spicetify/modules` `docs/authoring-guide.md` § "The module entry".

## stdlib surface

- Public import paths: `/modules/stdlib/mod.js` and `/modules/stdlib/lib/primitives.js`. Imports of
  `stdlib/src/*` are private.
- `createRegistrar(ctx)` returns a registrar that removes everything registered through it when the
  module unloads. `registers` itself is not exported.
- stdlib's `React` export is a proxy over the client's React: `createElement` and `useState` are
  identical to `Spicetify.React`'s. Using both does not load a second React.
- `createStorage(ctx)` prefixes keys as `module:<identifier>:<key>`.
- `Spicetify.Modules.disable(id)` disposes that module's registrar: its settings section is gone
  from the Settings page right away (verified over CDP, 2026-09-27).
- TypeScript never matches `declare module "/modules/stdlib/mod.js"`, because it treats a name that
  starts with `/` as a relative path. Declare `"*/modules/stdlib/mod.js"` instead.

Source: `~/.config/spicetify/store/stdlib/1.13.0/src/registers/index.js`, `src/storage.js`; CDP
probe of `(await import("/modules/stdlib/mod.js")).React`.

## Settings page

- stdlib serves the **Spicetify Settings** page at `/bespoke/settings` (`SPICETIFY_SETTINGS_ROUTE`):
  registered `settingsSection` items, then the CORS proxy section, then `settingsAction` items.
  The `manager` module adds the profile-menu item **Spicetify Settings** that opens it. The item
  is hidden while that page is already open.
- First-party guidance: module-wide settings belong on this page (`settingsSection`, or
  `settingsRow` for a single setting), built from stdlib's `SettingsSection` / `Settings*Row`
  components. The profile menu is for account actions, not module settings.

Source: stdlib `src/registers/settingsSection.js`; manager `index.js`; `spicetify/modules`
`BEST_PRACTICES.md` § "Put settings where their effect is clear", `docs/module-standard.md`.

## Unload, enable and reload

- **Disposers.** Each module has one disposer list, which `unload()` runs in **reverse order** of
  registration. Each disposer is awaited inside its own `try/catch`: a failure is logged
  ("error unloading …") and the rest still run. Registration order: preload's `ctx.defer`s,
  preload's return value, the `entries.css` disposer, the `color.ini` disposer, load's `ctx.defer`s,
  load's return value. `Spicetify.Modules.disable(id)` and `unload(id)` run them; `reload(id)` is
  unload then enable (the `manager` module's Reload button calls it). Quitting Spotify runs none.
- **Enable does not re-import.** The loader caches the imported module namespace; `enable()` runs
  `preload`/`load` again on the cached object. Top-level code runs once per page, so module-scope
  state and top-level DOM side effects survive disable → enable. Only `Modules.installLocal`
  re-imports new code; an on-disk module picks up new code only after `spicetify apply`.
- **Partial load leaks.** If `load()` throws, the disposers it already registered never run:
  `enable` leaves `loaded=false`, and `unload()` returns early when the module is not loaded. A
  module must undo its own partial work before re-throwing.
- **`entries.css`.** `metadata.json` `entries: { js?, css? }`; both may be set. The loader fetches
  `/modules/<id>/<css>`, builds a constructable `CSSStyleSheet` (plain-text fallback when it holds
  `@import`), pushes it onto `document.adoptedStyleSheets` between preload and load, and registers
  a disposer that removes it. It is re-adopted on every enable. A module with CSS also triggers a
  fetch of `/modules/<id>/color.ini`; a 404 is harmless.
- **`Spicetify.ContextMenu.Item`** comes from the CLI's spicetifyWrapper (`menus.js`), not stdlib.
  `deregister()` calls `Spicetify.ContextMenuV2.unregisterItem`, which `Item` looks up on the
  global at call time. Items render from a private map on each menu render, so a deregistered item
  is gone from the next menu opened; a menu already open is not re-rendered and keeps showing it.
- **`Spicetify.Platform.History.listen`** returns an unlisten function (history v4 `appendListener`).
- stdlib's registrar has no context-menu type with URI access: its `menu` type receives
  `props: null` in the live client, so `ContextMenu.Item` stays.
- **`ctx`** is `{ spotifyVersion, identifier, defer }`; `defer` accepts a function returning
  `void | Promise<void>`.
- Verified 2026-09-27 over CDP: `Spicetify.ReactDOM.createRoot(host).render(…)` then
  `root.unmount()` leaves `host` with no children, and a second `createRoot` on a fresh host
  renders (spike s1). After the `entries.css` build and `spicetify apply`, exactly one adopted
  sheet mentions `.tpp-panel`, no `<style>` does, and `Modules.report.failed` is empty (spike s2).
  `node scripts/check-unload.mjs` checks the whole disable → enable cycle live.

Source: `/opt/spotify/Apps/xpui/hooks/modularLoader.js`, matching `spicetify/cli` branch `v3-beta`
`src/jsHelper/modularLoader/{index,registry,types}.ts` (commit b50800b; `registry.ts` l.294-318,
l.398-417, l.470-489); installed `/opt/spotify/Apps/xpui/hooks/spicetifyWrapper.js` (`ContextMenu.Item`); CDP probes; `spicetify/modules`
`docs/module-standard.md` § "Dispose what you touch".

## Client and devtools

- Spotify's desktop client is CEF (Chromium Embedded Framework), not Electron.
- `spicetify dev` enables developer mode ("app-developer mode in offline.bnk"); Spotify then serves
  the DevTools Protocol on `127.0.0.1:8088`. v2's `always_enable_devtools` config key does not
  apply.
- On 2026-09-27, `spicetify apply` followed by `spicetify dev` left nothing listening on 8088.
  Setting `spotify_launch_flags = --remote-debugging-port=8088` in
  `~/.config/spicetify/config-xpui.ini` and re-running `spicetify apply` brought CDP up.

Source: `/opt/spotify/libcef.so`; `spicetify dev --help`; the CLI binary's strings.
