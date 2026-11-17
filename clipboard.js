const clipboard = document.querySelector("#clipboard");

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "clipboard" || message.type !== "write-clipboard") {
    return false;
  }

  try {
    if (typeof message.text !== "string" || !message.text) {
      throw new Error("No tab links were provided.");
    }
    clipboard.value = message.text;
    clipboard.select();
    if (!document.execCommand("copy")) {
      throw new Error("The browser could not write the tab links to the clipboard.");
    }
    sendResponse({ ok: true });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  } finally {
    clipboard.value = "";
  }
  return false;
});
