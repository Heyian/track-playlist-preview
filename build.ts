// build.ts — bundles this extension for Spicetify using Bun's bundler.
//
//   bun run build         → build into the Spicetify v3 modules folder
//   bun run build:local   → build into ./dist, minified, without installing
//   bun run watch         → rebuild on change
//
// A Spicetify v3 module is a folder `<modules>/<id>/` holding the entry script,
// an optional stylesheet and a `metadata.json`. Run `spicetify apply` after
// building to stage it. This script reproduces the three things the module needs:
//
//   1. `react` / `react-dom` resolve to Spotify's own copies on the `Spicetify`
//      global rather than being bundled — two React instances in one page break
//      hooks.
//   2. Imported CSS is written to `index.css`, which `metadata.json` declares as
//      `entries.css`; the loader adopts it before each `load()` and removes it
//      on unload.
//   3. The bundle is an ES module exporting `load(ctx)`, which the v3 loader
//      calls; `load` itself awaits a capped client-readiness wait. stdlib
//      imports (`/modules/stdlib/…`) stay external — the client serves them.

import { existsSync } from "node:fs";
import { mkdir, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BunPlugin } from "bun";

const NAME = "track-playlist-preview";
const ENTRY = "src/index.ts";

/** Resolve `react`/`react-dom` to the copies Spotify already has loaded. */
const spicetifyReact: BunPlugin = {
  name: "spicetify-react",
  setup(build) {
    const globals: Record<string, string> = {
      react: "Spicetify.React",
      "react-dom": "Spicetify.ReactDOM",
      "react-dom/client": "Spicetify.ReactDOM",
    };
    build.onResolve({ filter: /^react(-dom(\/client)?)?$/ }, (args) => ({
      path: args.path,
      namespace: "spicetify-global",
    }));
    build.onLoad({ filter: /.*/, namespace: "spicetify-global" }, (args) => ({
      contents: `module.exports = ${globals[args.path]};`,
      loader: "js",
    }));
  },
};

/**
 * The Spicetify v3 modules folder. `spicetify path` reports it only as a log
 * line (`INFO modules: <dir>`), so parse that and fall back to the XDG default
 * if the format changes or the CLI is missing.
 */
async function modulesDir(): Promise<string> {
  const fallback = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "spicetify", "modules");
  try {
    const proc = Bun.spawn(["spicetify", "path"], { stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    const plain = (out + err).replace(/\x1b\[[0-9;]*m/g, "");
    const match = /^\s*INFO\s+modules:\s+(.+?)\s*$/m.exec(plain);
    if (match?.[1]) return match[1];
  } catch {
    // spicetify not on PATH
  }
  console.warn(`Could not read the modules folder from \`spicetify path\`; using ${fallback}`);
  return fallback;
}

/** v3 module metadata, derived from package.json so the version stays in sync. */
async function metadata(hasCss: boolean): Promise<string> {
  const pkg = await Bun.file("package.json").json();
  return `${JSON.stringify(
    {
      name: NAME,
      version: pkg.version,
      authors: [pkg.author],
      description: pkg.description,
      tags: [],
      entries: hasCss ? { js: "index.js", css: "index.css" } : { js: "index.js" },
      hasMixins: false,
      dependencies: pkg.spicetify?.dependencies ?? {},
    },
    null,
    2,
  )}\n`;
}

async function build(outDir: string, minify: boolean): Promise<void> {
  const tmp = join(".bun-build", NAME);
  if (existsSync(tmp)) await rm(tmp, { recursive: true });

  const result = await Bun.build({
    entrypoints: [ENTRY],
    outdir: tmp,
    target: "browser",
    format: "esm",
    minify,
    external: ["/modules/stdlib/*"],
    plugins: [spicetifyReact],
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Bundle failed.");
  }

  // Bun emits CSS imports as sibling .css files; collect them into one sheet.
  let js = "";
  let css = "";
  for (const file of await readdir(tmp)) {
    const text = await Bun.file(join(tmp, file)).text();
    if (file.endsWith(".css")) css += text;
    else if (file.endsWith(".js")) js += text;
  }

  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, "index.js");
  await writeFile(outFile, js);
  const cssFile = join(outDir, "index.css");
  if (css) await writeFile(cssFile, css);
  else if (existsSync(cssFile)) await unlink(cssFile); // stale from an earlier build
  await writeFile(join(outDir, "metadata.json"), await metadata(css !== ""));
  await rm(tmp, { recursive: true });

  const kb = (Bun.stringWidth(js) / 1024).toFixed(1);
  console.log(`Built ${outFile} (${kb} kB)${minify ? " [minified]" : ""}`);
}

const args = new Set(Bun.argv.slice(2));
const local = args.has("--local");
const outDir = join(local ? "dist" : await modulesDir(), NAME);
const minify = local || args.has("--minify");

await build(outDir, minify);

if (args.has("--watch")) {
  console.log("Watching src/ …");
  const { watch } = await import("node:fs");
  let queued: ReturnType<typeof setTimeout> | undefined;
  watch("src", { recursive: true }, () => {
    clearTimeout(queued);
    queued = setTimeout(() => {
      build(outDir, minify).catch((err) => console.error(err.message));
    }, 50);
  });
}
