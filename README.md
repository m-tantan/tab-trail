# Tab Trail

Tab Trail is a native Manifest V3 extension for Microsoft Edge and Google Chrome. It keeps a
per-window trail of the 20 most recently activated unique tabs and lets you assign a persistent
custom title to a tab.

Each browser profile stores its own extension data automatically. Histories are also isolated by
browser window.

## Features

- Rename the active tab from the popup.
- Preserve custom names across reloads while the tab remains open.
- Navigate active-tab history backward and forward, even when unrelated tabs sit between visits.
- Keep up to 20 unique tab entries using least-recently-used ordering.
- Skip closed tabs and remove them from history.
- View and select recent tabs in the popup.
- View current shortcuts and instructions for changing them.
- Run without frameworks, dependencies, analytics, or a build step.

## Default shortcuts

| Action | Shortcut |
| --- | --- |
| Open the rename popup | `Alt+R` |
| Previous active tab | `Ctrl+Shift+Left` |
| Next active tab | `Ctrl+Shift+Right` |

Chromium may reject or override a shortcut when it conflicts with the browser or operating system.
Open the extension's settings page to view the current assignments. As a fallback, manually assign
`Ctrl+Shift+[` and `Ctrl+Shift+]` if your browser accepts those combinations.

Shortcut settings are profile-specific and must be changed through:

- Chrome: `chrome://extensions/shortcuts`
- Edge: `edge://extensions/shortcuts`

## Install in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select this project folder.

## Install in Edge

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select this project folder.

## Browser restrictions

Browsers prevent extensions from modifying protected pages such as browser settings, extension
stores, and some built-in pages. Tab Trail reports an error instead of renaming those pages.

## Privacy

Tab Trail runs entirely inside the browser. It stores tab IDs, per-window history, and custom names
in the profile's local extension storage. It sends no data to external services.

## License

Licensed under the [MIT License](LICENSE).
