// checkDist.ts — asserts the shape of the built module folder before it is
// installed or published.
//
//   bun scripts/checkDist.ts [--tag <tag>]
//
// Checks `dist/track-playlist-preview@<version>/` against `src/metadata.json`
// and, with `--tag`, that the release tag is `v<version>`. Prints each problem
// and exits 1 if there are any.

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const FILES = ["index.js", "index.js.map", "index.css", "metadata.json", "spicetify-module.json"];
const REACT_SHIM = "/modules/stdlib/src/expose/react-shim.js";
const ROW_RULES = ".tpp-previewing-row";
const PANEL_RULES = "#tpp-preview-root";

/** Problems with the built folder `dir`, empty when it passes. */
export function checkDist(dir: string, source: Record<string, unknown>, tag?: string): string[] {
  const problems: string[] = [];
  const expected = `${source.name}@${source.version}`;
  if (basename(dir) !== expected) problems.push(`folder is ${basename(dir)}, expected ${expected}`);
  if (tag !== undefined && tag !== `v${source.version}`) {
    problems.push(`tag ${tag} does not match version ${source.version}`);
  }

  const missing = FILES.filter((file) => !existsSync(join(dir, file)));
  for (const file of missing) problems.push(`missing ${file}`);
  const read = (file: string) => (missing.includes(file) ? undefined : readFileSync(join(dir, file), "utf8"));

  const metadata = read("metadata.json");
  if (metadata !== undefined && !isDeepStrictEqual(JSON.parse(metadata), source)) {
    problems.push("metadata.json differs from src/metadata.json");
  }

  const css = read("index.css");
  if (css !== undefined) {
    const row = css.indexOf(ROW_RULES);
    const panel = css.indexOf(PANEL_RULES);
    if (row < 0) problems.push(`index.css has no ${ROW_RULES} rules`);
    if (panel < 0) problems.push(`index.css has no ${PANEL_RULES} rules`);
    if (row >= 0 && panel >= 0 && panel < row) {
      problems.push(`index.css has ${PANEL_RULES} rules before ${ROW_RULES} rules`);
    }
  }

  const js = read("index.js");
  if (js !== undefined && !js.includes(`"${REACT_SHIM}"`)) problems.push(`index.js does not import ${REACT_SHIM}`);

  return problems;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const tagIndex = args.indexOf("--tag");
  const tag = tagIndex >= 0 ? args[tagIndex + 1] : undefined;
  if (tagIndex >= 0 && !tag) {
    console.error("--tag needs a value");
    process.exit(1);
  }
  const source = JSON.parse(readFileSync("src/metadata.json", "utf8"));
  const dir = join("dist", `${source.name}@${source.version}`);
  const problems = checkDist(dir, source, tag);
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exit(1);
  console.log(`${dir} passes`);
}
