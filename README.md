# LWH Warehouse Toolkit v1.1.8

Patch release focused on stabilizing camera scanning, pallet labels, and the newer inventory/receiving sheet layout.

## Replace these files

- `index.html`
- `service-worker.js`
- `css/app.css`
- `js/inventory.js`
- `js/labels.js`
- `js/scanner.js`
- `README.md`

## New / fixed

- Camera scanner rebuilt using the working camera pattern from the LWH Search app: video preview, canvas frame capture, native BarcodeDetector where available, and ZXing fallback.
- Pallet label layout tightened so bottom barcodes/QR codes do not cut off as easily.
- Inventory parser supports the new receiving sheet columns:
  - Location
  - LWH_ID
  - Customer_ID
  - Customer
  - InvRec
  - BillToRef
  - ItemNm
  - ItemDesc
  - LotNum
  - Qty
  - Units
  - BayName
  - DateReceived
- Bulk paste now handles this 13-column format even if pasted without the header row.
- Default inventory CSV source updated to the new published CSV link.

## After upload

1. Upload/replace the listed files.
2. Wait for GitHub Pages to finish publishing.
3. Hard refresh with Ctrl+Shift+R.
4. If the PWA still shows old behavior, clear site data once or uninstall/reinstall the PWA.


## v1.1.8
- Added Receiving / InvRec Print module.
- Supports full 13-column receiving sheet: Location, LWH_ID, Customer_ID, Customer, InvRec, BillToRef, ItemNm, ItemDesc, LotNum, Qty, Units, BayName, DateReceived.
- Inventory lookup now has Print All Found.
- Pallet labels enlarged again for forklift readability while retaining Customer ID QR.
