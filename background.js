const DEFAULT_HISTORY_LIMIT = 20;
const HISTORY_LIMITS = [20, 50, 100, 150, 200];
const HISTORY_LIMIT_KEY = "historyLimit";
const HISTORY_KEY = "profileHistory";
const LEGACY_HISTORY_PREFIX = "windowHistory:";
const CUSTOM_NAMES_KEY = "customNames";
const TAB_METADATA_KEY = "tabMetadata";

let historyLock = Promise.resolve();
let clipboardCreation;
let copyBadgeTimer;

function showCopyToast(count) {
  const previous = globalThis.tabTrailCopyConfirmation;
  clearTimeout(previous?.timer);
  previous?.element.remove();

  const host = document.createElement("div");
  host.id = "tab-trail-copy-confirmation";
  host.style.cssText = `
    all: initial !important;
    position: fixed !important;
    right: 24px !important;
    bottom: 24px !important;
    z-index: 2147483647 !important;
    pointer-events: none !important;
  `;
  const shadow = host.attachShadow({ mode: "open" });
  const label = document.createElement("div");
  label.setAttribute("role", "status");
  label.setAttribute("aria-live", "polite");
  label.textContent = `Copied ${count} selected tab link${count === 1 ? "" : "s"}.`;
  label.style.cssText = `
    padding: 12px 16px;
    border: 1px solid #53617a;
    border-radius: 10px;
    background: #172033;
    color: #ffffff;
    box-shadow: 0 6px 24px #00000033;
    font: 14px/1.5 "Segoe UI", system-ui, sans-serif;
  `;
  shadow.append(label);
  document.documentElement.append(host);
  const state = { element: host };
  state.timer = setTimeout(() => {
    host.remove();
    if (globalThis.tabTrailCopyConfirmation === state) {
      delete globalThis.tabTrailCopyConfirmation;
    }
  }, 1500);
  globalThis.tabTrailCopyConfirmation = state;
}

async function showCopyConfirmation(windowId, count) {
  const [tab] = await chrome.tabs.query({ windowId, active: true });
  if (!tab || tab.discarded || tab.frozen || !/^(https?:|file:)/.test(tab.url || "")) {
    return;
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    injectImmediately: true,
    func: showCopyToast,
    args: [count]
  });
}

async function ensureClipboardDocument() {
  if (clipboardCreation) {
    await clipboardCreation;
    return;
  }
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL("clipboard.html")]
  });
  if (contexts.length > 0) {
    return;
  }

  if (!clipboardCreation) {
    clipboardCreation = chrome.offscreen.createDocument({
      url: "clipboard.html",
      reasons: ["CLIPBOARD"],
      justification: "Copy the URLs of the tabs selected by the user."
    }).finally(() => {
      clipboardCreation = undefined;
    });
  }
  await clipboardCreation;
}

async function copySelectedTabs(windowId) {
  if (!Number.isInteger(windowId)) {
    const window = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    windowId = window.id;
  }
  const tabs = await chrome.tabs.query({ windowId, highlighted: true });
  if (tabs.length === 0) {
    throw new Error("No selected tabs are available in this window.");
  }
  tabs.sort((left, right) => left.index - right.index);
  const urls = tabs.map((tab) => tab.pendingUrl || tab.url);
  if (urls.some((url) => typeof url !== "string" || !url)) {
    throw new Error("A selected tab's address is unavailable. Try again after it loads.");
  }

  await ensureClipboardDocument();
  const response = await chrome.runtime.sendMessage({
    target: "clipboard",
    type: "write-clipboard",
    text: urls.join("\n\n")
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Tab Trail could not copy the selected tab links.");
  }
  try {
    await showCopyConfirmation(windowId, tabs.length);
  } catch (error) {
    console.warn("Links copied, but the page confirmation could not be shown.", error);
  }
  return { count: tabs.length };
}

async function showCopyStatus(text, title, isError = false) {
  clearTimeout(copyBadgeTimer);
  await chrome.action.setBadgeBackgroundColor({ color: isError ? "#b42318" : "#166534" });
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title });
  copyBadgeTimer = setTimeout(() => {
    Promise.all([
      chrome.action.setBadgeText({ text: "" }),
      chrome.action.setTitle({ title: "Tab Trail" })
    ]).catch(console.error);
  }, 3000);
}

async function copySelectedTabsAndNotify(windowId) {
  try {
    const { count } = await copySelectedTabs(windowId);
    await showCopyStatus(String(count), `Copied ${count} selected tab link${count === 1 ? "" : "s"}.`);
  } catch (error) {
    console.error(error);
    await showCopyStatus("!", `Copy failed: ${error.message}`, true);
  }
}

function createContextMenu(properties) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(properties, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

async function createCopyMenus() {
  await new Promise((resolve, reject) => {
    chrome.contextMenus.removeAll(() => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
  await createContextMenu({
    id: "copy-selected-tabs",
    title: "Copy selected tab links",
    contexts: ["page", "action"]
  });
  try {
    await createContextMenu({
      id: "copy-selected-tabs-in-strip",
      title: "Copy selected tab links",
      contexts: ["tab"]
    });
  } catch (error) {
    console.warn("Tab-strip copy menu unavailable; use the popup, toolbar, or page menu instead.", error);
  }
}

async function withHistoryLock(operation) {
  const current = historyLock.catch(() => {}).then(operation);
  historyLock = current;

  try {
    return await current;
  } finally {
    if (historyLock === current) {
      historyLock = Promise.resolve();
    }
  }
}

async function loadHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const state = stored[HISTORY_KEY];

  if (!state || !Array.isArray(state.entries)) {
    return { entries: [], cursor: -1 };
  }

  return {
    entries: state.entries.filter(Number.isInteger),
    cursor: Number.isInteger(state.cursor) ? state.cursor : state.entries.length - 1
  };
}

async function saveHistory(state) {
  await chrome.storage.local.set({ [HISTORY_KEY]: state });
}

async function getHistoryLimit() {
  const stored = await chrome.storage.local.get(HISTORY_LIMIT_KEY);
  return HISTORY_LIMITS.includes(stored[HISTORY_LIMIT_KEY])
    ? stored[HISTORY_LIMIT_KEY]
    : DEFAULT_HISTORY_LIMIT;
}

function trimHistory(state, limit) {
  const start = Math.min(
    Math.max(0, state.entries.length - limit),
    Math.max(0, state.cursor)
  );
  return {
    entries: state.entries.slice(start, start + limit),
    cursor: state.cursor - start
  };
}

async function setHistoryLimit(limit) {
  if (!HISTORY_LIMITS.includes(limit)) {
    throw new Error("Choose a trail size of 20, 50, 100, 150, or 200 tabs.");
  }

  await withHistoryLock(async () => {
    const state = await pruneHistory(await loadHistory());
    await chrome.storage.local.set({
      [HISTORY_LIMIT_KEY]: limit,
      [HISTORY_KEY]: trimHistory(state, limit)
    });
  });
}

async function getExistingTabIds() {
  const tabs = await chrome.tabs.query({});
  return new Set(tabs.map((tab) => tab.id).filter(Number.isInteger));
}

async function pruneHistory(state, tabs) {
  const existingIds = tabs
    ? new Set(tabs.map((tab) => tab.id))
    : await getExistingTabIds();
  const currentTabId = state.entries[state.cursor];
  const entries = state.entries.filter((tabId) => existingIds.has(tabId));
  const cursor = currentTabId === undefined ? entries.length - 1 : entries.indexOf(currentTabId);

  return trimHistory({
    entries,
    cursor: cursor >= 0 ? cursor : entries.length - 1
  }, await getHistoryLimit());
}

function isExtensionTab(tab) {
  return (tab.url || tab.pendingUrl || "").startsWith(chrome.runtime.getURL(""));
}

async function appendActivation(state, tabId) {
  state.entries = state.entries.slice(0, state.cursor + 1).filter((entry) => entry !== tabId);
  state.entries.push(tabId);
  state.entries = state.entries.slice(-await getHistoryLimit());
  state.cursor = state.entries.length - 1;
  await saveHistory(state);
}

async function recordActivation(tabId) {
  return withHistoryLock(async () => {
    const tab = await chrome.tabs.get(tabId);
    if (isExtensionTab(tab)) {
      return;
    }

    const state = await pruneHistory(await loadHistory());
    if (state.entries[state.cursor] === tabId) {
      return;
    }

    await appendActivation(state, tabId);
  });
}

async function activateHistoryIndexUnlocked(requestedIndex) {
  const state = await pruneHistory(await loadHistory());
  if (requestedIndex < 0 || requestedIndex >= state.entries.length) {
    await saveHistory(state);
    return false;
  }

  const tabId = state.entries[requestedIndex];
  const tab = await chrome.tabs.get(tabId);
  state.cursor = requestedIndex;
  await saveHistory(state);

  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return true;
}

async function activateHistoryIndex(requestedIndex) {
  return withHistoryLock(() => activateHistoryIndexUnlocked(requestedIndex));
}

async function activateTab(tabId) {
  if (!Number.isInteger(tabId)) {
    throw new Error("The selected tab is unavailable.");
  }

  return withHistoryLock(async () => {
    const tab = await chrome.tabs.get(tabId);
    const state = await pruneHistory(await loadHistory());
    const index = state.entries.indexOf(tabId);
    if (index >= 0) {
      state.cursor = index;
      await saveHistory(state);
    } else {
      await appendActivation(state, tabId);
    }

    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return true;
  });
}

async function navigateHistory(direction) {
  return withHistoryLock(async () => {
    const state = await pruneHistory(await loadHistory());
    await saveHistory(state);
    return activateHistoryIndexUnlocked(state.cursor + direction);
  });
}

async function getCustomNames() {
  const stored = await chrome.storage.local.get(CUSTOM_NAMES_KEY);
  return stored[CUSTOM_NAMES_KEY] || {};
}

async function getTabMetadata() {
  const stored = await chrome.storage.session.get(TAB_METADATA_KEY);
  return stored[TAB_METADATA_KEY] || {};
}

function rememberTitle(metadata, tab, names) {
  if (isExtensionTab(tab) || tab.discarded || tab.frozen || !tab.title ||
      tab.title === names[String(tab.id)]) {
    return;
  }

  const previous = metadata[String(tab.id)] || [];
  metadata[String(tab.id)] = [tab.title, ...previous.filter((title) => title !== tab.title)].slice(0, 5);
}

async function rememberTab(tab) {
  await withHistoryLock(async () => {
    const metadata = await getTabMetadata();
    rememberTitle(metadata, tab, await getCustomNames());
    await chrome.storage.session.set({ [TAB_METADATA_KEY]: metadata });
  });
}

async function getCustomName(tabId) {
  const names = await getCustomNames();
  return names[String(tabId)] || "";
}

async function setCustomName(tabId, name) {
  const names = await getCustomNames();
  names[String(tabId)] = name;
  await chrome.storage.local.set({ [CUSTOM_NAMES_KEY]: names });
}

async function removeCustomName(tabId) {
  const names = await getCustomNames();
  delete names[String(tabId)];
  await chrome.storage.local.set({ [CUSTOM_NAMES_KEY]: names });
}

async function sendTitleMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    throw new Error("This browser page does not allow extensions to change its title.");
  }
}

async function renameTab(tabId, name) {
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > 120) {
    throw new Error("Enter a tab name of 1 to 120 characters.");
  }

  await withHistoryLock(async () => {
    const tab = await chrome.tabs.get(tabId);
    if (tab.discarded || tab.frozen) {
      if (!/^https?:/.test(tab.url || "")) {
        throw new Error("This sleeping browser page cannot be renamed.");
      }
    } else {
      await sendTitleMessage(tabId, { type: "set-custom-title", name: trimmedName });
    }
    const metadata = await getTabMetadata();
    rememberTitle(metadata, tab, await getCustomNames());
    await chrome.storage.session.set({ [TAB_METADATA_KEY]: metadata });
    await setCustomName(tabId, trimmedName);
  });
}

async function clearTabName(tabId) {
  await withHistoryLock(async () => {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.discarded && !tab.frozen) {
      await sendTitleMessage(tabId, { type: "clear-custom-title" });
    }
    await removeCustomName(tabId);
  });
}

async function reapplyCustomName(tabId) {
  const name = await getCustomName(tabId);
  try {
    await chrome.tabs.sendMessage(tabId, name
      ? { type: "set-custom-title", name }
      : { type: "clear-custom-title" });
  } catch {
    // Restricted browser pages cannot receive content-script messages.
  }
}

async function openRenameWindow(tabId) {
  const tab = Number.isInteger(tabId)
    ? await chrome.tabs.get(tabId)
    : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab || !Number.isInteger(tab.id)) {
    throw new Error("No active tab is available.");
  }

  const url = new URL(chrome.runtime.getURL("rename.html"));
  url.searchParams.set("tabId", String(tab.id));
  await chrome.windows.create({
    url: url.href,
    type: "popup",
    width: 380,
    height: 340,
    focused: true
  });
}

async function getRenameState(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return {
    tabId,
    title: tab.title || tab.url || "Untitled tab",
    url: tab.url || "",
    customName: await getCustomName(tabId),
    sleeping: Boolean(tab.discarded || tab.frozen)
  };
}

async function getPopupState() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || !Number.isInteger(activeTab.id)) {
    throw new Error("No active tab is available.");
  }

  return withHistoryLock(async () => {
    const openTabs = (await chrome.tabs.query({})).filter((tab) => !isExtensionTab(tab));
    const nextState = await pruneHistory(await loadHistory(), openTabs);
    await saveHistory(nextState);
    const names = await getCustomNames();
    const metadata = await getTabMetadata();
    const tabs = openTabs.map((tab) => {
      const previousTitles = metadata[String(tab.id)] || [];
      const sleeping = Boolean(tab.discarded || tab.frozen);
      return {
        id: tab.id,
        title: names[String(tab.id)] || (sleeping && previousTitles[0]) ||
          tab.title || previousTitles[0] || tab.url || "Untitled tab",
        liveTitle: tab.title || "",
        previousTitles,
        url: tab.url || tab.pendingUrl || "",
        favIconUrl: tab.favIconUrl || "",
        windowId: tab.windowId,
        sleeping,
        lastAccessed: tab.lastAccessed || 0
      };
    });
    const byId = new Map(tabs.map((tab) => [tab.id, tab]));
    const entries = nextState.entries.map((tabId) => byId.get(tabId));
    const recentIds = [...nextState.entries].reverse();
    tabs.sort((left, right) => {
      const leftIndex = recentIds.indexOf(left.id);
      const rightIndex = recentIds.indexOf(right.id);
      if (leftIndex >= 0 || rightIndex >= 0) {
        return (leftIndex < 0 ? Infinity : leftIndex) - (rightIndex < 0 ? Infinity : rightIndex);
      }
      return right.lastAccessed - left.lastAccessed;
    });

    return {
      activeTabId: activeTab.id,
      activeWindowId: activeTab.windowId,
      cursor: nextState.cursor,
      historyLimit: await getHistoryLimit(),
      entries,
      allTabs: tabs
    };
  });
}

async function removeTabFromState(tabId) {
  await withHistoryLock(async () => {
    const state = await loadHistory();
    const removedIndex = state.entries.indexOf(tabId);
    const entries = state.entries.filter((entry) => entry !== tabId);
    let cursor = state.cursor;

    if (removedIndex >= 0 && removedIndex < cursor) {
      cursor -= 1;
    } else if (removedIndex === cursor) {
      cursor = Math.min(cursor, entries.length - 1);
    }

    const nextState = {
      entries,
      cursor: Math.max(-1, Math.min(cursor, entries.length - 1))
    };

    if (entries.length === 0) {
      nextState.cursor = -1;
    }

    await saveHistory(nextState);
    await removeCustomName(tabId);
    const metadata = await getTabMetadata();
    delete metadata[String(tabId)];
    await chrome.storage.session.set({ [TAB_METADATA_KEY]: metadata });
  });
}

async function replaceTabInState(addedTabId, removedTabId) {
  await withHistoryLock(async () => {
    const state = await loadHistory();
    const currentTabId = state.entries[state.cursor];
    state.entries = [...new Set(state.entries.map((id) => id === removedTabId ? addedTabId : id))];
    state.cursor = state.entries.indexOf(currentTabId === removedTabId ? addedTabId : currentTabId);
    await saveHistory(state);
    const names = await getCustomNames();
    if (names[String(removedTabId)]) {
      names[String(addedTabId)] = names[String(removedTabId)];
    }
    delete names[String(removedTabId)];
    await chrome.storage.local.set({ [CUSTOM_NAMES_KEY]: names });
    const metadata = await getTabMetadata();
    if (metadata[String(removedTabId)]) {
      metadata[String(addedTabId)] = metadata[String(removedTabId)];
    }
    delete metadata[String(removedTabId)];
    await chrome.storage.session.set({ [TAB_METADATA_KEY]: metadata });
  });
  await reapplyCustomName(addedTabId);
}

async function initializeProfileHistory() {
  const stored = await chrome.storage.local.get(null);
  const legacyKeys = Object.keys(stored).filter((key) =>
    key.startsWith(LEGACY_HISTORY_PREFIX)
  );

  await withHistoryLock(async () => {
    const limit = await getHistoryLimit();
    let state = await pruneHistory(await loadHistory());

    if (state.entries.length === 0 && legacyKeys.length > 0) {
      const existingIds = await getExistingTabIds();
      const entries = [];

      for (const key of legacyKeys) {
        const legacyEntries = stored[key]?.entries;
        if (!Array.isArray(legacyEntries)) {
          continue;
        }

        for (const tabId of legacyEntries) {
          if (!existingIds.has(tabId)) {
            continue;
          }
          const existingIndex = entries.indexOf(tabId);
          if (existingIndex >= 0) {
            entries.splice(existingIndex, 1);
          }
          entries.push(tabId);
        }
      }

      state = {
        entries: entries.slice(-limit),
        cursor: Math.min(entries.length, limit) - 1
      };
    }

    if (state.entries.length === 0) {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTab && Number.isInteger(activeTab.id) && !isExtensionTab(activeTab)) {
        state = { entries: [activeTab.id], cursor: 0 };
      }
    }

    await saveHistory(state);
    const tabs = await chrome.tabs.query({});
    const names = await getCustomNames();
    const metadata = await getTabMetadata();
    const existingIds = new Set(tabs.map((tab) => String(tab.id)));
    for (const id of Object.keys(metadata)) {
      if (!existingIds.has(id)) {
        delete metadata[id];
      }
    }
    for (const tab of tabs) {
      rememberTitle(metadata, tab, names);
    }
    await chrome.storage.session.set({ [TAB_METADATA_KEY]: metadata });
  });

  if (legacyKeys.length > 0) {
    await chrome.storage.local.remove(legacyKeys);
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  recordActivation(tabId).catch(console.error);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  chrome.tabs
    .query({ active: true, windowId })
    .then(([tab]) => {
      if (tab && Number.isInteger(tab.id)) {
        return recordActivation(tab.id);
      }
      return undefined;
    })
    .catch(console.error);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTabFromState(tabId).catch(console.error);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  replaceTabInState(addedTabId, removedTabId).catch(console.error);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.title || changeInfo.status === "complete" || changeInfo.discarded === false) {
    rememberTab(tab).catch(console.error);
  }
  if (!tab.discarded && !tab.frozen &&
      (changeInfo.status === "complete" || changeInfo.discarded === false || changeInfo.frozen === false)) {
    reapplyCustomName(tabId).catch(console.error);
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "rename-current-tab") {
    openRenameWindow().catch(console.error);
  } else if (command === "navigate-back") {
    navigateHistory(-1).catch(console.error);
  } else if (command === "navigate-forward") {
    navigateHistory(1).catch(console.error);
  } else if (command === "copy-selected-tabs") {
    copySelectedTabsAndNotify(tab?.windowId).catch(console.error);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "copy-selected-tabs" || info.menuItemId === "copy-selected-tabs-in-strip") {
    copySelectedTabsAndNotify(tab?.windowId).catch(console.error);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  initializeProfileHistory().catch(console.error);
  createCopyMenus().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  initializeProfileHistory().catch(console.error);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target === "clipboard") {
    return false;
  }
  const respond = async () => {
    switch (message.type) {
      case "get-popup-state":
        return getPopupState();
      case "navigate-history":
        return { moved: await navigateHistory(message.direction) };
      case "activate-history-index":
        return {
          moved: await activateHistoryIndex(message.index)
        };
      case "activate-tab":
        return { moved: await activateTab(message.tabId) };
      case "open-rename-window":
        await openRenameWindow(message.tabId);
        return { success: true };
      case "get-settings":
        return { historyLimit: await getHistoryLimit() };
      case "set-history-limit":
        await setHistoryLimit(message.limit);
        return { success: true };
      case "copy-selected-tabs":
        return copySelectedTabs(message.windowId);
      case "get-rename-state":
        return getRenameState(message.tabId);
      case "rename-tab":
        await renameTab(message.tabId, message.name);
        return { success: true };
      case "clear-tab-name":
        await clearTabName(message.tabId);
        return { success: true };
      default:
        throw new Error("Unknown Tab Trail request.");
    }
  };

  respond()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

initializeProfileHistory().catch(console.error);
