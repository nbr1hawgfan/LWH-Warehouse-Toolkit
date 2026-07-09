# LWH Warehouse Toolkit v1.4.0

Internal Logistics Warehouse PWA for lookup, labels, receiving print, signs, contact QR cards, and visitor badges.

## v1.4.0 focus
- **One data source.** Receiving/InvRec Print now reads from the same master sheet as Master Lookup, matching InvRec against the `INV_Receipt` column. No more keeping two CSVs in sync — see `docs/GOOGLE_SHEET_SETUP.md`.
- Removed the now-unused legacy Inventory Lookup screen and Receiving Print Source setting.
- Pallet labels: dropped the Details QR (per forklift driver feedback — it wasn't reliably scannable), widened the 1D barcode into that space, and added a large, high-contrast Item number for faster floor identification.
- Added Vendor and Unique 8 to the printed label; Date Received/Description now only show when there's actual data for them.
- Mobile nav collapses behind a menu button on phones; search results populate live as you type/scan.
- Auto-print after generating labels from search results — no separate trip to a Print button.

## Deployment
Upload the full unzipped contents to the GitHub Pages repository root and hard refresh after deployment.
