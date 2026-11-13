# Production — v1.85.0

## 1. Apps Script (do this first) — full steps in docs/PRODUCTION_SETUP.md
1. Back up the Sheet and the old Code.gs.
2. Replace Code.gs with `gas/ProductionAPI.gs`, delete Index.html.
3. Run `setupProductionV2` once. Put your employee ID with role `admin` on the new **Access** tab.
4. Deploy → Manage deployments → edit → **New version** (Execute as Me, Anyone). Copy the /exec URL.
5. Run `createDailyEmailTrigger` once.

## 2. URL
Already set in `js/production.js` (`PROD_API_DEFAULT`). If you ever make a NEW deployment (instead of a new version of this one), update it there.

## 3. SQL (optional — timeclock comparison)
`sql/production_timeclock.sql` in the Supabase SQL Editor, then set the key there and in Script Property `PROD_TIMECLOCK_KEY`.

## 4. Upload these files (everything else is unchanged)
- `js/production.js` — **new file**
- `index.html` — replace (menu entry, screen, script tag, About, version 1.85.0)
- `js/hometiles.js` — replace (Production tile under Time & Hours)
- `css/app.css` — replace (Production styles at the end)
- `service-worker.js` — replace (cache v1-85-0, new file cached)
- `gas/ProductionAPI.gs`, `sql/production_timeclock.sql`, `docs/PRODUCTION_SETUP.md` — reference copies
- `CHANGELOG.md`, `README.md`, `REDEPLOY_NOTES.md` — docs

Hard refresh after upload; on phones close and reopen the app once with signal.

## 5. Check after deploy
- Signed in as a manager → menu shows **Production**; Home → search "production".
- Record a 2-person job → Sheet shows 2 rows, same Job ID, units split by hours.
- Entries → Edit → change hours → saved; Audit Log tab has the change.
- Settings → Pricing → change a rate starting today → Rate History row added.
- Settings → OT & daily report → Send yesterday's report now → email arrives.
- Old web app URL → "Production has moved" page with a button into the Toolkit.
- Bookmark: `index.html?view=production` opens straight to it.
