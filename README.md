<div align="center">
  <img src="icons/icon-128.png" width="96" alt="Tab Trail logo">
  <h1>Tab Trail</h1>
  <p>
    Rename browser tabs and retrace the tabs you actually visited, not merely the tabs sitting
    next to each other.
  </p>
  <p>
    <strong>Native Manifest V3 · Chrome + Edge · No dependencies · No analytics</strong>
  </p>
</div>

## Why Tab Trail?

Browser tab order and browsing order are different things.

Imagine tab **M** is open, five unrelated tabs sit after it, and tab **N** is at the far end. You
work in **M**, jump to **N**, and then need to return. Normal tab shortcuts move through every tab
between them. Tab Trail remembers the path you took:

```text
Visited: M → N

Ctrl+Shift+Left   → M
Ctrl+Shift+Right  → N
```

Each browser window keeps its own 20-tab least-recently-used trail. Browser profiles remain isolated
automatically because Chromium gives every profile separate extension storage.

## Quick walkthrough

1. Open several tabs, including two that are far apart in the tab strip.
2. Work in the first tab, then select the second tab.
3. Press `Ctrl+Shift+Left` to return directly to the first tab.
4. Press `Ctrl+Shift+Right` to move forward to the second tab again.
5. Open the popup to rename either tab or jump directly to another recent entry.

Tab Trail follows your activation path. It does not cycle through every tab positioned between the
two tabs.

## The popup

<div align="center">
  <img src="docs/popup-preview.png" width="396" alt="Tab Trail popup showing rename controls and tab history">
</div>

The popup lets you rename the current tab, navigate backward or forward, jump directly to an entry,
and open the browser's shortcut configuration guidance.

## Features

- Rename the active tab and preserve its custom title across page reloads.
- Navigate backward and forward through activation history rather than tab-strip position.
- Keep 20 unique recently visited tabs per browser window using LRU ordering.
- Remove closed tabs from the trail automatically.
- Maintain independent state for every browser window and browser profile.
- Inspect and select recent tabs from the popup.
- Configure browser-profile-specific keyboard shortcuts.
- Run entirely in the browser without frameworks, build tools, telemetry, or external services.

## Install from source

### Google Chrome

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** in the upper-right corner.
4. Select **Load unpacked**.
5. Select the repository folder containing `manifest.json`.
6. Pin **Tab Trail** from the Extensions menu for quick access.

### Microsoft Edge

1. Download or clone this repository.
2. Open `edge://extensions`.
3. Enable **Developer mode** in the left sidebar.
4. Select **Load unpacked**.
5. Select the repository folder containing `manifest.json`.
6. Pin **Tab Trail** from the Extensions menu for quick access.

When pulling a newer version, return to the extensions page and select **Reload** on the Tab Trail
card.

## Configure keyboard shortcuts

Tab Trail requests these defaults:

| Action | Requested shortcut |
| --- | --- |
| Open the rename popup | `Alt+R` |
| Previous active tab | `Ctrl+Shift+Left` |
| Next active tab | `Ctrl+Shift+Right` |

Chromium may leave a shortcut unassigned when it conflicts with the browser, operating system, or
another extension. Open Tab Trail, select the gear button, and use the displayed shortcut page:

- Chrome: `chrome://extensions/shortcuts`
- Edge: `edge://extensions/shortcuts`

Search for **Tab Trail**, select the pencil beside each command, and enter the preferred keys. If
the arrow shortcuts conflict, try:

| Action | Suggested fallback |
| --- | --- |
| Previous active tab | `Ctrl+Shift+[` |
| Next active tab | `Ctrl+Shift+]` |

Shortcut assignments are intentionally profile-specific.

## How the trail behaves

1. Activating a tab moves it to the newest position in the current window's trail.
2. Revisiting an existing tab updates its position instead of creating a duplicate.
3. Going backward and then activating a different tab starts a new forward path.
4. Closing a tab removes it from saved history.
5. The oldest entry is removed when the trail exceeds 20 tabs.

## Rename behavior and browser restrictions

Custom names last while the tab remains open and are reapplied after normal page reloads. Chromium
blocks extensions from changing protected pages such as browser settings, extension stores, and
some built-in pages. Tab Trail reports that limitation instead of silently failing.

## Privacy

Tab Trail stores tab IDs, per-window history, and custom names in the current profile's local
extension storage. It does not transmit data, load remote code, or use analytics.

## README and social assets

The repository includes reusable source assets:

- [`docs/popup-preview.html`](docs/popup-preview.html) renders the popup preview using the
  extension's real stylesheet.
- [`docs/social-post.md`](docs/social-post.md) contains a ready-to-edit launch post.

Open `docs/popup-preview.html` in Chrome or Edge when a refreshed popup screenshot is needed.

## License

Licensed under the [MIT License](LICENSE).
