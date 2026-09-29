# Store Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the module with spicetify-kit, cut releases with release-please, and publish each
release to the Spicetify v3 module store (issue #3).

**Architecture:** `build.ts` becomes a thin CLI over `scripts/kitBuild.ts`. That module runs
`spicetify-kit build src --out .kit-build` under Node and copies the versioned output into the
install target. `scripts/checkDist.ts` asserts the built folder's shape; CI and the publish job run
it. `src/metadata.json` is the one source of module metadata. Two workflows: `ci.yml` (check +
build on PRs and `main`) and `release.yml` (release-please, then `publish` via
`spicetify/actions/publish@v1`).

**Tech Stack:** TypeScript (strict), Bun (scripts, installs), Node ≥ 22 (runs kit), `@spicetify/kit`
0.3.1 (rolldown + sass), Vitest, release-please, GitHub Actions.

**Spec:** `docs/specs/2026-09-28-store-publishing-design.md` (criteria M1–M25). Read
**Investigation Findings**, **Design** and **Manual Operator Steps** first.

## Global Constraints

- Quality gate: `bun run check` (typecheck + vitest). No linter.
- **Kit runs under Node, never Bun.** Verified at planning time: `bun …/spicetify-kit.js build`
  fails every time with `Compiler caused error: Invalid protobuf: Error: illegal tag: field no 0
  wire type 0.` (sass), while `node …/spicetify-kit.js build` exits 0. Kit's `engines` is
  `node >=22`. CI must set up Node 22.
- Kit invocation: `node node_modules/@spicetify/kit/bin/spicetify-kit.js build src --out .kit-build`.
  No `--classmap`, no `--refresh`, no `--no-check`. Output: `.kit-build/track-playlist-preview@<version>/`
  holding `index.js`, `index.js.map`, `index.css`, `metadata.json`, `spicetify-module.json`.
  Kit exits 1 on an error-tier finding (verified: deleting `authors` from `src/metadata.json`).
  Kit rewrites `src/classmap.d.ts` on every build.
- Built `index.js` imports `"/modules/stdlib/src/expose/react-shim.js"` (verified).
- Built `index.css` is compressed and comment-free; row-highlight starts with `.tpp-previewing-row`,
  preview-panel with `#tpp-preview-root`.
- `src/metadata.json` exact content is in spec D1. No `tags`, no `kind`.
- `@spicetify/kit` pinned exactly: `bun add -d -E @spicetify/kit@0.3.1`.
- Action majors verified 2026-09-28 (`gh api repos/<o>/<r>/releases`): `actions/checkout@v7`
  (7.0.1), `actions/setup-node@v7` (7.0.0), `oven-sh/setup-bun@v2`,
  `googleapis/release-please-action@v5`, `spicetify/actions/publish@v1`. Re-run the check at
  implementation and read the release notes of checkout v7, setup-node v7 and release-please-action
  v5 before pinning.
- `bootstrap-sha`: `git merge-base main HEAD` at implementation (`4053a3af8a8c8995a85de6e6f3724a8b3db43b65`
  at planning time).
- **Commits use Conventional Commit prefixes** (`feat:`, `fix:`, `docs:`, `chore:`, `test:`,
  `refactor:`, `ci:`, `build:`). Exactly one commit on this branch carries the footer
  `Release-As: 0.1.0` (Task 5). No AI-attribution lines.
- `spicetify apply` force-restarts Spotify: ask the user before running it.

## Review Focus

1. **Store-installed copy under the dev build.** After `spicetify pkg enable`, `<modules>/track-playlist-preview`
   is a link into `<config>/store/…`. `bun run build` must replace the link with a real folder and
   leave the store copy untouched — never delete through the link. Test in Task 2.
2. **Watch feedback loop.** Kit rewrites `src/classmap.d.ts` on each build; a watcher on `src/`
   that reacts to it rebuilds forever. `shouldRebuild` ignores it. Test in Task 2.
3. **Kit fails after an earlier success.** A failed kit run must install nothing, so a stale
   `.kit-build` from a previous run never reaches `<modules>` or `dist/`. Test in Task 2.
4. **Tag/version drift in publish.** `v0.1.1` against metadata `0.1.0`, or a tag without the `v`,
   must fail before anything is uploaded (M13). Test in Task 1.
5. **Kit under Bun.** Spawning kit with Bun's `process.execPath` fails (sass). The default command
   must start with `node`. Test in Task 2.

---

### Task 0: Workspace and live client

- [ ] **Step 1:** If the session is not already isolated, create an isolated workspace via
  `superpowers:using-git-worktrees` on branch `store-publishing`.
- [ ] **Step 2:** Per CLAUDE.md "Starting a feature": ensure `~/.config/spicetify/config-xpui.ini`
  has `spotify_launch_flags = --remote-debugging-port=8088` under `[Setting]`, ask the user, run
  `spicetify apply`. Expected: `curl -s 127.0.0.1:8088/json/version` prints JSON.
- [ ] **Step 3:** Confirm `node --version` is ≥ 22.

### Task 1: Dist checker (`scripts/checkDist.ts`)

Covers M1, M2, M4 (built order), M13 (tag), M23.

**Files:**
- Create: `scripts/checkDist.ts`, `scripts/checkDist.test.ts`
- Modify: `tsconfig.json` (`include` gains `"scripts/**/*.ts"`), `package.json` (script
  `"check:dist": "bun scripts/checkDist.ts"`)

**Interfaces:**
- Produces: `checkDist(dir: string, source: Record<string, unknown>, tag?: string): string[]` —
  returns human-readable problems, empty when the folder passes. CLI: `bun scripts/checkDist.ts
  [--tag <tag>]` checks `dist/track-playlist-preview@<src/metadata.json version>/` against
  `src/metadata.json`, prints each problem, exits 1 if any.

- [ ] **Step 1: Write the failing tests** in `scripts/checkDist.test.ts`. Each builds a fixture
  folder `track-playlist-preview@0.1.0/` in `mkdtemp(os.tmpdir())` with: `index.js` containing
  `import React from "/modules/stdlib/src/expose/react-shim.js";`, `index.js.map`, `index.css` =
  `.tpp-previewing-row{}#tpp-preview-root{}`, `metadata.json` = the source object,
  `spicetify-module.json` = `{}`.
  - `passes a well-formed folder` → `[]`
  - `reports each missing file` — delete `index.js.map` → one problem naming `index.js.map`
  - `reports metadata that differs from the source` — built `version` `"0.1.1"` → non-empty
  - `reports a folder name that does not match name@version` — folder `track-playlist-preview` → non-empty
  - `reports css with the panel rules before the row rules` — `#tpp-preview-root{}.tpp-previewing-row{}` → non-empty
  - `reports css missing either rule set` → non-empty
  - `reports index.js without the react-shim import` → non-empty
  - `accepts a matching tag` — `tag = "v0.1.0"` → `[]`
  - `rejects a mismatched tag` — `"v0.1.1"` and `"0.1.0"` → each non-empty
- [ ] **Step 2:** `bun run test scripts/checkDist.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `checkDist` with `node:fs` only (vitest runs under Node). Metadata
  comparison: `node:util` `isDeepStrictEqual` on parsed JSON. CSS order: `indexOf(".tpp-previewing-row")`
  < `indexOf("#tpp-preview-root")`, both ≥ 0. CLI block guarded by `import.meta.main`.
- [ ] **Step 4:** `bun run check` → PASS.
- [ ] **Step 5:** Commit `test: add a checker for the built module folder`.

### Task 2: Kit build helpers (`scripts/kitBuild.ts`)

Covers M5, M6, M22 logic; Review Focus 1, 2, 3, 5.

**Files:**
- Create: `scripts/kitBuild.ts`, `scripts/kitBuild.test.ts`

**Interfaces:**
- Produces:
  - `NAME = "track-playlist-preview"`, `SCRATCH = ".kit-build"`
  - `kitCommand(outDir: string): string[]` → `["node", "node_modules/@spicetify/kit/bin/spicetify-kit.js", "build", "src", "--out", outDir]`
  - `runKit(command: string[]): Promise<void>` — spawns with inherited stdio; rejects
    `Error("spicetify-kit exited with code <n>")` on non-zero.
  - `installModule(builtDir: string, dest: string): Promise<void>` — if `dest` is a symlink
    (`lstat`), `unlink` it; otherwise `rm -rf` it; then `cp` `builtDir` recursively to `dest`.
  - `buildModule(opts: { run: () => Promise<void>; version: string; dest: string; scratch?: string }): Promise<void>` —
    `scratch` defaults to `SCRATCH`; `rm -rf scratch`, `await run()`, then
    `installModule(join(scratch, NAME + "@" + version), dest)`.
  - `shouldRebuild(filename: string | null): boolean` — `false` when the basename is
    `classmap.d.ts`, else `true` (including `null`).
  - `modulesDir(): Promise<string>` — moved from `build.ts` unchanged in behaviour (`spicetify path`
    parse, XDG fallback), rewritten with `node:child_process` instead of `Bun.spawn`.

- [ ] **Step 1: Write the failing tests** (temp dirs via `mkdtemp`):
  - `installModule copies bytes exactly` — compare every file's `Buffer` in dest with source.
  - `installModule removes files from an earlier build` — dest pre-seeded with `old.js` → gone.
  - `installModule replaces a symlinked dest without touching its target` — dest is a symlink to
    `store/0.1.0/` holding `index.js` = `"store"`; after install dest is a real directory
    (`lstat().isSymbolicLink() === false`) and `store/0.1.0/index.js` still reads `"store"`.
  - `buildModule installs nothing when kit fails` — dest seeded with `keep.js`, `run` rejects →
    promise rejects and `keep.js` still exists, even with a stale
    `<scratch>/track-playlist-preview@0.1.0/` present from an earlier run (pass a temp `scratch`).
  - `runKit rejects on a non-zero exit` — `runKit(["node", "-e", "process.exit(3)"])` rejects with
    `"spicetify-kit exited with code 3"`; `["node", "-e", ""]` resolves.
  - `kitCommand runs kit under node` — `kitCommand("x")[0] === "node"` and ends with `["--out", "x"]`.
  - `shouldRebuild ignores the classmap` — `"classmap.d.ts"` → false, `"ui/previewPanel.tsx"` →
    true, `null` → true.
- [ ] **Step 2:** `bun run test scripts/kitBuild.test.ts` → FAIL.
- [ ] **Step 3:** Implement with `node:fs/promises` (`lstat`, `unlink`, `rm`, `cp` with
  `recursive: true`) and `node:child_process` `spawn`.
- [ ] **Step 4:** `bun run check` → PASS.
- [ ] **Step 5:** Commit `build: add spicetify-kit build helpers`.

### Task 3: Switch the build to kit

Covers M1–M6, M23. Config files: `package.json`, `bun.lock`, `build.ts`, `src/metadata.json`,
`src/index.scss`, `.gitignore`, `tsconfig.json` (verify only).

**Files:**
- Create: `src/metadata.json` (spec D1, verbatim), `src/index.scss`, `src/metadata.test.ts`
- Modify: `build.ts` (rewrite), `package.json`, `bun.lock`, `.gitignore`,
  `src/ui/rowHighlight.ts:4`, `src/ui/previewPanel.tsx:15`, header comments of
  `src/ui/rowHighlight.css` and `src/ui/previewPanel.css`

**Interfaces:**
- Consumes: Task 2's `kitCommand`, `runKit`, `buildModule`, `shouldRebuild`, `modulesDir`, `NAME`;
  Task 1's `check:dist` script.

- [ ] **Step 1: Write the failing test** `src/metadata.test.ts` (M3, M4 source side):
  - `metadata carries the store fields` — deep-equal on each M3 field with the spec's exact values
    (`name`, `description`, `hasMixins: false`, `preview` URL, `repository`, `license: "MIT"`,
    `authors`, `dependencies.stdlib: "^1.13.0"`, `entries`); `version === pkg.version`;
    `!("tags" in meta) && !("kind" in meta)`.
  - `package.json has no spicetify key and pins kit` — `!("spicetify" in pkg)`,
    `pkg.devDependencies["@spicetify/kit"] === "0.3.1"`.
  - `no source file imports css` — walk `src/` for `.ts`/`.tsx`; none matches
    `/import\s+["'][^"']+\.css["']/`.
  - `index.scss uses row highlight before the panel` — file content equals
    `@use "ui/rowHighlight";\n@use "ui/previewPanel";\n`.
- [ ] **Step 2:** `bun run test src/metadata.test.ts` → FAIL.
- [ ] **Step 3:** `bun add -d -E @spicetify/kit@0.3.1`; delete the `spicetify` block from
  `package.json`; create `src/metadata.json` and `src/index.scss`; delete the two CSS imports; update
  both CSS headers to say the file is compiled from `src/index.scss` by spicetify-kit; append
  `src/classmap.d.ts` and `.kit-build/` to `.gitignore`, and remove `.bun-build/`.
- [ ] **Step 4:** Rewrite `build.ts` as a CLI over Task 2: read `version` from `src/metadata.json`
  per build; target `dist/track-playlist-preview@<version>` with `--local`, else
  `join(await modulesDir(), NAME)`; `--watch` watches `src` recursively, filters with
  `shouldRebuild`, debounces 50 ms as today, and logs failures without exiting. Keep the scripts'
  names; drop `--minify`. Rewrite the header comment for the kit flow.
- [ ] **Step 5:** `bun run check` → PASS (includes `tsc` over `src/classmap.d.ts`).
- [ ] **Step 6:** `bun run build:local && bun run check:dist` → exit 0, no problems (M1, M2, M4,
  M6, M23). Then `ls dist/track-playlist-preview@0.1.0/` lists the five files.
- [ ] **Step 7:** M6 negative: temporarily delete `authors` from `src/metadata.json`,
  `bun run build:local` → non-zero with `error-tier finding`; restore the file.
- [ ] **Step 8:** `grep -rE 'e-[0-9]' src/` → no output (M8).
- [ ] **Step 9:** Commit `build: build the module with spicetify-kit`.

### Task 4: Live-client acceptance

Covers M5, M7, M22. No commit unless a fix is needed.

- [ ] **Step 1:** `bun run build`, then `diff -r dist/track-playlist-preview@0.1.0 <modules>/track-playlist-preview`
  → no output, and `ls <modules>` shows no `track-playlist-preview@*` (M5). `<modules>` is the path
  `spicetify path` prints.
- [ ] **Step 2:** Ask the user, then `spicetify apply`. Check M7:
  `node scripts/cdp-eval.mjs 'JSON.stringify(Spicetify.Modules.report)'` lists
  `track-playlist-preview` loaded at `0.1.0`; ask the user to start a Liked Songs preview and confirm
  the panel shows artwork and controls, and that the Settings page shows the section;
  `node scripts/check-unload.mjs` → passes.
- [ ] **Step 3:** M22: start `bun run watch` in the background, append a comment line to
  `src/ui/notifications.ts`, wait for the rebuild log, then `diff -r` as in Step 1 against a fresh
  `bun run build:local` → no output. Confirm the log shows one rebuild, not a loop. Revert the
  comment and stop the watcher.

### Task 5: release-please configuration

Covers M9, M10, M24 (config side). Config files: `release-please-config.json`,
`.release-please-manifest.json`.

**Files:**
- Create: `release-please-config.json`, `.release-please-manifest.json`, `scripts/releaseConfig.test.ts`

- [ ] **Step 1: Write the failing test** `scripts/releaseConfig.test.ts`:
  - `packages["."]` has `release-type: "node"`, `bump-minor-pre-major: true`, and `extra-files`
    deep-equal `[{ type: "json", path: "src/metadata.json", jsonpath: "$.version" }]`;
  - `bootstrap-sha` matches `/^[0-9a-f]{40}$/`;
  - manifest deep-equals `{ ".": "0.0.0" }`.
- [ ] **Step 2:** `bun run test scripts/releaseConfig.test.ts` → FAIL.
- [ ] **Step 3:** Write both files; `bootstrap-sha` = `git merge-base main HEAD`; include the
  `$schema` `https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json`.
- [ ] **Step 4:** `bun run check` → PASS.
- [ ] **Step 5:** Commit with the release footer:

  ```bash
  git commit -m "chore: configure release-please" -m "Release-As: 0.1.0"
  ```

  Confirm with `git log -1 --format=%B` that the footer is the last paragraph.

### Task 6: CI workflow

Covers M18, M19 (ci side). Config file: `.github/workflows/ci.yml`.

- [ ] **Step 1:** Re-verify majors and read the release notes (Global Constraints).
- [ ] **Step 2:** Write `ci.yml`: `on: pull_request` and `push: branches: [main]`; top-level
  `permissions: contents: read`; one job on `ubuntu-latest`: checkout → setup-node
  (`node-version: 22`) → setup-bun → `bun install --frozen-lockfile` → `bun run check` →
  `bun run build:local` → `bun run check:dist`.
- [ ] **Step 3:** Validate syntax:
  `python3 -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))' .github/workflows/ci.yml` → no error.
- [ ] **Step 4:** Commit `ci: run the check and build on PRs and main`.

### Task 7: Release workflow

Covers M11–M16, M19 (release side). Config file: `.github/workflows/release.yml`.

- [ ] **Step 1:** Write `release.yml`, `on: push: branches: [main]`, no top-level permissions:
  - job `release-please`: `permissions: { contents: write, pull-requests: write }`;
    `googleapis/release-please-action@v5` with `config-file: release-please-config.json`,
    `manifest-file: .release-please-manifest.json`; job outputs `release_created` and `tag_name`
    from the step's outputs.
  - job `publish`: `needs: release-please`, `if: needs.release-please.outputs.release_created == 'true'`,
    `permissions: { contents: write }`. Steps: checkout with `ref: ${{ needs.release-please.outputs.tag_name }}`
    → setup-node 22 → setup-bun → `bun install --frozen-lockfile` → `bun run check` →
    `bun run build:local` → `bun run check:dist --tag "$TAG"` (with `TAG` from env, M13) → a step
    `id: version` writing `version=$(node -p "require('./src/metadata.json').version")` to
    `$GITHUB_OUTPUT` → `spicetify/actions/publish@v1` (`id: publish`) with
    `dist: dist/track-playlist-preview@${{ steps.version.outputs.version }}`,
    `release-tag: ${{ needs.release-please.outputs.tag_name }}`,
    `token: ${{ secrets.SPICETIFY_SUBMIT_TOKEN }}` → a step appending the `entry` output, fenced as
    ```` ```json ````, to `$GITHUB_STEP_SUMMARY` via an `env:` variable (never inline `${{ }}` in
    `run:`).
- [ ] **Step 2:** Validate the YAML as in Task 6. Read the file top to bottom against M11–M16 and
  M19: the check and tag assertion come before the publish step, so a failure uploads nothing.
- [ ] **Step 3:** Commit `ci: release with release-please and publish to the module store`.

### Task 8: Preview image

Covers M20 (image side).

- [ ] **Step 1:** Write a throwaway CDP script in the scratchpad (not committed): connect as
  `scripts/cdp-eval.mjs` does; navigate with
  `Spicetify.Platform.History.push("/playlist/37i9dQZF1DXcBWIGoYBM5M")` (Today's Top Hits); after
  the page renders, click `#tpp-action-bar-button`; wait until the preview panel (`#tpp-preview-root`)
  is visible; `Emulation.setDeviceMetricsOverride({ width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })`;
  `Page.captureScreenshot({ format: "png" })`; then `Emulation.clearDeviceMetricsOverride` and stop
  the session in a `finally`.
- [ ] **Step 2:** Save to `docs/preview.png`; `file docs/preview.png` → `1600 x 900`.
- [ ] **Step 3:** Show the image to the user and wait for approval. Retake on request.
- [ ] **Step 4:** Commit `docs: add the store preview image`.

### Task 9: Update `README.md`

- [ ] **Step 1:** Install: module store first (`spicetify pkg install track-playlist-preview`,
  then `spicetify pkg enable track-playlist-preview` and `spicetify apply`, or the in-client store);
  from source second. Development: kit build (unminified, sourcemap shipped, Node ≥ 22 needed),
  `build:local` writes `dist/track-playlist-preview@<version>/`, `src/metadata.json` is the metadata
  source, commits need Conventional Commit prefixes because release-please reads them. Remove the
  Bun-bundler paragraph.
- [ ] **Step 2:** Commit `docs: document store install and the kit build`.

### Task 10: Update `CLAUDE.md`

- [ ] **Step 1:** Rewrite the Build section for the kit wrapper in ≤ 6 lines (kit under Node,
  `src/metadata.json`, `src/index.scss`, output paths, `check:dist`); drop the "Aliases react…" and
  "Writes imported CSS…" items; update the `build:local` command line; add the commit-prefix rule
  line; add a Documentation pointer row to this spec and one to ADR 0002.
- [ ] **Step 2:** Commit `docs: point CLAUDE.md at the kit build and store spec`.

### Task 11: Update `docs/spicetify-v3-platform.md`

- [ ] **Step 1:** Record spec findings 3, 4, 5 and 6, the `react-shim` React path, and the planning
  finding that kit fails under Bun (sass `Invalid protobuf`) and runs under Node ≥ 22.
- [ ] **Step 2:** Commit `docs: record module-store and kit findings`.

### Task 12: Update the original design spec

- [ ] **Step 1:** In `docs/specs/2026-07-22-track-playlist-preview-design.md`, point the #3
  distribution deferral at `2026-09-28-store-publishing-design.md`.
- [ ] **Step 2:** Commit `docs: link the distribution deferral to the store spec`.

### Task 13: ADR 0002

- [ ] **Step 1:** Create `docs/adr/0002-build-with-spicetify-kit.md` in ADR 0001's format, from the
  spec's "Glossary Updates & ADRs" entry (context, decision, the two rejected alternatives,
  consequences including Node ≥ 22 for kit). No existing ADR conflicts.
- [ ] **Step 2:** Commit `docs: add ADR 0002 on building with spicetify-kit`.

### Task 14: Deferred-item verification

- [ ] **Step 1:** `gh issue view 14 --json body | jq -r .body | grep -E '^#+ (Context|Required|Integration Points|Priority)'`
  → four headings. If any is missing, show the user and fix the issue body.

### Task 15: Hand off Manual Operator Steps

- [ ] **Step 1:** Give the user spec "Manual Operator Steps" 1–5 verbatim. Step 1 must be done
  before this branch merges. If a wizard-generation skill is available, offer to generate the
  script first. Never perform these steps or substitute a placeholder token.

### Task 16: Post-implementation check

- [ ] **Step 1:** Read `git diff main...HEAD --stat` and the diff itself. Tick each off: every
  Config & Infrastructure Impact row (`package.json`, `bun.lock`, `build.ts`, `src/metadata.json`,
  `src/index.scss`, `.gitignore`, both release-please files, both workflows, `tsconfig.json`), each
  Documentation Updates row (Tasks 3, 9–13), ADR 0002, and the one `Release-As: 0.1.0` commit
  (`git log main..HEAD --grep 'Release-As'` → one commit). No glossary work applies.

### Task 17: Final build

- [ ] **Step 1:** `bun run check && bun run build:local && bun run check:dist` → all exit 0. Fix and
  re-run until they do.

### After merge (operator-driven; the agent verifies when asked)

Not implementation tasks — these criteria can only be observed on GitHub after the merge:

- M9, M10, M24: the release PR bumps `package.json`, `src/metadata.json`, the manifest and
  `CHANGELOG.md` to `0.1.0`, and the CHANGELOG lists no commit from before `bootstrap-sha`.
- M11, M12: `gh run list --workflow release.yml` shows `publish` skipped on non-release pushes and
  run on the release merge; `gh release view v0.1.0` exists.
- M14: `unzip -l track-playlist-preview@0.1.0.zip` lists `metadata.json` and `spicetify-module.json`
  at the root.
- M15: the run's summary shows the entry JSON; no PR on spicetify/modules.
- M17: in a spicetify/modules clone, add `vault/track-playlist-preview.json` from the summary on a
  local branch and run `node scripts/validate-submission.ts --base main` → `validate-submission: ok`.
- M20: `curl -sI <preview URL>` → `200` and `content-type: image/png`.
- M25: Manual Operator Step 3.
- M16: the first release after the token is set opens the PR from `Heyian`'s fork.

### Before finishing the branch (advisory cross-model review)

If a cross-model review helper is available, run it with focus: *"Judge correctness against the
spec's acceptance criteria (M1–M25) only. Do not flag anything outside the stated criteria — no
design alternatives, hardening, or scope the spec did not claim."* It never gates the merge. Then
ask the user whether to remove the debug-port flag (CLAUDE.md "Finishing a feature").
