// build.ts — bundles this extension for Spicetify using Bun's bundler.
//
//   bun run build         → build into the Spicetify v3 modules folder
//   bun run build:local   → build into ./dist, minified, without installing
//   bun run watch         → rebuild on change
//
// A Spicetify v3 module is a folder `<modules>/<id>/` holding the entry script
// and a `metadata.json`. Run `spicetify apply` after building to stage it.
// This script reproduces the three things the entry script needs:
//
//   1. `react` / `react-dom` resolve to Spotify's own copies on the `Spicetify`
//      global rather than being bundled — two React instances in one page break
//      hooks.
//   2. Imported CSS is inlined into the JS bundle and injected as a <style> tag,
//      since a separate .css file would never be loaded.
//   3. The whole bundle waits for Spicetify to finish loading before running.

import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
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
async function metadata(): Promise<string> {
  const pkg = await Bun.file("package.json").json();
  return `${JSON.stringify(
    {
      name: NAME,
      version: pkg.version,
      authors: [pkg.author],
      description: pkg.description,
      tags: [],
      entries: { js: "index.js" },
      hasMixins: false,
      dependencies: {},
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
    format: "iife",
    minify,
    plugins: [spicetifyReact],
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Bundle failed.");
  }

  // Bun emits CSS imports as sibling .css files; fold them back into the JS.
  let js = "";
  let css = "";
  for (const file of await readdir(tmp)) {
    const text = await Bun.file(join(tmp, file)).text();
    if (file.endsWith(".css")) css += text;
    else if (file.endsWith(".js")) js += text;
  }

  const styleInjection = css
    ? `
  if (!document.getElementById(${JSON.stringify(NAME)})) {
    const el = document.createElement("style");
    el.id = ${JSON.stringify(NAME)};
    el.textContent = ${JSON.stringify(css)};
    document.head.appendChild(el);
  }`
    : "";

  // Spicetify injects extensions early; React and the platform APIs may not be
  // ready yet, so hold until they are.
  const bundle = `(async () => {
  while (!Spicetify?.React || !Spicetify?.ReactDOM || !Spicetify?.Platform) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }${styleInjection}
${js}
})();
`;

  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, "index.js");
  await writeFile(outFile, bundle);
  await writeFile(join(outDir, "metadata.json"), await metadata());
  await rm(tmp, { recursive: true });

  const kb = (Bun.stringWidth(bundle) / 1024).toFixed(1);
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
