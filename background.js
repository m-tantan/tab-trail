const HISTORY_LIMIT = 20;
const CUSTOM_NAMES_KEY = "customNames";
const HISTORY_PREFIX = "windowHistory:";

const suppressedActivations = new Map();
const windowLocks = new Map();

function historyKey(windowId) {
  return `${HISTORY_PREFIX}${windowId}`;
}

async function withWindowLock(windowId, operation) {
  const previous = windowLocks.get(windowId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  windowLocks.set(windowId, current);

  try {
    return await current;
  } finally {
    if (windowLocks.get(windowId) === current) {
      windowLocks.delete(windowId);
    }
  }
}

async function loadHistory(windowId) {
  const key = historyKey(windowId);
  const stored = await chrome.storage.local.get(key);
  const state = stored[key];

  if (!state || !Array.isArray(state.entries)) {
    return { entries: [], cursor: -1 };
  }

  return {
    entries: state.entries.filter(Number.isInteger),
    cursor: Number.isInteger(state.cursor) ? state.cursor : state.entries.length - 1
  };
}

async function saveHistory(windowId, state) {
  await chrome.storage.local.set({ [historyKey(windowId)]: state });
}

async function getExistingTabIds(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return new Set(tabs.map((tab) => tab.id).filter(Number.isInteger));
}

async function pruneHistory(windowId, state) {
  const existingIds = await getExistingTabIds(windowId);
  const currentTabId = state.entries[state.cursor];
  const entries = state.entries.filter((tabId) => existingIds.has(tabId));
  const cursor = currentTabId === undefined ? entries.length - 1 : entries.indexOf(currentTabId);

  return {
    entries,
    cursor: cursor >= 0 ? cursor : entries.length - 1
  };
}

async function recordActivation(windowId, tabId) {
  return withWindowLock(windowId, async () => {
    const suppressedTabId = suppressedActivations.get(windowId);
    if (suppressedTabId === tabId) {
      suppressedActivations.delete(windowId);
      return;
    }

    let state = await pruneHistory(windowId, await loadHistory(windowId));
    if (state.entries[state.cursor] === tabId) {
      return;
    }

    if (state.cursor < state.entries.length - 1) {
      state.entries = state.entries.slice(0, state.cursor + 1);
    }

    state.entries = state.entries.filter((entry) => entry !== tabId);
    state.entries.push(tabId);

    if (state.entries.length > HISTORY_LIMIT) {
      state.entries = state.entries.slice(-HISTORY_LIMIT);
    }

    state.cursor = state.entries.length - 1;
    await saveHistory(windowId, state);
  });
}

async function activateHistoryIndex(windowId, requestedIndex) {
  return withWindowLock(windowId, async () => {
    const state = await pruneHistory(windowId, await loadHistory(windowId));
    if (requestedIndex < 0 || requestedIndex >= state.entries.length) {
      await saveHistory(windowId, state);
      return false;
    }

    const tabId = state.entries[requestedIndex];
    suppressedActivations.set(windowId, tabId);
    state.cursor = requestedIndex;
    await saveHistory(windowId, state);

    try {
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(windowId, { focused: true });
      return true;
    } catch (error) {
      suppressedActivations.delete(windowId);
      throw error;
    }
  });
}

async function navigateHistory(direction) {
  const currentWindow = await chrome.windows.getLastFocused();
  const state = await pruneHistory(currentWindow.id, await loadHistory(currentWindow.id));
  await saveHistory(currentWindow.id, state);

  const targetIndex = state.cursor + direction;
  if (targetIndex < 0 || targetIndex >= state.entries.length) {
    return false;
  }

  return activateHistoryIndex(currentWindow.id, targetIndex);
}

async function getCustomNames() {
  const stored = await chrome.storage.local.get(CUSTOM_NAMES_KEY);
  return stored[CUSTOM_NAMES_KEY] || {};
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
  if (!trimmedName) {
    throw new Error("Enter a tab name.");
  }

  await sendTitleMessage(tabId, { type: "set-custom-title", name: trimmedName });
  await setCustomName(tabId, trimmedName);
}

async function clearTabName(tabId) {
  await sendTitleMessage(tabId, { type: "clear-custom-title" });
  await removeCustomName(tabId);
}

async function reapplyCustomName(tabId) {
  const names = await getCustomNames();
  const name = names[String(tabId)];
  if (!name) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, { type: "set-custom-title", name });
  } catch {
    // Restricted browser pages cannot receive content-script messages.
  }
}

async function getPopupState() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || !Number.isInteger(activeTab.id)) {
    throw new Error("No active tab is available.");
  }

  const state = await pruneHistory(activeTab.windowId, await loadHistory(activeTab.windowId));
  await saveHistory(activeTab.windowId, state);

  const tabs = await Promise.all(
    state.entries.map(async (tabId) => {
      try {
        const tab = await chrome.tabs.get(tabId);
        return {
          id: tab.id,
          title: tab.title || tab.url || "Untitled tab",
          url: tab.url || "",
          favIconUrl: tab.favIconUrl || ""
        };
      } catch {
        return null;
      }
    })
  );

  const names = await getCustomNames();
  return {
    activeTabId: activeTab.id,
    activeWindowId: activeTab.windowId,
    customName: names[String(activeTab.id)] || "",
    cursor: state.cursor,
    entries: tabs.filter(Boolean)
  };
}

async function removeTabFromState(tabId) {
  const stored = await chrome.storage.local.get(null);
  const updates = {};

  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith(HISTORY_PREFIX) || !Array.isArray(value.entries)) {
      continue;
    }

    const currentTabId = value.entries[value.cursor];
    const entries = value.entries.filter((entry) => entry !== tabId);
    updates[key] = {
      entries,
      cursor: Math.max(0, entries.indexOf(currentTabId))
    };

    if (entries.length === 0) {
      updates[key].cursor = -1;
    } else if (updates[key].cursor < 0) {
      updates[key].cursor = entries.length - 1;
    }
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }

  await removeCustomName(tabId);
}

async function initializeOpenWindows() {
  const windows = await chrome.windows.getAll({ populate: true });
  const openWindowIds = new Set(windows.map((window) => window.id));
  const stored = await chrome.storage.local.get(null);
  const staleKeys = Object.keys(stored).filter((key) => {
    if (!key.startsWith(HISTORY_PREFIX)) {
      return false;
    }
    return !openWindowIds.has(Number(key.slice(HISTORY_PREFIX.length)));
  });

  if (staleKeys.length > 0) {
    await chrome.storage.local.remove(staleKeys);
  }

  await Promise.all(
    windows.map(async (window) => {
      const activeTab = window.tabs?.find((tab) => tab.active);
      if (!activeTab || !Number.isInteger(activeTab.id)) {
        return;
      }

      const state = await pruneHistory(window.id, await loadHistory(window.id));
      if (state.entries.length === 0) {
        await saveHistory(window.id, { entries: [activeTab.id], cursor: 0 });
      } else {
        await saveHistory(window.id, state);
      }
    })
  );
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  recordActivation(windowId, tabId).catch(console.error);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    reapplyCustomName(tabId).catch(console.error);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTabFromState(tabId).catch(console.error);
});

chrome.windows.onRemoved.addListener((windowId) => {
  suppressedActivations.delete(windowId);
  chrome.storage.local.remove(historyKey(windowId)).catch(console.error);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "history-back") {
    navigateHistory(-1).catch(console.error);
  } else if (command === "history-forward") {
    navigateHistory(1).catch(console.error);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  initializeOpenWindows().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  initializeOpenWindows().catch(console.error);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const respond = async () => {
    switch (message.type) {
      case "get-popup-state":
        return getPopupState();
      case "navigate-history":
        return { moved: await navigateHistory(message.direction) };
      case "activate-history-index":
        return {
          moved: await activateHistoryIndex(message.windowId, message.index)
        };
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

initializeOpenWindows().catch(console.error);
