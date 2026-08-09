const nameInput = document.querySelector("#tab-name");
const renameForm = document.querySelector("#rename-form");
const resetButton = document.querySelector("#reset-name");
const backButton = document.querySelector("#history-back");
const forwardButton = document.querySelector("#history-forward");
const shortcutsButton = document.querySelector("#shortcuts-button");
const historyList = document.querySelector("#history-list");
const emptyHistory = document.querySelector("#empty-history");
const statusElement = document.querySelector("#status");

let popupState;

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Tab Trail could not complete the request.");
  }
  return response.result;
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
  const entries = popupState.entries;
  emptyHistory.hidden = entries.length > 1;
  backButton.disabled = popupState.cursor <= 0;
  forwardButton.disabled = popupState.cursor >= entries.length - 1;

  entries
    .map((entry, index) => ({ entry, index }))
    .reverse()
    .forEach(({ entry, index }) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const details = document.createElement("span");
      const title = document.createElement("span");
      const url = document.createElement("span");

      button.type = "button";
      button.className = "history-item";
      if (index === popupState.cursor) {
        button.classList.add("current");
      }
      button.dataset.index = String(index);

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
      details.append(title, url);
      button.append(details);
      item.append(button);
      historyList.append(item);
    });
}

async function refresh() {
  popupState = await sendMessage({ type: "get-popup-state" });
  nameInput.value = popupState.customName;
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

renameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  perform(async () => {
    await sendMessage({
      type: "rename-tab",
      tabId: popupState.activeTabId,
      name: nameInput.value
    });
    popupState.customName = nameInput.value.trim();
  }, "Tab renamed.");
});

resetButton.addEventListener("click", () => {
  perform(async () => {
    await sendMessage({
      type: "clear-tab-name",
      tabId: popupState.activeTabId
    });
    nameInput.value = "";
    popupState.customName = "";
  }, "Original tab name restored.");
});

backButton.addEventListener("click", () => {
  perform(async () => {
    const result = await sendMessage({ type: "navigate-history", direction: -1 });
    if (result.moved) {
      window.close();
    }
  });
});

forwardButton.addEventListener("click", () => {
  perform(async () => {
    const result = await sendMessage({ type: "navigate-history", direction: 1 });
    if (result.moved) {
      window.close();
    }
  });
});

historyList.addEventListener("click", (event) => {
  const button = event.target.closest(".history-item");
  if (!button) {
    return;
  }

  perform(async () => {
    const result = await sendMessage({
      type: "activate-history-index",
      windowId: popupState.activeWindowId,
      index: Number(button.dataset.index)
    });
    if (result.moved) {
      window.close();
    }
  });
});

shortcutsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

refresh()
  .then(() => nameInput.focus())
  .catch((error) => setStatus(error.message, true));
