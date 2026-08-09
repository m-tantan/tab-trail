let customTitle = "";
let naturalTitle = "";
let observer;

function observeDocument() {
  if (!observer || !document.documentElement) {
    return;
  }

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function applyCustomTitle() {
  if (!customTitle || document.title === customTitle) {
    return;
  }

  observer?.disconnect();
  document.title = customTitle;
  observeDocument();
}

function startObserver() {
  if (!observer) {
    observer = new MutationObserver(() => {
      if (document.title !== customTitle) {
        naturalTitle = document.title;
        applyCustomTitle();
      }
    });
  }

  observeDocument();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "set-custom-title") {
    if (!customTitle) {
      naturalTitle = document.title;
    }
    customTitle = message.name;
    applyCustomTitle();
    startObserver();
    sendResponse({ success: true });
    return;
  }

  if (message.type === "clear-custom-title") {
    customTitle = "";
    observer?.disconnect();
    observer = undefined;
    if (naturalTitle) {
      document.title = naturalTitle;
      naturalTitle = "";
    }
    sendResponse({ success: true });
  }
});
