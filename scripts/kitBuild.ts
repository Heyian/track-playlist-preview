// kitBuild.ts — the steps behind build.ts: run spicetify-kit into a scratch
// folder, then install its versioned output where the client or the release
// expects it.

import { execFile, spawn } from "node:child_process";
import { cp, lstat, mkdir, rm, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const NAME = "track-playlist-preview";
export const SCRATCH = ".kit-build";

/**
 * The kit build command. Kit runs under Node: under Bun its sass compiler fails
 * with `Invalid protobuf`.
 */
export function kitCommand(outDir: string): string[] {
  return ["node", "node_modules/@spicetify/kit/bin/spicetify-kit.js", "build", "src", "--out", outDir];
}

/** Runs `command` with inherited stdio; rejects on a non-zero exit. */
export function runKit(command: string[]): Promise<void> {
  const [bin, ...args] = command;
  if (!bin) return Promise.reject(new Error("empty command"));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`spicetify-kit exited with code ${code}`));
    });
  });
}

/**
 * Replaces `dest` with a copy of `builtDir`. A symlinked `dest` (a store
 * install enabled with `spicetify pkg enable`) is unlinked, never deleted
 * through, so the store copy survives.
 */
export async function installModule(builtDir: string, dest: string): Promise<void> {
  const stat = await lstat(dest).catch(() => undefined);
  if (stat?.isSymbolicLink()) await unlink(dest);
  else if (stat) await rm(dest, { recursive: true });
  await mkdir(dirname(dest), { recursive: true });
  await cp(builtDir, dest, { recursive: true });
}

/** Clears the scratch folder, runs kit, and installs its output into `dest`. */
export async function buildModule(opts: {
  run: () => Promise<void>;
  version: string;
  dest: string;
  scratch?: string;
}): Promise<void> {
  const scratch = opts.scratch ?? SCRATCH;
  await rm(scratch, { recursive: true, force: true });
  await opts.run();
  await installModule(join(scratch, `${NAME}@${opts.version}`), opts.dest);
}

/** Whether a change to `filename` under `src/` needs a rebuild. Kit rewrites the classmap on every build. */
export function shouldRebuild(filename: string | null): boolean {
  return filename === null || basename(filename) !== "classmap.d.ts";
}

/**
 * The Spicetify v3 modules folder. `spicetify path` reports it only as a log
 * line (`INFO modules: <dir>`), so parse that and fall back to the XDG default
 * if the format changes or the CLI is missing.
 */
export async function modulesDir(): Promise<string> {
  const fallback = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "spicetify", "modules");
  const output = await new Promise<string>((resolve) => {
    execFile("spicetify", ["path"], (_err, stdout, stderr) => resolve(`${stdout ?? ""}${stderr ?? ""}`));
  });
  const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
  const match = /^\s*INFO\s+modules:\s+(.+?)\s*$/m.exec(plain);
  if (match?.[1]) return match[1];
  console.warn(`Could not read the modules folder from \`spicetify path\`; using ${fallback}`);
  return fallback;
}
