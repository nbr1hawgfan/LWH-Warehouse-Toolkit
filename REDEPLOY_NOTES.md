# Battery Box & BOM — v1.89.0

## 1. Script (once) — full steps in docs/BATTERY_BOX_SETUP.md
BOM Inventory Sheet → Extensions → Apps Script → paste `gas/BatteryBoxAPI.gs` over Code.gs → run `setupToolkitApi()` →
add employee IDs to the Access tab → Deploy → Manage deployments → edit → New version (same /exec link).
Put the /exec link in `js/batterybox.js` (`API_DEFAULT`) or paste it on the Connect screen.

## 2. Files in this release
- `js/batterybox.js` — **new file**
- `index.html` — menu entry, screen, script tag, version 1.89.0
- `js/hometiles.js` — Battery Box & BOM tile (Time & Hours)
- `css/app.css` — styles at the end
- `service-worker.js` — cache v1-89-0, new file cached
- `gas/BatteryBoxAPI.gs`, `docs/BATTERY_BOX_SETUP.md` — reference copies
- `CHANGELOG.md`, `README.md`, `REDEPLOY_NOTES.md` — docs

Hard refresh after it's live; on phones close and reopen the app once with signal.
