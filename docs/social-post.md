# Social post draft

I built a tiny browser extension for a problem that kept interrupting my flow:

**tab order is not the same as work history.**

If I jump from tab M to tab N, with five unrelated tabs between them, I do not want to step through
every tab to get back. Tab Trail remembers the tabs I actually visited:

⬅️ `Alt+Shift+Left` returns to M<br>
➡️ `Alt+Shift+Right` moves forward to N

It keeps one 20-tab LRU trail across all windows in a browser profile, while each profile remains
independent. `Alt+R` opens a focused tab-renaming experience.

The extension is native Manifest V3, works in Chrome and Edge, has no dependencies or analytics,
and runs entirely inside the browser.

Source: https://github.com/yomanor_microsoft/tab-trail

#BrowserExtension #OpenSource #Productivity #Chrome #MicrosoftEdge

## Short version

I wanted browser navigation to follow my attention, not the tab strip.

Tab Trail remembers the tabs I actually visited, so I can jump from M to N and use back/forward
shortcuts to move between them even when five unrelated tabs sit in the middle or they are in
different browser windows. Each browser profile keeps its own isolated 20-tab trail.

Native Chrome + Edge extension. No dependencies, no analytics.

https://github.com/yomanor_microsoft/tab-trail
