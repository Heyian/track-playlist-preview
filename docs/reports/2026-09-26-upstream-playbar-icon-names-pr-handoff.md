# Handoff: open the stdlib Playbar icon-name fix PR

Written 2026-09-26. Supersedes the "file an issue" step of
[2026-09-26-upstream-playbar-icon-names-handoff.md](2026-09-26-upstream-playbar-icon-names-handoff.md).
No issue gets filed. The PR body carries the repro and cause.

Work from **`~/DEV/spicetify/modules`**, the user's fork of `spicetify/modules`. Don't use a worktree.

The user has already authorized this: make the fix, push the branch to the fork, and open the PR
against `spicetify/modules:main`. Stop and report instead if a gate fails or the live check doesn't
show the fix working.

**Don't add comments to the code you change or add.** Leave existing comments alone.

## State at handoff

- Remote: `origin` = `git@github.com:Heyian/modules.git` (the fork). There is no `upstream` remote.
- `main` is at `9dce55a` (Publish lyrics-plus@0.3.0), and the working tree is clean.
- `node_modules` isn't installed.
- The default Node is v22.21.1, but the repo needs Node ≥ 24 (`engines`, README).
  `fnm` already has v24.21.0.
- stdlib is at `1.13.0` (`modules/stdlib/metadata.json`) and is published.
- Live client: Spicetify CLI 3.0.0-beta.19, stdlib 1.13.0, Spotify 1.2.96.518, Linux. CDP is on
  `127.0.0.1:8088`. The harness is `node ~/DEV/track-playlist-preview/scripts/cdp-eval.mjs '<expr>'`
  and already skips DevTools windows.

## The bug (verified live 2026-09-26)

Under v3, `Spicetify.Playbar.Button` and `Playbar.Widget` render an empty icon when given an icon
name such as `"skip-forward"`. The rendered markup is
`<svg data-encore-id="icon" … viewBox="0 0 16 16" …>skip-forward</svg>`, with no `<path>`. Passing
full `<svg>` markup works.

Cause: `modules/stdlib/src/playbar-compat.tsx` (from `8d54cc3`, still unchanged on `main`) renders
`icon={innerSvg(self._icon)}`. `innerSvg` only strips an outer `<svg>` wrapper, so a bare name
passes through. `createIconComponent` then injects that name as `dangerouslySetInnerHTML`.

v2 resolved names first. See `spicetify/cli` at tag `v2.45.1`, `src/jsHelper/spicetifyWrapper/playbar.js`:
Widget at lines 122-128, and Button at lines 37-43, which also adds `stroke="currentColor"`.

`Spicetify.Topbar.Button` still resolves names under v3 (checked live) and stdlib doesn't shim it.
The Playbar shim is the only gap.

## Steps

1. Set up:
   ```bash
   cd ~/DEV/spicetify/modules
   git branch --show-current            # expect main
   git remote add upstream https://github.com/spicetify/modules.git
   git fetch upstream && git status     # confirm main == upstream/main; if not, rebase first
   git checkout -b fix/stdlib-playbar-icon-names
   fnm use 24                           # or prefix commands with `fnm exec --using=24`
   pnpm install --frozen-lockfile       # also sets core.hooksPath=.githooks (oxfmt + oxlint pre-commit)
   git clone --depth 1 https://github.com/spicetify/classmaps.git classmaps   # stitch needs it, as CI does
   ```
   `/classmaps`, `/dist/` and `classmap.d.ts` files are already gitignored.

2. Make the fix in `modules/stdlib/src/playbar-compat.tsx`, with no new comments:
   ```ts
   import { client } from "./client.ts";

   const toInnerSvg = (icon: string): string => client.icons?.[icon as Spicetify.Icon] ?? innerSvg(icon);
   ```
   Put `toInnerSvg` right after `innerSvg`. Change `icon={innerSvg(self._icon)}` to
   `icon={toInnerSvg(self._icon)}`.

   Why `client.icons` and not the global: `client.ts` says ambient `Spicetify` access stays in that
   adapter. `SVGIcons` is typed `Record<Icon, string>` in `spicetify.d.ts:1947`. Its values are
   inner `<path …/>` markup, which is what `createIconComponent` expects. If oxlint or tsc rejects
   the optional chain or the cast, make the smallest change that passes and keep the same behavior.

3. Bump the version, since CI refuses a change to an already-published module version:
   `node scripts/release.ts bump stdlib patch`. Expect `1.13.0` → `1.13.1` in
   `modules/stdlib/metadata.json`. If `check-deps` then complains, run
   `node scripts/release.ts autobump` instead and commit what it writes.

4. Run the gates in CI order. All must pass:
   ```bash
   pnpm fmt:check
   node scripts/stitch.ts        # full build; generates classmap.d.ts that tsc needs
   pnpm check
   pnpm test
   node scripts/release.ts status
   ```
   Lint has existing warnings. Only errors count.

5. Verify live, and restore afterwards:
   - Back up the installed stdlib:
     `cp -a ~/.config/spicetify/modules/stdlib ~/.cache/stdlib-backup-1.13.0`.
   - Build with `pnpm stitch modules/stdlib`, which writes `dist/stdlib@1.13.1/`. Look at the
     installed folder's layout (`src/`, `lib/`, `modules/`, `node_modules/`, `metadata.json`,
     `spicetify-module.json`) before copying anything over it. Replace only what the build produces.
     If the layouts don't match cleanly, use `spicetify-kit dev` / `install` instead
     (`packages/kit/src/dev.ts`, `install.ts`). Either way, run `spicetify apply` afterwards.
   - Run the repro. It must print markup containing `<path`:
     ```js
     (async () => {
       const b = new Spicetify.Playbar.Button("repro", "skip-forward");
       try {
         await new Promise((r) => setTimeout(r, 500));
         return document.querySelector('.spicetify-playbar-buttons [aria-label="repro"] svg')?.outerHTML;
       } finally {
         b.deregister();
       }
     })()
     ```
   - Run the same repro with full markup
     (`` `<svg viewBox="0 0 16 16">${Spicetify.SVGIcons["skip-forward"]}</svg>` ``) to confirm
     markup input still renders.
   - Restore the backup (`rm -rf` the installed stdlib, `mv` the backup back), run `spicetify apply`,
     and confirm `Spicetify.Modules.list()` shows stdlib 1.13.0 again. The user's
     track-playlist-preview Playbar buttons must still render.

6. Commit. The subject follows the repo's Conventional Commits, for example
   `fix(stdlib): resolve icon names in Playbar.Button/Widget`. Stage the source change and
   `metadata.json`, then confirm with `git show --stat HEAD`. The pre-commit hook reformats and
   re-stages files. Don't add any AI-attribution line.

7. Push and open the PR:
   ```bash
   git push -u origin fix/stdlib-playbar-icon-names
   gh pr create -R spicetify/modules --base main --head Heyian:fix/stdlib-playbar-icon-names \
     --title "fix(stdlib): resolve icon names in Playbar.Button/Widget" --body-file <file>
   ```
   Match merged PRs such as #21: plain prose paragraphs, no headings and no checklist. Cover:
   - **Problem:** v3 `Playbar.Button`/`Widget` given an icon name like `"skip-forward"` render an
     empty icon (the name ends up as a text node inside the `<svg>`). v2 accepted names, and its
     types declare `icon: Icon | string`.
   - **Cause:** `innerSvg` passes bare names through. Link v2's `playbar.js` at `v2.45.1`, lines
     122-128 and 37-43.
   - **Fix:** look the name up in `client.icons` first, then fall back to `innerSvg`. Ships as
     stdlib 1.13.1.
   - **Verification:** the live repro before and after, with Spotify 1.2.96.518, CLI
     3.0.0-beta.19 and Linux. Name the gates that passed and the test counts from `pnpm test`.
   - The body ends with its last content line. No attribution.

8. Report the PR URL. Verify it with `gh pr view -R spicetify/modules <n>`, and state CI status
   with `gh pr checks`.

## Don't

- Push to the fork's `main`, or push anything to `spicetify/modules` directly.
- Touch `vault.json` or `vault/`. Release writes those after the merge.
- Change `~/DEV/track-playlist-preview`. Its workaround (full `<svg>` markup) stays either way.
