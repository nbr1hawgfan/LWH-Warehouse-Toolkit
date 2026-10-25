# Formula Builder — v1.75.0

## 1. SQL
Nothing. No Supabase changes.

## 2. Upload these files (everything else is unchanged)
- `js/formulabuilder.js` — **new file** (the whole Formula Builder)
- `index.html` — replace (menu entry, screen, script tag, About, version 1.75.0)
- `js/hometiles.js` — replace (Formula Builder tile under Scan & Utilities)
- `css/app.css` — replace (Formula Builder styles at the end)
- `service-worker.js` — replace (cache v1-75-0, new file cached for offline)
- `CHANGELOG.md`, `README.md`, `REDEPLOY_NOTES.md` — docs

Hard refresh after upload; on phones close and reopen the app once with signal.

## 3. Check after deploy
- Home → search "formula" → Formula Builder opens on Look Up.
- Each tab → See an example → Fill in this example → formula appears, Copy works, paste into Excel gives an answer.
- VLOOKUP: table B:E, column back B → red warning (left of table). Column H → outside-the-table warning.
- Bookmark: `index.html?view=formulas` opens straight to it.

## Notes
- XLOOKUP needs Excel 2021 / 365, IFS needs Excel 2019+. If his Excel shows #NAME?, use the VLOOKUP tab and untick "Use IFS". The screen says this too.
- Only columns A–AZ are read as cells, so bay names like VB220 / XLF019 are treated as text. Quotes force text ("B12").
