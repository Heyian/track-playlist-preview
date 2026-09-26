// scripts/cdp-eval.mjs
// Evaluate a JS expression in the running Spotify renderer via the Chrome
// DevTools Protocol. Spotify exposes CDP on 127.0.0.1:8088 when
// `always_enable_devtools = 1` is set in the Spicetify config.
//
//   node scripts/cdp-eval.mjs 'Spicetify.Player.isPlaying()'
//   node scripts/cdp-eval.mjs "$(cat probe.js)"
//
// Prints the awaited result as JSON, or the error and exits non-zero.

const PORT = process.env.CDP_PORT ?? "8088";
const expression = process.argv.slice(2).join(" ");
if (!expression) {
  console.error("usage: node scripts/cdp-eval.mjs '<expression>'");
  process.exit(2);
}

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

async function evaluate(wsUrl, expr) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket connection failed.")), { once: true });
  });
  const id = 1;
  const result = new Promise((resolve, reject) => {
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      if (msg.error) reject(new Error(msg.error.message));
      else if (msg.result?.exceptionDetails) reject(new Error(msg.result.exceptionDetails.text));
      else resolve(msg.result.result.value);
    });
  });
  ws.send(
    JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true },
    }),
  );
  const value = await result;
  ws.close();
  return value;
}

try {
  const value = await evaluate(await firstPageTarget(), expression);
  console.log(JSON.stringify(value, null, 2));
} catch (err) {
  console.error(String(err.message ?? err));
  process.exit(1);
}
