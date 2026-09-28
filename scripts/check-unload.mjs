// scripts/check-unload.mjs
// Live check that disabling the module removes everything it mounted, and that
// enabling it again builds exactly one wiring. See the unload-teardown spec,
// "CDP check" (U19, U26, U27).
//
//   node scripts/check-unload.mjs               # with a live preview session
//   node scripts/check-unload.mjs --no-session  # skip the session checks
//
// Without --no-session it previews Liked Songs, which interrupts Spotify
// playback for a few seconds. Prints one PASS/FAIL line per check; exits 1 if
// any check failed or the run threw.

const PORT = process.env.CDP_PORT ?? "8088";
const ID = "track-playlist-preview";
const withSession = !process.argv.includes("--no-session");

async function firstPageTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  const targets = await res.json();
  // An open DevTools window is also a "page" target, and may be listed first.
  const page = targets.find(
    (t) => t.type === "page" && t.webSocketDebuggerUrl && !t.url.startsWith("devtools://"),
  );
  if (!page) throw new Error("No page target with a WebSocket debugger URL found.");
  return page.webSocketDebuggerUrl;
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket connection failed.")), { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else if (msg.result?.exceptionDetails) {
      const d = msg.result.exceptionDetails;
      p.reject(new Error(d.exception?.description ?? d.text));
    } else p.resolve(msg.result.result.value);
  });
  const evaluate = (expr) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true },
        }),
      );
    });
  return { evaluate, close: () => ws.close() };
}

// In-page helpers, installed once on window.__tppCheck.
const INSTALL = `(() => {
  const proto = HTMLMediaElement.prototype;
  const cm = Spicetify.ContextMenuV2;
  const s = {
    orig: { play: proto.play, reg: cm.registerItem, unreg: cm.unregisterItem },
    path: Spicetify.Platform.History.location.pathname,
    wasPlaying: Spicetify.Player.isPlaying(),
    clip: null,
    reg: 0,
    unreg: 0,
  };
  window.__tppCheck = s;
  proto.play = function (...args) {
    // The preview <Audio> element is never attached to the document.
    if (!this.isConnected) s.clip = this;
    return s.orig.play.apply(this, args);
  };
  cm.registerItem = function (...args) { s.reg++; return s.orig.reg.apply(this, args); };
  cm.unregisterItem = function (...args) { s.unreg++; return s.orig.unreg.apply(this, args); };
  return true;
})()`;

const WAIT = `async (predicate, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return predicate();
}`;

const FRAMES = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`;

const SHEETS = `(() => {
  const mentions = (text) => text.includes(".tpp-panel");
  const sheetText = (sheet) => { try { return [...sheet.cssRules].map((r) => r.cssText).join("\\n"); } catch { return ""; } };
  const adopted = document.adoptedStyleSheets.filter((s) => mentions(sheetText(s))).length;
  const styles = [...document.querySelectorAll("style")].filter(
    (el) => mentions(el.textContent ?? "") || (el.sheet && mentions(sheetText(el.sheet))),
  ).length;
  return { adopted, styles };
})()`;

const LOADED = `Spicetify.Modules.report.loaded.includes(${JSON.stringify(ID)})`;

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` (${JSON.stringify(detail)})` : ""}`);
}

let page;
let failed = false;
try {
  page = await connect(await firstPageTarget());
  const ev = page.evaluate;
  const wait = (predicate, ms) => ev(`(${WAIT})(() => (${predicate}), ${ms})`);
  const push = (path) => ev(`Spicetify.Platform.History.push(${JSON.stringify(path)})`);

  // 1. Record the start state and wrap the functions.
  await ev(INSTALL);

  // 2. Live preview session on Liked Songs.
  if (withSession) {
    await push("/collection/tracks");
    if (!(await wait(`document.getElementById("tpp-action-bar-button")`, 5000))) {
      throw new Error("Preview all button did not appear on /collection/tracks.");
    }
    await ev(`document.getElementById("tpp-action-bar-button").click()`);
    if (!(await wait(`window.__tppCheck.clip && !window.__tppCheck.clip.paused`, 10000))) {
      throw new Error("No preview clip started playing within 10 s.");
    }
  }

  // 3. Disable, then check that everything is gone.
  await ev(`Spicetify.Modules.disable(${JSON.stringify(ID)})`);
  // Let any re-injection queued by a leaked observer run before looking.
  await ev(FRAMES);
  check("panel root absent", await ev(`!document.getElementById("tpp-preview-root")`));
  check("button absent", await ev(`!document.getElementById("tpp-action-bar-button")`));
  check("no previewing row", await ev(`!document.querySelector(".tpp-previewing-row")`));
  const off = await ev(SHEETS);
  check("stylesheet removed", off.adopted === 0 && off.styles === 0, off);
  const unreg = await ev(`window.__tppCheck.unreg`);
  check("unregisterItem ×3", unreg === 3, unreg);
  await push("/search");
  await push("/collection/tracks");
  await ev(FRAMES);
  check("no button after navigation", await ev(`!document.getElementById("tpp-action-bar-button")`));
  if (withSession) {
    check(
      "clip stopped",
      await ev(`(() => { const c = window.__tppCheck.clip; return !!c && c.paused && !c.hasAttribute("src"); })()`),
    );
    check(
      "playback restored",
      await wait(`Spicetify.Player.isPlaying() === window.__tppCheck.wasPlaying`, 5000),
    );
  }

  // 4. Enable, then check for exactly one wiring.
  await ev(`Spicetify.Modules.enable(${JSON.stringify(ID)})`);
  const reg = await ev(`window.__tppCheck.reg`);
  check("registerItem ×3", reg === 3, reg);
  await wait(`document.getElementById("tpp-action-bar-button")`, 5000);
  const buttons = await ev(`document.querySelectorAll("#tpp-action-bar-button").length`);
  check("one button", buttons === 1, buttons);
  const on = await ev(SHEETS);
  check("one stylesheet", on.adopted === 1, on);
} catch (err) {
  failed = true;
  console.error(`ERROR ${String(err.message ?? err)}`);
} finally {
  // 5. Leave the client as it was found.
  if (page) {
    try {
      await page.evaluate(`(async () => {
        if (!(${LOADED})) await Spicetify.Modules.enable(${JSON.stringify(ID)});
        const s = window.__tppCheck;
        if (s) {
          HTMLMediaElement.prototype.play = s.orig.play;
          Spicetify.ContextMenuV2.registerItem = s.orig.reg;
          Spicetify.ContextMenuV2.unregisterItem = s.orig.unreg;
          Spicetify.Platform.History.push(s.path);
          delete window.__tppCheck;
        }
        return true;
      })()`);
    } catch (err) {
      failed = true;
      console.error(`ERROR restoring the client: ${String(err.message ?? err)}`);
    }
    page.close();
  }
}

process.exit(failed || results.includes(false) ? 1 : 0);
