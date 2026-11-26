# Email Employees — v1.103.0

## 1. PTO Apps Script (once) — full steps in docs/EMAIL_EMPLOYEES_SETUP.md
PTO Sheet → Extensions → Apps Script → paste `gas/PTO_Api_v1.4.0.gs` over Api.gs → Save →
Deploy → Manage deployments → edit → New version (same /exec link). Optional: run `apiSelfTest`.

## 2. Files in this release
- `js/emailblast.js` — **new file**
- `index.html` — screen, script tag, version 1.103.0
- `js/manager.js` — Email Employees card under People
- `css/app.css` — styles at the end
- `service-worker.js` — cache v1-103-0, new file cached
- `gas/PTO_Api_v1.4.0.gs` (was PTO_Api_v1.3.0.gs), `docs/EMAIL_EMPLOYEES_SETUP.md` — reference copies
- `CHANGELOG.md`, `README.md`, `REDEPLOY_NOTES.md` — docs

Hard refresh after it's live; on phones close and reopen the app once with signal.
