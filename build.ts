// build.ts — bundles this extension for Spicetify using Bun's bundler.
//
//   bun run build         → build into the Spicetify Extensions folder
//   bun run build:local   → build into ./dist, minified, without installing
//   bun run watch         → rebuild on change
//
// Spicetify extensions are a single JS file dropped into the Extensions folder.
// This script reproduces the three things that requires:
//
//   1. `react` / `react-dom` resolve to Spotify's own copies on the `Spicetify`
//      global rather than being bundled — two React instances in one page break
//      hooks.
//   2. Imported CSS is inlined into the JS bundle and injected as a <style> tag,
//      since a separate .css file would never be loaded.
//   3. The whole bundle waits for Spicetify to finish loading before running.

import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

/** The Spicetify Extensions folder, per the local Spicetify config. */
async function extensionsDir(): Promise<string> {
  const proc = Bun.spawn(["spicetify", "-c"], { stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(proc.stdout).text()).trim();
  if ((await proc.exited) !== 0 || !out) {
    throw new Error("Could not locate Spicetify. Is `spicetify` on your PATH?");
  }
  return join(dirname(out), "Extensions");
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
  const outFile = join(outDir, `${NAME}.js`);
  await writeFile(outFile, bundle);
  await rm(tmp, { recursive: true });

  const kb = (Bun.stringWidth(bundle) / 1024).toFixed(1);
  console.log(`Built ${outFile} (${kb} kB)${minify ? " [minified]" : ""}`);
}

const args = new Set(Bun.argv.slice(2));
const local = args.has("--local");
const outDir = local ? "dist" : await extensionsDir();
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
