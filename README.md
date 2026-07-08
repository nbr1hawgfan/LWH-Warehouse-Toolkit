# LWH Warehouse Toolkit v1.1.6

Maintenance release focused on scanner fallback and pallet label print fit.

## Changed in v1.1.6
- Added camera scanner fallback path for browsers without native BarcodeDetector support.
- Improved scanner messaging for PC and Android.
- Tightened pallet label layout so barcodes/QR codes fit inside the 4x6 label.
- Reduced pallet label barcode/QR sizes to prevent bottom clipping.
- Kept Customer ID QR on pallet labels.

## Replace for patch
Replace these files in the GitHub repo:
- index.html
- service-worker.js
- css/app.css
- js/labels.js
- js/scanner.js
- README.md

After upload, hard refresh and/or clear the PWA cache if an older version remains.
