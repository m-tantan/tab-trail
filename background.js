const HISTORY_LIMIT = 20;
const HISTORY_KEY = "profileHistory";
const LEGACY_HISTORY_PREFIX = "windowHistory:";
const CUSTOM_NAMES_KEY = "customNames";

let historyLock = Promise.resolve();

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

async function getExistingTabIds() {
  const tabs = await chrome.tabs.query({});
  return new Set(tabs.map((tab) => tab.id).filter(Number.isInteger));
}

async function pruneHistory(state) {
  const existingIds = await getExistingTabIds();
  const currentTabId = state.entries[state.cursor];
  const entries = state.entries.filter((tabId) => existingIds.has(tabId));
  const cursor = currentTabId === undefined ? entries.length - 1 : entries.indexOf(currentTabId);

  return {
    entries,
    cursor: cursor >= 0 ? cursor : entries.length - 1
  };
}

async function recordActivation(tabId) {
  return withHistoryLock(async () => {
    const tab = await chrome.tabs.get(tabId);
    const tabUrl = tab.url || tab.pendingUrl || "";
    if (tabUrl.startsWith(chrome.runtime.getURL(""))) {
      return;
    }

    let state = await pruneHistory(await loadHistory());
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
    await saveHistory(state);
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
  const name = await getCustomName(tabId);
  if (!name) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, { type: "set-custom-title", name });
  } catch {
    // Restricted browser pages cannot receive content-script messages.
  }
}

async function openRenameWindow() {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!activeTab || !Number.isInteger(activeTab.id)) {
    throw new Error("No active tab is available.");
  }

  const url = new URL(chrome.runtime.getURL("rename.html"));
  url.searchParams.set("tabId", String(activeTab.id));
  await chrome.windows.create({
    url: url.href,
    type: "popup",
    width: 380,
    height: 280,
    focused: true
  });
}

async function getRenameState(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return {
    tabId,
    title: tab.title || tab.url || "Untitled tab",
    url: tab.url || "",
    customName: await getCustomName(tabId)
  };
}

async function getPopupState() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || !Number.isInteger(activeTab.id)) {
    throw new Error("No active tab is available.");
  }

  const state = await withHistoryLock(async () => {
    const nextState = await pruneHistory(await loadHistory());
    await saveHistory(nextState);
    return nextState;
  });

  const tabs = await Promise.all(
    state.entries.map(async (tabId) => {
      try {
        const tab = await chrome.tabs.get(tabId);
        return {
          id: tab.id,
          title: tab.title || tab.url || "Untitled tab",
          url: tab.url || "",
          favIconUrl: tab.favIconUrl || "",
          windowId: tab.windowId
        };
      } catch {
        return null;
      }
    })
  );

  return {
    activeTabId: activeTab.id,
    activeWindowId: activeTab.windowId,
    cursor: state.cursor,
    entries: tabs.filter(Boolean)
  };
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
  });

  await removeCustomName(tabId);
}

async function initializeProfileHistory() {
  const stored = await chrome.storage.local.get(null);
  const legacyKeys = Object.keys(stored).filter((key) =>
    key.startsWith(LEGACY_HISTORY_PREFIX)
  );

  await withHistoryLock(async () => {
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
        entries: entries.slice(-HISTORY_LIMIT),
        cursor: Math.min(entries.length, HISTORY_LIMIT) - 1
      };
    }

    if (state.entries.length === 0) {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTab && Number.isInteger(activeTab.id)) {
        state = { entries: [activeTab.id], cursor: 0 };
      }
    }

    await saveHistory(state);
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    reapplyCustomName(tabId).catch(console.error);
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "rename-current-tab") {
    openRenameWindow().catch(console.error);
  } else if (command === "navigate-back") {
    navigateHistory(-1).catch(console.error);
  } else if (command === "navigate-forward") {
    navigateHistory(1).catch(console.error);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  initializeProfileHistory().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  initializeProfileHistory().catch(console.error);
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
          moved: await activateHistoryIndex(message.index)
        };
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
