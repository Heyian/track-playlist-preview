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

Source: `~/.config/spicetify/store/stdlib/1.13.0/src/registers/index.js`, `src/storage.js`; CDP
probe of `(await import("/modules/stdlib/mod.js")).React`.

## Settings page

- stdlib serves the **Spicetify Settings** page at `/bespoke/settings` (`SPICETIFY_SETTINGS_ROUTE`):
  registered `settingsSection` items, then the CORS proxy section, then `settingsAction` items.
  The `manager` module adds the profile-menu item **Spicetify Settings** that opens it.
- First-party guidance: module-wide settings belong on this page (`settingsSection`, or
  `settingsRow` for a single setting), built from stdlib's `SettingsSection` / `Settings*Row`
  components. The profile menu is for account actions, not module settings.

Source: stdlib `src/registers/settingsSection.js`; manager `index.js`; `spicetify/modules`
`BEST_PRACTICES.md` § "Put settings where their effect is clear", `docs/module-standard.md`.

## Client and devtools

- Spotify's desktop client is CEF (Chromium Embedded Framework), not Electron.
- `spicetify dev` enables developer mode ("app-developer mode in offline.bnk"); Spotify then serves
  the DevTools Protocol on `127.0.0.1:8088`. v2's `always_enable_devtools` config key does not
  apply.

Source: `/opt/spotify/libcef.so`; `spicetify dev --help`; the CLI binary's strings.
