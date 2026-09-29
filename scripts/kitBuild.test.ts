import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildModule, installModule, kitCommand, runKit, shouldRebuild } from "./kitBuild";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kit-build-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seed(dir: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, ".."), { recursive: true });
    await writeFile(join(dir, name), content);
  }
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .sort();
}

describe("installModule", () => {
  it("copies bytes exactly", async () => {
    const built = join(root, "built");
    await seed(built, { "index.js": "js", "index.css": "css", "sub/deep.json": "{}" });
    await writeFile(join(built, "bin.dat"), Buffer.from([0, 255, 10, 13]));
    const dest = join(root, "dest");

    await installModule(built, dest);

    const files = await listFiles(built);
    expect(await listFiles(dest)).toEqual(files);
    for (const file of files) {
      expect((await readFile(join(dest, file))).equals(await readFile(join(built, file)))).toBe(true);
    }
  });

  it("removes files from an earlier build", async () => {
    const built = join(root, "built");
    await seed(built, { "index.js": "js" });
    const dest = join(root, "dest");
    await seed(dest, { "old.js": "old" });

    await installModule(built, dest);

    expect(existsSync(join(dest, "old.js"))).toBe(false);
  });

  it("replaces a symlinked dest without touching its target", async () => {
    const built = join(root, "built");
    await seed(built, { "index.js": "dev" });
    const store = join(root, "store", "0.1.0");
    await seed(store, { "index.js": "store" });
    const dest = join(root, "dest");
    await symlink(store, dest);

    await installModule(built, dest);

    expect((await lstat(dest)).isSymbolicLink()).toBe(false);
    expect(await readFile(join(dest, "index.js"), "utf8")).toBe("dev");
    expect(await readFile(join(store, "index.js"), "utf8")).toBe("store");
  });
});

describe("buildModule", () => {
  it("installs nothing when kit fails", async () => {
    const scratch = join(root, "scratch");
    await seed(join(scratch, "track-playlist-preview@0.1.0"), { "index.js": "stale" });
    const dest = join(root, "dest");
    await seed(dest, { "keep.js": "keep" });

    const build = buildModule({
      run: () => Promise.reject(new Error("kit failed")),
      version: "0.1.0",
      dest,
      scratch,
    });

    await expect(build).rejects.toThrow("kit failed");
    expect(await listFiles(dest)).toEqual(["keep.js"]);
  });
});

describe("runKit", () => {
  it("rejects on a non-zero exit", async () => {
    await expect(runKit(["node", "-e", "process.exit(3)"])).rejects.toThrow("spicetify-kit exited with code 3");
  });

  it("resolves on a zero exit", async () => {
    await expect(runKit(["node", "-e", ""])).resolves.toBeUndefined();
  });
});

describe("kitCommand", () => {
  it("runs kit under node", () => {
    const command = kitCommand("x");
    expect(command[0]).toBe("node");
    expect(command.slice(-2)).toEqual(["--out", "x"]);
  });
});

describe("shouldRebuild", () => {
  it("ignores the classmap", () => {
    expect(shouldRebuild("classmap.d.ts")).toBe(false);
    expect(shouldRebuild("ui/previewPanel.tsx")).toBe(true);
    expect(shouldRebuild(null)).toBe(true);
  });
});
