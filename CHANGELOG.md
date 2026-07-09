# Changelog

## v1.7.1
- **Trailer Checklist:** compressed spacing throughout so it fits on one printed page instead of spilling onto a second.
- **Trailer Checklist:** added digital signature pads (Loader and Manager/Supervisor) — draw with finger, stylus, or mouse; captured signature embeds directly into the printed checklist. Leave blank to sign by hand after printing, same as before.
- **New: Scan Code tool** in Warehouse Tools — a standalone barcode/QR reader (paired with Generate Code), reusing the same scanner already proven in Master Lookup and Pallet Labels. Scan, then Copy / Add to Notes / Email the result.

## v1.7.0
- **New: Trailer Pre-Loading Checklist** — a printable digital version of the paper GMP/pre-shipment checklist, matching the reference form: Door #, Date, Time, Carrier Name, Trailer Number, Seal Number, plus Driver Name and Driver's License # added per request. Both Yes/No checklists (General Trailer GMP and Pre-Shipment), Notes/Comments, the rejection warning, acknowledgment statement, and blank signature lines for Loader and Manager/Supervisor to sign by hand after printing.

## v1.6.0
- **Ad-hoc QR/Barcode Generator** — new Warehouse Tools tab: type or paste anything, get a QR code or 1D barcode instantly, printable directly (unlike the other Warehouse Tools panels, which are screen-only).
- **Scan to Notes** — new button in the Notepad tab. Reuses the same barcode/QR scanner already proven in Master Lookup and Pallet Labels; scans straight into your notes, which can then be copied or emailed same as before.

## v1.5.3
- Hardened the Storage Space Estimator: if any expected field is missing it now logs a clear console error instead of silently doing nothing, and calculations also listen for the `change` event as a fallback to `input`.
- Bumped the service worker cache version to force a clean re-fetch of all app files — if the estimator boxes were showing 0 despite valid inputs, this was very likely a stale cached JS file from before that feature existed. If it happens again after this update, fully close the app/tab (not just refresh) or clear site data for the page once, since PWA service workers can hold onto an old version until every tab is closed.

## v1.5.2
- Pallet Footprint expanded into a full **Storage Space Estimator**: enter pallet count, stack height, and drive-aisle allowance % to get an estimated total square footage — plus the reverse, enter available square footage to see how many pallets it could hold. Same pallet dimensions, stack height, and aisle % drive both directions.

## v1.5.1
- **Fixed:** document scanner camera showing a black screen — the video stream was attached but never actually told to play. Added the explicit play() call.
- Converter expanded: weight now includes ounces, added a linked Volume group (gallons/liters/quarts/fl oz), and a Liquid Weight Estimator (gallons × editable density = pounds — density is adjustable since it depends on the liquid, not hardcoded to water).
- Clarified that Weight/Length converter fields were already bidirectional — added a hint saying so.

## v1.5.0
- **New: Warehouse Tools** — a self-contained toolkit for the floor, no leaving the app: four-function calculator, unit converter (kg↔lb, in/ft/cm/m, all fields linked live), pallet footprint calculator (one-tap standard 40×48), a persistent notepad (copy to clipboard or email), and a basic document scanner (capture pages, optional contrast/grayscale enhance, share via the phone's native share sheet or download).
- **Pallet label fixes:** Item number now a fixed large size (was silently shrinking due to a bug where a second auto-fit pass used its own already-shrunk size as the new ceiling — fixed generally, also benefits rack labels). All label field values now explicit bold black instead of relying on inherited styling; added a meta tag to stop iOS from auto-linking numbers blue.
- **Real bug fix:** clearing the Master Lookup or Receiving InvRec search box left stale results on screen instead of clearing them. Fixed, and added explicit Clear buttons to both screens.
- Live clock added to the home screen.

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
