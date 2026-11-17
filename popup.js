const backButton = document.querySelector("#history-back");
const forwardButton = document.querySelector("#history-forward");
const shortcutsButton = document.querySelector("#shortcuts-button");
const historyList = document.querySelector("#history-list");
const emptyHistory = document.querySelector("#empty-history");
const statusElement = document.querySelector("#status");
const searchInput = document.querySelector("#tab-search");
const historyHeading = document.querySelector("#history-heading");
const resultCount = document.querySelector("#result-count");
const copyTabsButton = document.querySelector("#copy-selected-tabs");
const reloadNotice = document.querySelector("#reload-notice");
const reloadButton = document.querySelector("#reload-extension");
const extensionVersion = document.querySelector("#extension-version");

let popupState;
let needsReload = false;

function showReloadRequired() {
  needsReload = true;
  reloadNotice.hidden = false;
  document.body.classList.add("needs-reload");
  copyTabsButton.disabled = true;
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    if (message.type === "copy-selected-tabs" && response?.error === "Unknown Tab Trail request.") {
      showReloadRequired();
      throw new Error("Reload Tab Trail to load the updated copy command.");
    }
    throw new Error(response?.error || "Tab Trail could not complete the request.");
  }
  return response.result;
}

async function checkLoadedExtension() {
  const loaded = chrome.runtime.getManifest();
  extensionVersion.textContent = `Loaded version ${loaded.version}`;
  const commands = await chrome.commands.getAll();
  if (!commands.some((command) => command.name === "copy-selected-tabs")) {
    showReloadRequired();
  }
  copyTabsButton.disabled = needsReload;

  const response = await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not check the extension files for updates.");
  }
  const available = await response.json();
  if (available.version !== loaded.version) {
    extensionVersion.textContent += `; available ${available.version}`;
    showReloadRequired();
  }
  return commands;
}

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

function formatUrl(url) {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function renderHistory() {
  historyList.replaceChildren();
  const terms = searchInput.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;
  const entries = searching
    ? popupState.allTabs.filter((entry) => {
      const text = [entry.title, entry.liveTitle, entry.url, ...entry.previousTitles]
        .join(" ").toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    })
    : [...popupState.entries].reverse();
  historyHeading.textContent = searching ? "Search results" : "Active-tab history";
  resultCount.textContent = searching
    ? `${entries.length} of ${popupState.allTabs.length} tabs`
    : `${popupState.entries.length} / ${popupState.historyLimit}`;
  emptyHistory.hidden = searching ? entries.length > 0 : entries.length > 1;
  emptyHistory.textContent = searching
    ? "No open tabs match your search."
    : "No previous tabs in this profile yet.";
  backButton.disabled = popupState.cursor <= 0;
  forwardButton.disabled = popupState.cursor >= popupState.entries.length - 1;

  entries
    .forEach((entry) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const renameButton = document.createElement("button");
      const details = document.createElement("span");
      const title = document.createElement("span");
      const url = document.createElement("span");

      button.type = "button";
      button.className = "history-item";
      item.className = "history-row";
      if (entry.id === popupState.activeTabId) {
        button.classList.add("current");
        button.setAttribute("aria-current", "true");
      }
      button.dataset.tabId = String(entry.id);
      button.title = `${entry.title}\n${entry.url}`;

      if (entry.favIconUrl) {
        const icon = document.createElement("img");
        icon.src = entry.favIconUrl;
        icon.alt = "";
        button.append(icon);
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "favicon-placeholder";
        button.append(placeholder);
      }

      details.className = "tab-details";
      title.className = "tab-title";
      title.textContent = entry.title;
      url.className = "tab-url";
      url.textContent = formatUrl(entry.url);
      if (entry.sleeping) {
        url.textContent += " · Sleeping";
      }
      if (entry.windowId !== popupState.activeWindowId) {
        url.textContent += " · Other window";
      }
      details.append(title, url);
      const previousTitle = searching && entry.previousTitles.find((previous) =>
        previous !== entry.title && terms.some((term) => previous.toLocaleLowerCase().includes(term))
      );
      if (previousTitle) {
        const previous = document.createElement("span");
        previous.className = "tab-url";
        previous.textContent = `Previously: ${previousTitle}`;
        previous.title = previousTitle;
        details.append(previous);
      }
      button.append(details);
      renameButton.type = "button";
      renameButton.className = "rename-button secondary";
      renameButton.dataset.tabId = String(entry.id);
      renameButton.textContent = "Rename";
      renameButton.setAttribute("aria-label", `Rename ${entry.title}`);
      item.append(button, renameButton);
      historyList.append(item);
    });
}

async function refresh() {
  popupState = await sendMessage({ type: "get-popup-state" });
  renderHistory();
}

async function perform(action, successMessage) {
  setStatus("");
  try {
    await action();
    if (successMessage) {
      setStatus(successMessage);
    }
  } catch (error) {
    setStatus(error.message, true);
  }
}

backButton.addEventListener("click", () => {
  perform(async () => {
    const result = await sendMessage({ type: "navigate-history", direction: -1 });
    if (result.moved) {
      await refresh();
    }
  });
});

forwardButton.addEventListener("click", () => {
  perform(async () => {
    const result = await sendMessage({ type: "navigate-history", direction: 1 });
    if (result.moved) {
      await refresh();
    }
  });
});

historyList.addEventListener("click", (event) => {
  const renameButton = event.target.closest(".rename-button");
  if (renameButton) {
    perform(async () => {
      await sendMessage({
        type: "open-rename-window",
        tabId: Number(renameButton.dataset.tabId)
      });
      window.close();
    });
    return;
  }

  const button = event.target.closest(".history-item");
  if (!button) {
    return;
  }

  perform(async () => {
    const result = await sendMessage({
      type: "activate-tab",
      tabId: Number(button.dataset.tabId)
    });
    if (result.moved) {
      window.close();
    }
  });
});

searchInput.addEventListener("input", () => {
  if (popupState) {
    setStatus("");
    renderHistory();
  }
});

searchInput.addEventListener("keydown", (event) => {
  const buttons = historyList.querySelectorAll(".history-item");
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const index = event.key === "ArrowDown" ? 0 : buttons.length - 1;
    buttons[index]?.focus();
  } else if (event.key === "Enter") {
    event.preventDefault();
    buttons[0]?.click();
  }
});

historyList.addEventListener("keydown", (event) => {
  if (!event.target.matches(".history-item") ||
      (event.key !== "ArrowDown" && event.key !== "ArrowUp")) {
    return;
  }
  event.preventDefault();
  const buttons = [...historyList.querySelectorAll(".history-item")];
  const index = buttons.indexOf(event.target) + (event.key === "ArrowDown" ? 1 : -1);
  if (index < 0 || index >= buttons.length) {
    searchInput.focus();
  } else {
    buttons[index].focus();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && searchInput.value) {
    event.preventDefault();
    event.stopPropagation();
    searchInput.value = "";
    if (popupState) {
      renderHistory();
    }
    searchInput.focus();
  }
});

shortcutsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

reloadButton.addEventListener("click", () => {
  reloadButton.disabled = true;
  setStatus("Reloading Tab Trail. Reopen this popup afterward.");
  try {
    chrome.runtime.reload();
  } catch (error) {
    reloadButton.disabled = false;
    setStatus(error.message, true);
  }
});

copyTabsButton.addEventListener("click", () => {
  perform(async () => {
    copyTabsButton.disabled = true;
    try {
      const { count } = await sendMessage({
        type: "copy-selected-tabs",
        windowId: popupState?.activeWindowId
      });
      setStatus(`Copied ${count} selected tab link${count === 1 ? "" : "s"}.`);
    } finally {
      copyTabsButton.disabled = needsReload;
    }
  });
});

searchInput.focus();
Promise.all([refresh(), checkLoadedExtension()]).then(([, commands]) => {
  if (!needsReload && !commands.find((command) => command.name === "_execute_action")?.shortcut) {
    setStatus("Set Ctrl+Shift+Q in Settings to enable the search shortcut.");
  }
}).catch((error) => setStatus(error.message, true));
