# Doc Scanner rebuild — v1.74.0

## 1. SQL
Nothing. No Supabase changes.

## 2. Upload these files (everything else is unchanged)
- `index.html` — replace (new Doc Scanner screen, OpenCV no longer loaded at startup, version 1.74.0)
- `js/docscan.js` — **new file** (the whole Doc Scanner)
- `js/utilities.js` — replace (old scanner code removed)
- `js/ui.js` — replace (starts/stops the scanner camera when you change screens)
- `js/hometiles.js` — replace (tile description)
- `css/app.css` — replace (old scanner styles removed, new ones at the end)
- `service-worker.js` — replace (cache v1-74-0, scanner files cached, library cache)
- `CHANGELOG.md`, `REDEPLOY_NOTES.md` — docs

`js/doc-auto-detect.js` is unchanged. Hard refresh after upload; on phones close and reopen the app once with signal.

## 3. Check after deploy
- Upload a phone photo of a BOL → corners found → Add Page.
- Upload a PDF → its pages appear.
- Read Text → Key Fields shows the BOL / PO numbers.
- Tick Searchable PDF → Download PDF → open it and Ctrl+F a number.

## Notes / risks
- First use of the edge finder, the PDF reader and the text reader each needs signal (then cached). Straightening and the looks work without the edge finder — corners can always be dragged by hand.
- Key Fields is pattern matching on read text — it shows what *looks like* a BOL/PO/etc. Check before keying it into the WMS.
- Handwriting still won't read well (same text engine as before).
- Pages saved in an old session from v1.73 aren't carried over (they were never saved before).
