const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "..", "options.js"), "utf8");

async function setup({ copyRegistered = true, copyShortcut = "", commandError } = {}) {
  const elements = new Map();
  function element() {
    const classes = new Set();
    return {
      textContent: "", hidden: true, listeners: {}, children: [],
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name)
      },
      append(...children) { this.children.push(...children); },
      addEventListener(name, callback) { this.listeners[name] = callback; }
    };
  }
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    createElement: element
  };
  const calls = { reloads: 0 };
  vm.runInNewContext(source, {
    document,
    navigator: { userAgent: "Edg/156" },
    chrome: {
      runtime: {
        getManifest: () => ({ version: "1.3.2" }),
        reload: () => { calls.reloads += 1; },
        lastError: commandError ? { message: commandError } : undefined,
        sendMessage: async () => ({ ok: true, result: { historyLimit: 100 } })
      },
      commands: {
        getAll(callback) {
          callback([
            { name: "_execute_action", shortcut: "Ctrl+Shift+Q" },
            { name: "navigate-back", shortcut: "Alt+Shift+Left" },
            { name: "navigate-forward", shortcut: "Alt+Shift+Right" },
            { name: "rename-current-tab", shortcut: "Alt+R" },
            ...(copyRegistered ? [{ name: "copy-selected-tabs", shortcut: copyShortcut }] : [])
          ]);
        }
      }
    }
  });
  await new Promise(setImmediate);
  return {
    calls,
    get: (id) => elements.get(`#${id}`),
    rows: () => elements.get("#command-list").children.map((row) => ({
      name: row.children[0].textContent,
      shortcut: row.children[1].children[0].textContent
    }))
  };
}

test("settings exposes a missing copy registration and only reloads on request", async () => {
  const { get, rows, calls } = await setup({ copyRegistered: false });
  assert.deepEqual(rows().find((row) => row.name === "Copy selected tab links"), {
    name: "Copy selected tab links", shortcut: "Not registered"
  });
  assert.equal(rows().length, 5);
  assert.equal(get("reload-notice").hidden, false);
  assert.equal(get("extension-version").textContent, "Loaded version 1.3.2");
  assert.equal(calls.reloads, 0);
  get("reload-extension").listeners.click();
  assert.equal(calls.reloads, 1);
});

test("settings distinguishes a registered but unassigned copy command from a missing command", async () => {
  const { get, rows } = await setup();
  assert.equal(rows().find((row) => row.name === "Copy selected tab links").shortcut, "Not assigned");
  assert.equal(get("reload-notice").hidden, true);
});

test("settings shows the actual assigned copy binding", async () => {
  const { get, rows } = await setup({ copyShortcut: "Alt+Shift+C" });
  assert.equal(rows().find((row) => row.name === "Copy selected tab links").shortcut, "Alt+Shift+C");
  assert.equal(get("reload-notice").hidden, true);
});

test("command lookup failures are reported without claiming missing registration", async () => {
  const { get, rows } = await setup({ commandError: "Commands unavailable." });
  assert.equal(get("copy-status").textContent, "Commands unavailable.");
  assert.equal(rows().length, 0);
  assert.equal(get("reload-notice").hidden, true);
});
