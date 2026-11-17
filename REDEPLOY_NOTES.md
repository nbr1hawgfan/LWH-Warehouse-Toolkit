# Inspections — v1.88.0

## 1. Already live (nothing to do)
Supabase tables/functions (`sql/facility_inspections.sql`), the `insp-photo` Edge Function and the `insp-photos` bucket.

## 2. Mailer (once) — full steps in docs/INSPECTIONS_SETUP.md
New Google Sheet → Apps Script → paste `gas/InspectionMailer.gs` → Script Properties
(SUPABASE_URL, SUPABASE_ANON_KEY, INSP_MAILER_KEY) → run `setup()`.

## 3. Files in this release
- `js/inspections.js` — **new file**
- `index.html` — menu entry, screen, script tag, version 1.88.0
- `js/hometiles.js` — Inspections tile (Safety & Training)
- `css/app.css` — styles at the end
- `service-worker.js` — cache v1-88-0, new file cached
- `sql/facility_inspections.sql`, `supabase/functions/insp-photo/index.ts`, `gas/InspectionMailer.gs`, `docs/INSPECTIONS_SETUP.md` — reference copies
- `CHANGELOG.md`, `README.md`, `REDEPLOY_NOTES.md` — docs

Hard refresh after it's live; on phones close and reopen the app once with signal.
