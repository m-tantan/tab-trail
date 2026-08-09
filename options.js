const labels = {
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

shortcutUrlElement.textContent = shortcutUrl;

chrome.commands.getAll((commands) => {
  commands.forEach((command) => {
    const row = document.createElement("div");
    const name = document.createElement("dt");
    const shortcut = document.createElement("dd");
    const key = document.createElement("kbd");

    row.className = "command-row";
    name.textContent = labels[command.name] || command.description || command.name;
    key.textContent = command.shortcut || "Not assigned";
    shortcut.append(key);
    row.append(name, shortcut);
    commandList.append(row);
  });
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shortcutUrl);
    copyStatus.textContent = "Address copied.";
  } catch {
    copyStatus.textContent = `Copy this address manually: ${shortcutUrl}`;
  }
});
