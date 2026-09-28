// build.ts — builds this module with spicetify-kit and installs the result.
//
//   bun run build         → build into the Spicetify v3 modules folder
//   bun run build:local   → build into ./dist/track-playlist-preview@<version>/
//   bun run watch         → rebuild on change and install as `build` does
//
// Kit (`spicetify-kit build src`) bundles `src/index.ts`, compiles
// `src/index.scss` to `index.css`, copies `src/metadata.json`, writes the
// `spicetify-module.json` sidecar and runs the module-standard check, failing
// on an error-tier finding. React resolves through stdlib's react-shim. Kit
// writes to a scratch folder; this script copies its versioned output into
// place. Run `spicetify apply` after `build` to stage the module.

import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import { join } from "node:path";
import { NAME, SCRATCH, buildModule, kitCommand, modulesDir, runKit, shouldRebuild } from "./scripts/kitBuild";

const args = new Set(process.argv.slice(2));
const local = args.has("--local");
const modules = local ? undefined : await modulesDir();

async function build(): Promise<void> {
  const { version } = JSON.parse(await readFile("src/metadata.json", "utf8"));
  const dest = modules ? join(modules, NAME) : join("dist", `${NAME}@${version}`);
  await buildModule({ run: () => runKit(kitCommand(SCRATCH)), version, dest });
  console.log(`Built ${dest}`);
}

if (!args.has("--watch")) {
  await build().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else {
  await build().catch((err) => console.error(err.message));
  console.log("Watching src/ …");
  let queued: ReturnType<typeof setTimeout> | undefined;
  watch("src", { recursive: true }, (_event, filename) => {
    if (!shouldRebuild(filename)) return;
    clearTimeout(queued);
    queued = setTimeout(() => {
      build().catch((err) => console.error(err.message));
    }, 50);
  });
}
