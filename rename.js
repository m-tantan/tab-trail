const currentTitle = document.querySelector("#current-title");
const nameInput = document.querySelector("#tab-name");
const renameForm = document.querySelector("#rename-form");
const resetButton = document.querySelector("#reset-name");
const statusElement = document.querySelector("#status");

const tabId = Number(new URLSearchParams(location.search).get("tabId"));

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

async function initialize() {
  if (!Number.isInteger(tabId)) {
    throw new Error("The tab to rename is unavailable.");
  }

  const state = await sendMessage({ type: "get-rename-state", tabId });
  currentTitle.textContent = state.title;
  nameInput.value = state.customName;
  nameInput.placeholder = state.title;
  nameInput.focus();
  nameInput.select();
}

renameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");

  try {
    await sendMessage({ type: "rename-tab", tabId, name: nameInput.value });
    window.close();
  } catch (error) {
    setStatus(error.message, true);
  }
});

resetButton.addEventListener("click", async () => {
  setStatus("");

  try {
    await sendMessage({ type: "clear-tab-name", tabId });
    window.close();
  } catch (error) {
    setStatus(error.message, true);
  }
});

initialize().catch((error) => setStatus(error.message, true));
