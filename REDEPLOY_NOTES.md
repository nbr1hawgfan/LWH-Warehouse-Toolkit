# One Source Inbound + offline libraries — v1.67.0

## 1. SQL
Nothing to run. The Supabase objects (`os_inbound_loads`, `os_inbound_pallets`,
`os_inbound_access`, `os_inbound_sync`) are already live in LWH Companion.
`sql/os_inbound_sync.sql` is kept here for the record.

## 2. Upload these files (everything else is unchanged)
- `index.html` — replace (new menu item, Home card, section; libraries now load from `vendor/`)
- `css/app.css` — replace (One Source Inbound styles appended at the end)
- `service-worker.js` — replace (cache bumped to v1-67-0 so phones pick up the update)
- `js/osinbound.js` — **new file**
- `vendor/JsBarcode.all.min.js`, `vendor/html5-qrcode.min.js`, `vendor/qrcode.min.js` — **new folder**
- `sql/os_inbound_sync.sql` — **new file** (record only)
- `CHANGELOG.md`, `README.md`, `REDEPLOY_NOTES.md` — docs

Hard refresh after upload. On phones, close and reopen the app once **while it has signal**
so the new version and the libraries are cached for offline use.

## 3. On each dock device
- Settings → make sure the person's name is set (stamped on every pallet).
- One Source Inbound → "Sync between devices" → enter the sync code → Save sync settings.
- Loads already scanned in the standalone app on the same device show up automatically.

## NOT touched
Load Tag Scan, Outbound Loads, Master Lookup and every other module are unchanged.
The only shared change is where the three libraries load from (same versions).
