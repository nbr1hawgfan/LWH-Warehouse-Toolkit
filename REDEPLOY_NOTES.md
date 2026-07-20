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


## Follow-up fix — detection accuracy
Two small pre-existing gaps closed that were making auto-detect noticeably
less accurate here than in the standalone driver app:
- Camera now requests 1920x1080 explicitly (was requesting no resolution at
  all, leaving it to the browser default).
- Removed a lossy JPEG re-encode + downscale step that ran before detection
  (inherited from the old manual-crop editor); the captured canvas now goes
  straight into detection at higher resolution (MAXDIM raised 1400 -> 2200).


## Follow-up fix — camera framing
The camera now takes over the full screen while scanning (like the
standalone driver app) instead of a video capped at max-height:60vh stuck
inline in the scrollable Doc Scanner page. That inline layout was the actual
cause of needing to scroll the page and reposition the phone more just to
fit a document in frame — a bigger, unconstrained viewfinder should feel
much closer to the standalone app now. Close button moved to a floating X
top-right of the camera view; Capture Page now floats at the bottom over
the video instead of sitting as a separate button beneath it.


## Bug fix — camera CSS was overriding the hidden attribute
The full-screen camera fix in the previous version had a real bug: the CSS
class I put on the camera wrapper set display:flex directly, and author
CSS rules always beat the browser's built-in [hidden]{display:none} rule
regardless of the hidden attribute being present. Net effect: that
full-screen black camera overlay never actually hid itself — it sat on top
of every screen at all times, which is why the layout looked broken
everywhere and taps on Re-scan Edges (and anything else underneath it)
werent reaching their real targets.

Fixed two ways:
1. The camera-overlay CSS rule is now scoped with :not([hidden]), so it
   only applies when the element is actually meant to be visible.
2. Added a blanket [hidden]{display:none !important} rule as a permanent
   safety net against this whole bug class recurring in any future edit.

Also switched the camera sizing from a plain percentage-height chain to
the same flex:1 + min-height:0 + overflow:hidden pattern already proven
in the standalone driver app — percentage heights on a <video> inside a
fixed-position box are unreliable across browsers, which was likely also
contributing to the odd sizing.

Re-scan Edges now also shows a toast confirming it ran, so its effect is
never ambiguous even when the result looks the same as before.
