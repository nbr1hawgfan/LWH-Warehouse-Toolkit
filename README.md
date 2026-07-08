# LWH Warehouse Toolkit v1.3.0

Internal Logistics Warehouse PWA for lookup, labels, receiving print, signs, contact QR cards, and visitor badges.

## v1.3.0 focus
- Fixed Master Lookup so it actually auto-loads fresh data on open (previously only the Receiving CSV auto-loaded).
- Added the missing Settings field for the Master Lookup CSV source.
- Redesigned the app chrome (teal default, still fully customizable from Settings) without touching label/print output.
- Replaced the camera scanner with the html5-qrcode implementation for reliable iPhone/Safari scanning.

## Two CSV sources — don't mix them up
- **Master Lookup Source** (Settings): feeds the Master Lookup screen everyone searches day-to-day. Expects the 19-column customer/master layout — see `docs/GOOGLE_SHEET_SETUP.md`.
- **Receiving Print Source** (Settings): feeds Receiving/InvRec batch label printing. Expects the 13-column receiving layout — see `docs/GOOGLE_SHEET_SETUP.md`.

Both auto-load on app open and can be set independently. If the two sources should actually point at the same published sheet, tell Claude when you push this live and it can double check the sheet's columns match one of the two expected layouts.

## Deployment
Upload the full unzipped contents to the GitHub Pages repository root and hard refresh after deployment.
