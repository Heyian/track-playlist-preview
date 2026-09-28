// scripts/checkUnloadPage.mjs
// In-page expressions used by check-unload.mjs, kept here so they can be
// unit-tested (checkUnloadPage.test.mjs) without a live client.

/**
 * Starts a fresh preview session from the action-bar button (U26). A preview
 * already running on the page turns the button into Stop preview, so stop it
 * first; otherwise the click would end that session instead of starting one.
 */
export const START_PREVIEW = `(async () => {
  const button = () => document.getElementById("tpp-action-bar-button");
  if (button().textContent === "Stop preview") {
    button().click();
    const end = Date.now() + 5000;
    while (Date.now() < end && button()?.textContent !== "Preview all") {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  button().click();
  return true;
})()`;

/**
 * Leaves the client as the check found it (U27): module enabled, functions and
 * pathname restored. Each step runs even if an earlier one throws. Returns true,
 * or the errors joined into one message.
 */
export function restoreExpression(id) {
  return `(async () => {
    const errors = [];
    const step = async (fn) => { try { await fn(); } catch (e) { errors.push(String(e?.message ?? e)); } };
    await step(async () => {
      if (!Spicetify.Modules.report.loaded.includes(${JSON.stringify(id)})) await Spicetify.Modules.enable(${JSON.stringify(id)});
    });
    const s = window.__tppCheck;
    if (s) {
      await step(() => { HTMLMediaElement.prototype.play = s.orig.play; });
      await step(() => { Spicetify.ContextMenuV2.registerItem = s.orig.reg; });
      await step(() => { Spicetify.ContextMenuV2.unregisterItem = s.orig.unreg; });
      await step(() => Spicetify.Platform.History.push(s.path));
      delete window.__tppCheck;
    }
    return errors.length === 0 ? true : errors.join("; ");
  })()`;
}
