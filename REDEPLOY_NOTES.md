# Bay Scan print sheet — v1.73.1
Already pushed to main. Files changed: `js/bayscan.js`, `css/app.css`, `index.html` (version), `service-worker.js` (cache v1-73-1), docs. No SQL.

# Bay Scan — v1.73.0

## 1. SQL
Nothing to run — `sql/bay_scan.sql` is already applied to LWH Companion
(tables `bay_scan_bays`, `bay_scan_moves`, `bay_scan_current`, functions `toolkit_bay_*`).
It's safe to re-run in the SQL Editor if it's ever needed again.

## 2. Upload these files (everything else is unchanged)
- `index.html` — replace (menu item, Bay Scan screen, version 1.73.0)
- `css/app.css` — replace (Bay Scan styles appended at the end)
- `js/hometiles.js` — replace (Bay Scan tile, next to Load Tag Scan)
- `service-worker.js` — replace (cache bumped to v1-73-0 so phones pick up the update)
- `js/bayscan.js` — **new file**
- `sql/bay_scan.sql` — **new file** (record)
- `CHANGELOG.md`, `README.md`, `REDEPLOY_NOTES.md` — docs

Hard refresh after upload. On phones, close and reopen the app once while it has signal.

## 3. First use
- Settings → make sure each person's name is set (it's stamped on every scan). Bay Scan asks for it too if it's missing.
- Bay Scan → pick the warehouse → **Bays** tab → add the customer's bay names (paste several, one per line). Capacity is 240 unless you type another number.

## NOT touched
Load Tag Scan and every other module are unchanged.
