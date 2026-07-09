# Changelog

## v1.4.0
- **One data source.** Receiving/InvRec Print now reads from the same master sheet as Master Lookup (matches InvRec against `INV_Receipt`), instead of a separate Receiving CSV that had to be kept in sync manually. Removed the Receiving Print Source setting and the legacy Inventory Lookup screen (unreachable dead code left over from an earlier version).
- Pallet label: removed the Details QR (forklift drivers reported it wasn't reliably scannable), widened the 1D barcode into the freed space, added a large high-contrast Item number for faster floor spotting, added Vendor and Unique 8 fields, made Date Received/Description conditional so they don't leave blank gaps on master-sheet data.
- Auto-print after generating labels from any search-result "Print" action.
- Mobile nav collapses behind a menu button on phones; live search as you type/scan (no button press needed).
- Time-aware greeting + local weather on the home screen.

## v1.3.0
- **Fixed Master Lookup auto-load**: startup was only auto-loading the Receiving CSV, never the Master Lookup CSV, so the screen everyone actually searches depended on stale/cached data until someone clicked Load / Refresh Data. Both sources now auto-load independently on open.
- **Added the missing Settings field** for the Master Lookup CSV source — previously there was no way to view or change it from the UI at all; only the Receiving Print source was exposed. Settings now has two clearly separate cards: Master Lookup Source and Receiving Print Source.
- **Redesigned the app chrome**: new teal-based design system (still fully user-configurable from Settings), consistent card/spacing/type scale, custom line-icon set replacing emoji in navigation and Quick Actions. Label/sign/badge print output is untouched.
- **Replaced the camera scanner** with the html5-qrcode-based implementation, ported from the LWH_Master-Lookup app, for reliable scanning on iPhone/Safari.
- Brand color hover/tint states now derive from whatever color is chosen in Settings, instead of a second color being hardcoded.

## v1.2.3
- Simplified lookup experience to one visible **Master Lookup** module.
- Removed separate Inventory Lookup / Customer Lookup choices from the user navigation.
- Master Lookup uses the customer/master CSV as the single lookup source.
- Settings now presents one Master Lookup Source to reduce confusion.
- Kept receiving print, labels, scanning, visitor badges, and print tools intact.

## v1.2.2
- Master customer CSV became the main inventory source.
- CSV auto-load on startup.
- Customer ID visible near the Customer ID QR.
