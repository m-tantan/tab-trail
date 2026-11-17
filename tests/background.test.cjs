const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

function storageArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      return structuredClone(keys === null
        ? data
        : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, data[key]])));
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete data[key];
      }
    }
  };
}

function event() {
  return {
    listeners: [],
    addListener(listener) {
      this.listeners.push(listener);
    }
  };
}

function makeTab(id, overrides = {}) {
  return {
    id,
    windowId: 1,
    title: `Tab ${id}`,
    url: `https://example.com/${id}`,
    active: id === 1,
    highlighted: id === 1,
    index: id - 1,
    discarded: false,
    ...overrides
  };
}

async function setup({ tabs = [makeTab(1)], local = {}, session = {}, clipboardError } = {}) {
  const byId = new Map(tabs.map((tab) => [tab.id, structuredClone(tab)]));
  const calls = {
    updates: [], windows: [], messages: [], createdWindows: [], errors: [],
    clipboard: [], clipboardDocuments: 0, menus: [], badges: [], warnings: [], scripts: []
  };
  let clipboardDocumentExists = false;
  const chrome = {
    storage: { local: storageArea(local), session: storageArea(session) },
    tabs: {
      async query(query) {
        return structuredClone([...byId.values()].filter((tab) =>
          (!query.active || tab.active) &&
          (!query.highlighted || tab.highlighted) &&
          (query.windowId === undefined || query.windowId === tab.windowId) &&
          (!(query.currentWindow || query.lastFocusedWindow) || tab.windowId === 1)
        ));
      },
      async get(id) {
        if (!byId.has(id)) {
          throw new Error(`No tab with id: ${id}`);
        }
        return structuredClone(byId.get(id));
      },
      async update(id, values) {
        calls.updates.push(structuredClone({ id, values }));
        const tab = await this.get(id);
        for (const other of byId.values()) {
          if (other.windowId === tab.windowId) {
            other.active = false;
          }
        }
        Object.assign(byId.get(id), values);
      },
      async sendMessage(id, message) {
        const tab = await this.get(id);
        if (tab.discarded || tab.frozen) {
          throw new Error("No content script in a sleeping tab");
        }
        calls.messages.push(structuredClone({ id, message }));
        return { success: true };
      },
      onActivated: event(),
      onRemoved: event(),
      onReplaced: event(),
      onUpdated: event()
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: event(),
      async update(id, values) {
        calls.windows.push(structuredClone({ id, values }));
      },
      async create(values) {
        calls.createdWindows.push(values);
      },
      async getLastFocused() {
        return { id: 1 };
      }
    },
    action: {
      async setBadgeText(values) {
        calls.badges.push(structuredClone(values));
      },
      async setBadgeBackgroundColor() {},
      async setTitle() {}
    },
    scripting: {
      async executeScript({ target, func, args }) {
        calls.scripts.push({ target: structuredClone(target), func, args: structuredClone(args) });
      }
    },
    offscreen: {
      async createDocument() {
        calls.clipboardDocuments += 1;
        await new Promise(setImmediate);
        clipboardDocumentExists = true;
      }
    },
    contextMenus: {
      onClicked: event(),
      create(properties, callback) {
        calls.menus.push(structuredClone(properties));
        callback();
      },
      removeAll(callback) {
        calls.menus = [];
        callback();
      }
    },
    commands: { onCommand: event() },
    runtime: {
      getURL: (file) => `chrome-extension://tab-trail/${file}`,
      onInstalled: event(),
      onStartup: event(),
      onMessage: event(),
      async getContexts() {
        return clipboardDocumentExists ? [{ contextType: "OFFSCREEN_DOCUMENT" }] : [];
      },
      async sendMessage(message) {
        calls.clipboard.push(structuredClone(message));
        return clipboardError ? { ok: false, error: clipboardError } : { ok: true };
      }
    }
  };
  const context = vm.createContext({
    chrome,
    URL,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: {
      error: (error) => calls.errors.push(error.message),
      warn: (message, error) => calls.warnings.push(`${message} ${error.message}`)
    }
  });
  vm.runInContext(source, context);
  const api = vm.runInContext(`({
    withHistoryLock, recordActivation, activateTab, navigateHistory, getPopupState,
    rememberTab, renameTab, clearTabName, reapplyCustomName, openRenameWindow,
    setHistoryLimit, getHistoryLimit, removeTabFromState, replaceTabInState,
    copySelectedTabs, copySelectedTabsAndNotify, createCopyMenus
  })`, context);
  await new Promise(setImmediate);
  await api.withHistoryLock(async () => {});
  assert.deepEqual(calls.errors, []);
  return { api, chrome, calls, tabs: byId };
}

test("search state includes sleeping tabs outside the trail, with saved names and earlier titles", async () => {
  const { api } = await setup({
    tabs: [
      makeTab(1),
      makeTab(2, { discarded: true, title: "Sign in", windowId: 2 }),
      makeTab(3, { url: "chrome-extension://tab-trail/options.html" })
    ],
    local: { profileHistory: { entries: [1], cursor: 0 }, customNames: { 2: "Production" } },
    session: { tabMetadata: { 2: ["Release dashboard"] } }
  });
  const state = await api.getPopupState();
  assert.equal(state.entries.length, 1);
  assert.equal(state.allTabs.length, 2);
  const sleeping = state.allTabs.find((tab) => tab.id === 2);
  assert.equal(sleeping.title, "Production");
  assert.equal(sleeping.liveTitle, "Sign in");
  assert.deepEqual(Array.from(sleeping.previousTitles), ["Release dashboard"]);
  assert.equal(sleeping.sleeping, true);
});

test("activating a sleeping search result uses its ID and focuses its window without navigating its URL", async () => {
  const { api, calls, chrome } = await setup({
    tabs: [makeTab(1), makeTab(2, { discarded: true, windowId: 2 })]
  });
  assert.equal(await api.activateTab(2), true);
  assert.deepEqual(calls.updates, [{ id: 2, values: { active: true } }]);
  assert.deepEqual(calls.windows, [{ id: 2, values: { focused: true } }]);
  assert.deepEqual(chrome.storage.local.data.profileHistory, { entries: [1, 2], cursor: 1 });
});

test("selecting a known tab preserves forward history and activation events do not duplicate it", async () => {
  const { api, chrome } = await setup({
    tabs: [makeTab(1), makeTab(2), makeTab(3)],
    local: { profileHistory: { entries: [1, 2, 3], cursor: 2 } }
  });
  await api.activateTab(1);
  await api.recordActivation(1);
  assert.deepEqual(chrome.storage.local.data.profileHistory, { entries: [1, 2, 3], cursor: 0 });
  await api.navigateHistory(1);
  assert.equal(chrome.storage.local.data.profileHistory.cursor, 1);
});

test("a new search result starts a new forward path", async () => {
  const { api, chrome } = await setup({
    tabs: [1, 2, 3, 4].map((id) => makeTab(id)),
    local: { profileHistory: { entries: [1, 2, 3], cursor: 0 } }
  });
  await api.activateTab(4);
  assert.deepEqual(chrome.storage.local.data.profileHistory, { entries: [1, 4], cursor: 1 });
});

test("settings support every requested preset and enforce the chosen limit", async () => {
  const tabs = Array.from({ length: 205 }, (_, index) => makeTab(index + 1));
  const { api, chrome } = await setup({ tabs });
  assert.equal(await api.getHistoryLimit(), 20);
  for (const limit of [20, 50, 100, 150, 200]) {
    await api.setHistoryLimit(limit);
    for (const tab of tabs) {
      await api.recordActivation(tab.id);
    }
    assert.equal(await api.getHistoryLimit(), limit);
    assert.deepEqual(chrome.storage.local.data.profileHistory, {
      entries: tabs.slice(-limit).map((tab) => tab.id),
      cursor: limit - 1
    });
    assert.equal((await api.getPopupState()).allTabs.length, 205);
  }
  await assert.rejects(api.setHistoryLimit(75), /Choose a trail size/);
  assert.equal(await api.getHistoryLimit(), 200);
});

test("shrinking the trail retains its current position even after navigating backward", async () => {
  const { api, chrome } = await setup({
    tabs: Array.from({ length: 50 }, (_, index) => makeTab(index + 1)),
    local: {
      historyLimit: 50,
      profileHistory: { entries: Array.from({ length: 50 }, (_, index) => index + 1), cursor: 5 }
    }
  });
  await api.setHistoryLimit(20);
  const state = chrome.storage.local.data.profileHistory;
  assert.equal(state.entries.length, 20);
  assert.equal(state.entries[state.cursor], 6);
  assert.equal(state.cursor, 0);
});

test("earlier titles survive auth changes, discarded updates, and service-worker restarts", async () => {
  const { api, chrome, tabs } = await setup({ tabs: [makeTab(1, { title: "Release dashboard" })] });
  tabs.get(1).title = "Sign in";
  await api.rememberTab(tabs.get(1));
  tabs.get(1).discarded = true;
  tabs.get(1).title = "Sleeping tab";
  await api.rememberTab(tabs.get(1));
  const restarted = await setup({
    tabs: [...tabs.values()],
    local: chrome.storage.local.data,
    session: chrome.storage.session.data
  });
  const [tab] = (await restarted.api.getPopupState()).allTabs;
  assert.deepEqual(Array.from(tab.previousTitles), ["Sign in", "Release dashboard"]);
});

test("the title cache is bounded and ignores custom titles", async () => {
  const { api, chrome, tabs } = await setup();
  for (let index = 0; index < 8; index += 1) {
    tabs.get(1).title = `Document ${index}`;
    await api.rememberTab(tabs.get(1));
  }
  await api.renameTab(1, "Custom name");
  tabs.get(1).title = "Custom name";
  await api.rememberTab(tabs.get(1));
  assert.deepEqual(chrome.storage.session.data.tabMetadata["1"],
    ["Document 7", "Document 6", "Document 5", "Document 4", "Document 3"]);
});

test("sleeping tabs can be renamed and reset without waking them, and names are applied on wake", async () => {
  const { api, chrome, calls, tabs } = await setup({
    tabs: [makeTab(1), makeTab(2, { discarded: true })],
    session: { tabMetadata: { 2: ["Tab 2"] } }
  });
  await api.renameTab(2, "  Dashboard  ");
  assert.equal(chrome.storage.local.data.customNames["2"], "Dashboard");
  assert.equal((await api.getPopupState()).allTabs.find((tab) => tab.id === 2).title, "Dashboard");
  assert.equal(calls.messages.length, 0);
  assert.equal(calls.updates.length, 0);
  tabs.get(2).discarded = false;
  await api.reapplyCustomName(2);
  assert.deepEqual(calls.messages.at(-1), {
    id: 2, message: { type: "set-custom-title", name: "Dashboard" }
  });
  tabs.get(2).title = "Dashboard";
  tabs.get(2).frozen = true;
  await api.clearTabName(2);
  assert.equal(chrome.storage.local.data.customNames["2"], undefined);
  assert.equal((await api.getPopupState()).allTabs.find((tab) => tab.id === 2).title, "Tab 2");
  tabs.get(2).frozen = false;
  await api.reapplyCustomName(2);
  assert.deepEqual(calls.messages.at(-1), { id: 2, message: { type: "clear-custom-title" } });
});

test("popup rename targets its selected tab, not the active tab", async () => {
  const { api, calls } = await setup({ tabs: [makeTab(1), makeTab(2)] });
  await api.openRenameWindow(2);
  assert.equal(new URL(calls.createdWindows[0].url).searchParams.get("tabId"), "2");
});

test("browser replacement transfers a tab's trail position, name, and cached titles", async () => {
  const { api, chrome, tabs } = await setup({
    tabs: [makeTab(1), makeTab(2)],
    local: { profileHistory: { entries: [1, 2], cursor: 1 }, customNames: { 2: "Dashboard" } }
  });
  tabs.delete(2);
  tabs.set(9, makeTab(9));
  await api.replaceTabInState(9, 2);
  assert.deepEqual(chrome.storage.local.data.profileHistory, { entries: [1, 9], cursor: 1 });
  assert.equal(chrome.storage.local.data.customNames["9"], "Dashboard");
  assert.equal(chrome.storage.local.data.customNames["2"], undefined);
  assert.deepEqual(chrome.storage.session.data.tabMetadata["9"], ["Tab 2"]);
  assert.equal(chrome.storage.session.data.tabMetadata["2"], undefined);
});

test("closed tabs lose search metadata, and stale search selections report an error", async () => {
  const { api, chrome, tabs } = await setup({
    tabs: [makeTab(1), makeTab(2)],
    local: { customNames: { 2: "Dashboard" } }
  });
  tabs.delete(2);
  await api.removeTabFromState(2);
  assert.equal(chrome.storage.local.data.customNames["2"], undefined);
  assert.equal(chrome.storage.session.data.tabMetadata["2"], undefined);
  await assert.rejects(api.activateTab(2), /No tab with id/);
});

test("copy includes only highlighted tabs in the target window, in tab order, without waking sleepers", async () => {
  const { api, calls } = await setup({
    tabs: [
      makeTab(1, { index: 2 }),
      makeTab(2, { highlighted: true, discarded: true, index: 0 }),
      makeTab(3),
      makeTab(4, { highlighted: true, windowId: 2 }),
      makeTab(5, { highlighted: true, index: 3, url: "https://example.com/2" })
    ]
  });
  const result = await api.copySelectedTabs(1);
  assert.equal(result.count, 3);
  assert.deepEqual(calls.clipboard, [{
    target: "clipboard",
    type: "write-clipboard",
    text: "https://example.com/2\n\nhttps://example.com/1\n\nhttps://example.com/2"
  }]);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.windows.length, 0);
});

test("copy falls back to the focused normal window and supports pending and browser-page URLs", async () => {
  const { api, calls } = await setup({
    tabs: [
      makeTab(1, { url: "edge://settings/" }),
      makeTab(2, { highlighted: true, url: "", pendingUrl: "https://example.com/loading" })
    ]
  });
  assert.equal((await api.copySelectedTabs()).count, 2);
  assert.equal(calls.clipboard[0].text, "edge://settings/\n\nhttps://example.com/loading");
});

test("copying one tab does not add leading or trailing blank lines", async () => {
  const { api, calls } = await setup();
  await api.copySelectedTabs(1);
  assert.equal(calls.clipboard[0].text, "https://example.com/1");
});

test("copy rejects missing selections or addresses instead of silently copying a partial result", async () => {
  const empty = await setup({ tabs: [makeTab(1, { highlighted: false })] });
  await assert.rejects(empty.api.copySelectedTabs(1), /No selected tabs/);
  assert.equal(empty.calls.clipboardDocuments, 0);

  const missing = await setup({
    tabs: [makeTab(1), makeTab(2, { highlighted: true, url: "" })]
  });
  await assert.rejects(missing.api.copySelectedTabs(1), /address is unavailable/);
  assert.equal(missing.calls.clipboard.length, 0);
});

test("concurrent copies share one offscreen document", async () => {
  const { api, calls } = await setup();
  await Promise.all([api.copySelectedTabs(1), api.copySelectedTabs(1)]);
  assert.equal(calls.clipboardDocuments, 1);
  assert.equal(calls.clipboard.length, 2);
});

test("a failed offscreen creation is reported and does not prevent a later retry", async () => {
  const { api, chrome, calls } = await setup();
  const createDocument = chrome.offscreen.createDocument;
  chrome.offscreen.createDocument = async () => {
    throw new Error("Offscreen document creation failed.");
  };
  await assert.rejects(api.copySelectedTabs(1), /Offscreen document creation failed/);
  assert.equal(calls.clipboard.length, 0);
  chrome.offscreen.createDocument = createDocument;
  assert.equal((await api.copySelectedTabs(1)).count, 1);
  assert.equal(calls.clipboardDocuments, 1);
});

test("clipboard failures propagate to the popup and produce error feedback for shortcuts", async () => {
  const { api, calls } = await setup({ clipboardError: "Clipboard write was denied." });
  await assert.rejects(api.copySelectedTabs(1), /Clipboard write was denied/);
  await api.copySelectedTabsAndNotify(1);
  assert.deepEqual(calls.errors, ["Clipboard write was denied."]);
  assert.deepEqual(calls.badges, [{ text: "!" }]);
  assert.equal(calls.scripts.length, 0);
});

test("successful copying confirms the count only in the originating window's active tab", async () => {
  const { api, calls } = await setup({
    tabs: [
      makeTab(1),
      makeTab(2, { windowId: 2, active: true, highlighted: true }),
      makeTab(3, { windowId: 2, highlighted: true, discarded: true })
    ]
  });
  await api.copySelectedTabs(2);
  assert.equal(calls.scripts.length, 1);
  assert.deepEqual(calls.scripts[0].target, { tabId: 2 });
  assert.deepEqual(calls.scripts[0].args, [2]);
  assert.equal(calls.updates.length, 0);
});

test("browser-internal pages retain successful copy feedback without page injection", async () => {
  const { api, calls } = await setup({ tabs: [makeTab(1, { url: "edge://settings/" })] });
  await api.copySelectedTabsAndNotify(1);
  assert.equal(calls.scripts.length, 0);
  assert.deepEqual(calls.badges, [{ text: "1" }]);
  assert.deepEqual(calls.errors, []);
});

test("a prohibited page toast does not turn a successful copy into a clipboard error", async () => {
  const { api, chrome, calls } = await setup();
  chrome.scripting.executeScript = async () => {
    throw new Error("Cannot access this page.");
  };
  await api.copySelectedTabsAndNotify(1);
  assert.deepEqual(calls.badges, [{ text: "1" }]);
  assert.deepEqual(calls.errors, []);
  assert.match(calls.warnings[0], /Links copied, but.*Cannot access this page/);
});

test("the toast lasts 1500 ms and repeated copies replace it and restart the timer", async () => {
  const { api, calls } = await setup();
  await api.copySelectedTabs(1);
  const hosts = [];
  const timers = new Map();
  let now = 0;
  let nextTimer = 0;
  const context = vm.createContext({
    document: {
      documentElement: { append: (host) => hosts.push(host) },
      createElement() {
        return {
          style: {},
          setAttribute() {},
          attachShadow() {
            this.shadowRoot = { children: [], append(child) { this.children.push(child); } };
            return this.shadowRoot;
          },
          remove() {
            const index = hosts.indexOf(this);
            if (index >= 0) hosts.splice(index, 1);
          }
        };
      }
    },
    setTimeout(callback, duration) {
      const id = ++nextTimer;
      timers.set(id, { callback, deadline: now + duration });
      return id;
    },
    clearTimeout: (id) => timers.delete(id)
  });
  const show = (count) => vm.runInContext(`(${calls.scripts[0].func.toString()})(${count})`, context);
  function advance(duration) {
    now += duration;
    for (const [id, timer] of timers) {
      if (timer.deadline <= now) {
        timers.delete(id);
        timer.callback();
      }
    }
  }
  show(2);
  assert.equal(hosts[0].shadowRoot.children[0].textContent, "Copied 2 selected tab links.");
  advance(1499);
  assert.equal(hosts.length, 1);
  advance(1);
  assert.equal(hosts.length, 0);

  show(1);
  advance(1000);
  show(3);
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].shadowRoot.children[0].textContent, "Copied 3 selected tab links.");
  advance(500);
  assert.equal(hosts.length, 1);
  advance(1000);
  assert.equal(hosts.length, 0);
});

test("background leaves clipboard-targeted messages for the offscreen document", async () => {
  const { chrome } = await setup();
  let responded = false;
  const handled = chrome.runtime.onMessage.listeners[0](
    { target: "clipboard", type: "write-clipboard", text: "https://example.com" },
    {},
    () => { responded = true; }
  );
  assert.equal(handled, false);
  assert.equal(responded, false);
});

test("copy menus register for tabs, pages, and the extension action", async () => {
  const { api, calls } = await setup();
  await api.createCopyMenus();
  assert.deepEqual(calls.menus, [
    { id: "copy-selected-tabs", title: "Copy selected tab links", contexts: ["page", "action"] },
    { id: "copy-selected-tabs-in-strip", title: "Copy selected tab links", contexts: ["tab"] }
  ]);
});

test("older browsers retain page and action menus and log unsupported tab-menu registration", async () => {
  const { api, chrome, calls } = await setup();
  const createMenu = chrome.contextMenus.create;
  chrome.contextMenus.create = (properties, callback) => {
    if (properties.contexts.includes("tab")) {
      throw new TypeError("Unsupported tab context.");
    }
    return createMenu(properties, callback);
  };
  await api.createCopyMenus();
  assert.equal(calls.menus.length, 1);
  assert.deepEqual(calls.menus[0].contexts, ["page", "action"]);
  assert.match(calls.warnings[0], /Tab-strip copy menu unavailable.*Unsupported tab context/);
});
