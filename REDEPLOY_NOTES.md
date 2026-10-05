# Outbound Loads / BOL — v1.66.0

## 1. Run the SQL (once)
Supabase → SQL Editor → paste all of `sql/outbound_loads.sql` → Run.
Safe to re-run. It uses the manager passcode from Missed Punches, so
`sql/missed_punches.sql` must already be in place (it is, if Missed
Punches works today).

## 2. Upload these files (everything else is unchanged)
- `index.html` — replace
- `css/app.css` — replace
- `service-worker.js` — replace (cache bumped so phones pick up the update)
- `js/outbound.js` — **new file**
- `sql/outbound_loads.sql` — **new file** (for the record; it runs in Supabase, not the site)
- `CHANGELOG.md`, `README.md`, `REDEPLOY_NOTES.md`, `docs/OUTBOUND_LOADS_GUIDE.md` — docs

Hard refresh after upload. On phones, close and reopen the app once.

## 3. Before the first real load
- In **Settings**, each device should have the person's name set (it's
  stamped on every scan). The app also asks on the load ("Loaded by").
- Open **Outbound Loads / BOL** → "BOL header" and check the company name,
  address and phone printed at the top of the BOL.
- Do one practice load on a pallet or two, close it, and void it from
  Records (manager) so the pallets free up.

## NOT touched
Load Tag Scan, the existing Bill of Lading form, inventory sync, and every
other module are unchanged. Outbound Loads only *reads* the same live
inventory the rest of the app uses.
