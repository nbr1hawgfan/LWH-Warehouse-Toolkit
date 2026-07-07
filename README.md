# LWH Warehouse Toolkit v1.0.0

Installable GitHub Pages PWA for Logistics Warehouse tag/sign generation.

## Included modules

- 4x6 Rack Labels
- 8.5x11 Bay / Aisle Signs
- Pallet Labels with Simple Entry and Bulk Paste
- Contact QR Cards with optional logo
- Visitor Badges with visitor log
- PWA manifest and service worker

## Deploy

Upload all files/folders to the root of your GitHub Pages repo:

```text
index.html
manifest.json
service-worker.js
css/
js/
icons/
assets/
README.md
```

Then hard refresh the published GitHub Pages URL with Ctrl+Shift+R.
Chrome/Edge should show Install App once the manifest and service worker are detected.

## Important

This app uses JsBarcode and QRCode.js from CDN for barcode/QR rendering. The service worker will cache them after first successful load.
