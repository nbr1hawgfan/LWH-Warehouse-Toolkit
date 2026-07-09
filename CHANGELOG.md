# Changelog

## v1.10.2
- **Pallet label:** Customer ID is now its own large, fully-centered line right under the header (was small text tucked next to the location). Location itself is unaffected — it's already shown in the field grid below, so nothing was lost by pulling it out of that line. Made small compensating trims to header/grid spacing to help keep everything on one label.

## v1.10.1
- **Fixed Trailer Checklist print cutoff.** Found the real cause: the tables weren't using a fixed layout, so long question text could occasionally force the table wider than the page, spilling off the right edge. Added `table-layout:fixed` so columns stay within bounds regardless of text length. Also tightened page padding and trimmed remaining vertical spacing further to guarantee one page even in the tightest cases.
- Note: if pages still print with a bigger left margin than expected, check the browser's print dialog for a "Margins" setting — some browsers apply their own default margin on top of the page's CSS unless it's explicitly set to "None."
- **Pick List:** added a Bay filter field. **All four filters (Customer, Item #, Lot #, Bay) now accept comma-separated multiple values**, OR'd within that field — e.g. entering several item numbers picks everything for all of them in one combined, one-shot printed list instead of one search/print per item.

## v1.10.0
- **New: Pick List Generator** — new top-level screen (lives next to Master Lookup/Trailer Checklist since it reads the same master sheet). Filter by any combination of Customer, Item #, and Lot #; results show quantity and bay location per match. "Generate Pick List" prints a landscape table report — one row per matching pallet/location, each with a small scannable QR code or 1D barcode (your choice) for the LWH ID, so a forklift driver can scan straight off the printed sheet. Long result sets paginate cleanly across multiple pages with the header row repeating on each.

## v1.9.1
- **Generate Code:** added a Share button — converts the on-screen QR or barcode into a PNG and sends it through the phone's native share sheet (same pattern already used elsewhere in the app), with a download fallback if sharing isn't supported.
- **Doc Scanner:** added "Download as PDF" — combines every captured page into one real, multi-page PDF file (each photo fit to its own letter-size page), good for handing off something like a signed Bill of Lading as a single document instead of loose photos. "Share All Pages" (individual images via the native share sheet) is still there too, for whoever prefers that instead.

## v1.9.0
- **New: Trailer Cube** — Warehouse Tools tab estimating how many units of a given size fit in a 53' dry van. Tries the unit both ways (as-is and rotated 90°) and picks whichever fits more per layer, multiplies by stacking height, and separately checks the trailer's weight limit — reporting whichever one (cube or weight) is actually the limiting factor, since heavier product often hits the weight cap well before it hits the cube cap.
- Save common or odd-sized units as named profiles (e.g. "Standard Pallet," "Customer A Crate") so dimensions don't need retyping every time.
- "Generate Printable Summary" produces a clean one-page printout — unit size, trailer specs, and the estimated fit — meant to be handed to a forklift driver.
- Trailer interior dimensions and weight limit default to standard 53' dry van figures but are fully editable if your fleet's actual clearances differ.

## v1.8.0
- **New: Quick Message** — Warehouse Tools tab for flagging something to a manager fast (e.g. "can't load Dock 5, hole in floor" + a photo). Settings gets a new Managers list (name + email); Quick Message picks a manager from that list, takes a message and an optional photo, then sends. No photo → opens the email app addressed straight to the manager. With a photo → opens the phone's native share sheet instead (since mailto: can't attach files), with the manager's name/email included in the shared text as a reference.
- Honest limitation, not a bug: this is not real-time in-app messaging — there's no backend, no message history, nothing syncs between devices. It's a fast way to start a properly-addressed email/share, nothing more. True chat would need an actual backend, which is a separate project.

## v1.7.2
- **Trailer Checklist:** renamed the second signature back to Driver/Carrier Signature (from Manager/Supervisor), matching current standard.
- **Trailer Checklist:** General Trailer GMP now pre-checks No, Pre-Shipment Checklist now pre-checks Yes — matches how these almost always come back, saves a tap per row. Both still fully changeable per row, and "Clear Form" resets back to these defaults rather than blank.
- **Trailer Checklist:** added an optional driver's license photo capture — snap a photo, it prints as a second page alongside the checklist. Skip it and the checklist stays a single page like before.

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
