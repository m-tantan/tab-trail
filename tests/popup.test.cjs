const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");

async function setup({ loaded = "1.3.2", available = loaded, copyRegistered = true, copySupported = true } = {}) {
  const elements = new Map();
  function element() {
    const classes = new Set();
    return {
      textContent: "", value: "", hidden: true, disabled: true, listeners: {},
      classList: {
        add: (name) => classes.add(name),
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        }
      },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      replaceChildren() {},
      focus() {}
    };
  }
  const document = {
    body: element(),
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    addEventListener() {}
  };
  const calls = { reloads: 0, copies: 0 };
  const context = vm.createContext({
    document,
    URL,
    fetch: async () => ({ ok: true, json: async () => ({ version: available }) }),
    chrome: {
      runtime: {
        getManifest: () => ({ version: loaded }),
        getURL: (file) => `chrome-extension://tab-trail/${file}`,
        reload: () => { calls.reloads += 1; },
        async sendMessage(message) {
          if (message.type === "copy-selected-tabs") {
            calls.copies += 1;
            return copySupported
              ? { ok: true, result: { count: 2 } }
              : { ok: false, error: "Unknown Tab Trail request." };
          }
          assert.equal(message.type, "get-popup-state");
          return {
            ok: true,
            result: {
              entries: [], allTabs: [], cursor: -1, historyLimit: 20,
              activeWindowId: 1, activeTabId: 1
            }
          };
        }
      },
      commands: {
        async getAll() {
          return [
            { name: "_execute_action", shortcut: "Ctrl+Shift+Q" },
            ...(copyRegistered ? [{ name: "copy-selected-tabs", shortcut: "" }] : [])
          ];
        }
      }
    }
  });
  vm.runInContext(source, context);
  await new Promise(setImmediate);
  return {
    calls,
    get: (id) => elements.get(`#${id}`),
    async click(id) {
      elements.get(`#${id}`).listeners.click();
      await new Promise(setImmediate);
    }
  };
}

test("changed files require an explicit full-extension reload and explain both versions", async () => {
  const { get, calls, click } = await setup({ loaded: "1.2.0", available: "1.3.2" });
  assert.equal(get("reload-notice").hidden, false);
  assert.equal(get("copy-selected-tabs").disabled, true);
  assert.match(get("extension-version").textContent, /Loaded version 1\.2\.0; available 1\.3\.2/);
  assert.equal(calls.reloads, 0);
  await click("reload-extension");
  assert.equal(calls.reloads, 1);
});

test("a missing registered command requires reloading even when the version has not changed", async () => {
  const { get } = await setup({ copyRegistered: false });
  assert.equal(get("reload-notice").hidden, false);
  assert.equal(get("copy-selected-tabs").disabled, true);
});

test("an unassigned copy shortcut does not disable a current popup's copy action", async () => {
  const { get, calls, click } = await setup();
  assert.equal(get("reload-notice").hidden, true);
  assert.equal(get("copy-selected-tabs").disabled, false);
  await click("copy-selected-tabs");
  assert.equal(calls.copies, 1);
  assert.equal(get("status").textContent, "Copied 2 selected tab links.");
  assert.equal(get("copy-selected-tabs").disabled, false);
});

test("an older worker's unknown copy request becomes an actionable reload message", async () => {
  const { get, click } = await setup({ copySupported: false });
  await click("copy-selected-tabs");
  assert.equal(get("reload-notice").hidden, false);
  assert.equal(get("copy-selected-tabs").disabled, true);
  assert.equal(get("status").textContent, "Reload Tab Trail to load the updated copy command.");
});
