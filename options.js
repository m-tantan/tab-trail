const labels = {
  "_execute_action": "Search open tabs",
  "copy-selected-tabs": "Copy selected tab links",
  "rename-current-tab": "Rename current tab",
  "navigate-back": "Previous active tab",
  "navigate-forward": "Next active tab"
};

const isEdge = navigator.userAgent.includes("Edg/");
const shortcutUrl = isEdge ? "edge://extensions/shortcuts" : "chrome://extensions/shortcuts";
const commandList = document.querySelector("#command-list");
const shortcutUrlElement = document.querySelector("#shortcut-url");
const copyButton = document.querySelector("#copy-url");
const copyStatus = document.querySelector("#copy-status");
const historyLimit = document.querySelector("#history-limit");
const settingsStatus = document.querySelector("#settings-status");
const shortcutWarning = document.querySelector("#shortcut-warning");
const reloadNotice = document.querySelector("#reload-notice");
const reloadButton = document.querySelector("#reload-extension");
const extensionVersion = document.querySelector("#extension-version");

shortcutUrlElement.textContent = shortcutUrl;
extensionVersion.textContent = `Loaded version ${chrome.runtime.getManifest().version}`;

reloadButton.addEventListener("click", () => chrome.runtime.reload());

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Tab Trail could not complete the request.");
  }
  return response.result;
}

let savedLimit;

async function loadSettings() {
  const settings = await sendMessage({ type: "get-settings" });
  savedLimit = settings.historyLimit;
  historyLimit.value = String(savedLimit);
  historyLimit.disabled = false;
}

historyLimit.addEventListener("change", async () => {
  historyLimit.disabled = true;
  settingsStatus.textContent = "";
  settingsStatus.classList.remove("error");
  try {
    const limit = Number(historyLimit.value);
    await sendMessage({ type: "set-history-limit", limit });
    savedLimit = limit;
    settingsStatus.textContent = "Trail size saved.";
  } catch (error) {
    historyLimit.value = String(savedLimit);
    settingsStatus.textContent = error.message;
    settingsStatus.classList.add("error");
  } finally {
    historyLimit.disabled = false;
  }
});

chrome.commands.getAll((commands) => {
  if (chrome.runtime.lastError) {
    copyStatus.textContent = chrome.runtime.lastError.message;
    return;
  }
  const registered = new Map(commands.map((command) => [command.name, command]));
  const commandNames = new Set([...Object.keys(labels), ...registered.keys()]);
  commandNames.forEach((commandName) => {
    const command = registered.get(commandName);
    const row = document.createElement("div");
    const name = document.createElement("dt");
    const shortcut = document.createElement("dd");
    const key = document.createElement("kbd");

    row.className = "command-row";
    name.textContent = labels[commandName] || command.description || commandName;
    key.textContent = command ? command.shortcut || "Not assigned" : "Not registered";
    if (!command) {
      key.classList.add("unassigned");
      reloadNotice.hidden = false;
    } else if (!command.shortcut) {
      key.classList.add("unassigned");
      if (commandName === "_execute_action") {
        shortcutWarning.hidden = false;
      }
    }
    shortcut.append(key);
    row.append(name, shortcut);
    commandList.append(row);
  });
});

loadSettings().catch((error) => {
  settingsStatus.textContent = error.message;
  settingsStatus.classList.add("error");
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shortcutUrl);
    copyStatus.textContent = "Address copied.";
  } catch {
    copyStatus.textContent = `Copy this address manually: ${shortcutUrl}`;
  }
});
