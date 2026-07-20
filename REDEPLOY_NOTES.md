# Doc Scanner upgrade — v1.40.0

Only 4 files changed/added. Everything else in your repo is untouched —
verified byte-for-byte identical against the live repo before packaging.

## Files to upload (overwrite in place)
- `index.html` — replace
- `css/app.css` — replace
- `js/utilities.js` — replace
- `js/doc-auto-detect.js` — **new file**, add it

## What changed
- Doc Scanner now auto-detects document edges (OpenCV.js) instead of
  starting from a plain inset rectangle you drag from scratch.
- Corner handles instead of a rectangle — supports perspective straightening
  for pages shot at an angle, not just a crop.
- Magnifier loupe while dragging a corner, for precise placement.
- "Re-scan Edges" button if the auto-detect picks the wrong thing.
- Live detection overlay in the camera view + auto-capture when the outline
  holds steady — no tap needed, tapping Capture Page still always works too.
- Version bumped to 1.40.0 in the About screen.

## NOT touched
- `js/scanner.js` — this is the barcode/QR reader (Scan Code tool), 100%
  unrelated code, confirmed unchanged.
- OCR (Tesseract.js), PDF export, page reorder, filenames, Share All Pages —
  all identical logic, just now operating on a perspective-warped image
  instead of a rectangle-cropped one.
- No other tool/module in the app was touched.

## New dependency
OpenCV.js (~8MB, loaded from docs.opencv.org, same CDN pattern as your other
libraries) — loads async, only used by Doc Scanner. Nothing else in the app
depends on it or waits on it.
