# Changelog

## v1.30.0
- **New: App Shortcuts** — long-press (or right-click, on desktop) the installed app icon for quick jumps straight to Master Lookup, Pick List, Bill of Lading, or Warehouse Tools, skipping the Home screen. Android and desktop Chrome/Edge; not supported on iOS.
- **New: Share Target** — the installed app now shows up in the device's share sheet for text and links (e.g. sharing an address or a note from another app). Shared content lands in Warehouse Tools → Notepad automatically. File/photo sharing (e.g. straight into Doc Scanner) is a possible future add — more involved since it needs a service-worker-level handler, not added yet.
- No backend, no new data collection — both are pure manifest + client-side routing, same trust model as everything else in the app.

## v1.29.0
- **Pick List: added a Warehouse filter** alongside Customer/Item/Lot/Bay.
- **New: Item Summary** in Pick List — a second print output (next to the existing detailed Pick List) that groups matching inventory by Item → Bay → Lot and sums quantity, e.g. "Bay X: 20 @ Lot 8000, 1 @ Lot 6250 · Bay Y: 44 @ Lot 8000" — a compact reference for a picker instead of a long row-by-row table. Same search filters drive both outputs.
- **Home screen greeting is now personalized** — since the app already captures a name for usage tracking, "Good Morning"/"Good Afternoon"/"Good Evening" now includes it (e.g. "Good Afternoon, Tim!") once a name's been entered. Updates immediately on first-time setup or if the name is changed later in Settings.
- **Weather now stands out on the Home screen** — larger, bolder, brand-colored, matching the prominence the clock already had instead of blending into a plain hint line.

## v1.28.0
- **New: Axle Weight Check** — enter Steer, Drive, and Trailer axle weights plus Gross Vehicle Weight, checked against editable limits (federal defaults: 12,000 / 34,000 / 34,000 / 80,000 lb). Flags each axle group and the overall load as legal or overweight, with the amount over/under shown. Not a substitute for a scale ticket — state and bridge-formula rules can be more restrictive than the federal defaults shown.
- **Distance / Route Planner: added an "Estimated Time for the Day" total** — combines calculated drive time with an optional Dwell (min) field per stop (loading, unloading, breaks — whatever you know ahead of time), so a multi-stop day (e.g. Fort Smith → Wilburton, OK → Oklahoma City, OK → back) shows one total. Flags when drive time alone is approaching (9h+) or over (11h+) the federal daily driving limit — an awareness flag, not an ELD/HOS replacement.

## v1.27.0
- **Bill of Lading: removed Standard BOL, Simple/Generic BOL is now the only mode.** No more mode toggle — one clean form (Ship From/To, Carrier/Driver, Item table, three signatures). Printed BOL now carries brand-color accents (header rule, box borders, section titles, table headers) instead of plain black/white, with print-color-adjust set so those colors actually survive to the printed page.
- **Warehouse Tools: added an explicit Download button to Generate Code**, next to Share — Download always saves the PNG straight to the device; Share still opens the native share sheet where supported (and falls back to download automatically where it isn't).
- **New: Age Calculator**, folded into the Date Calc tab — enter a date of birth and any "as of" date (defaults to today) to get exact age in years/months/days, plus total days lived.
- **New: Loan Calculator** tab — Loan Amount, Down Payment, Interest Rate, and Term produce a standard amortizing Monthly Payment, Total Interest, and Total Paid.
- **New: Cost per Square Foot** tab — enter a landlord's annualized rate (e.g. $3.25/sq ft/year) to get the true monthly rate per foot, and optionally enter total square footage for full monthly/annual dollar costs.

## v1.26.1
- **Simple BOL: added Seal Number and Truck Number (optional)**, separate from Trailer Number.
- **Simple BOL: added optional Weight per item row**, plus a new "Item Totals" summary table on the printed BOL — rolls line items up by Item Number (same item across multiple lots gets summed together), showing total Qty, total Pallets, and total Weight per item, with a bold Grand Total row. Verified against a real multi-lot example.

## v1.26.0
- **Bill of Lading: added a Simple/Generic mode.** New toggle at the top — Standard BOL (the full short-form with freight terms/NMFC/class) or Simple/Generic BOL: just Ship From/To, Carrier/Driver, and an Item Number/Lot Number/Description/Qty/# of Pallets table — no internal warehouse IDs required. Meant as a genuine backup document a driver could fill out anywhere, including at a customer pickup where the real BOL was lost or never issued. Three drawable signatures (Warehouse, Carrier, Consignee), matching how the simple mode is actually meant to be used in the field.
- **New: Download PDF and Share/Email PDF** for the Bill of Lading — renders whatever was generated into a real PDF file (not just relying on the print dialog), and Share hands it to the phone's native share sheet so it can go straight into Mail, Messages, or wherever. Works great for a typical one-page BOL; genuinely long multi-page BOLs are more reliably exported via Print → Save as PDF instead, since that path paginates properly the way browser printing does and this one doesn't automatically.

## v1.25.0
- **New: Bill of Lading** — fillable form matching the standard short-form BOL layout (Ship From/To, Third Party Bill To, Freight Terms, Customer Order Information and Carrier Information as dynamic add/remove-row tables, COD/fee terms, trailer-loaded/freight-counted, and the standard DOT liability/certification legal text). Company logo prints automatically in the header (Settings → App Settings). Drawable Shipper and Carrier signatures using the same Pointer Events approach as the Trailer Checklist — works with finger, stylus, or mouse, embeds directly into the printed page if drawn, falls back to a blank line for pen-and-paper signing otherwise. Full page, 8.5×11.

## v1.24.0
- **New: read results aloud.** When a Master Lookup search returns exactly one match, the browser's own built-in text-to-speech reads back Item, Bay, and Quantity — no external service, no API, no network call, works offline. Defaults on (Settings → App Settings → "Read Master Lookup results aloud"), easy for anyone to turn off individually. Only triggers on a single clean match, not broad multi-result searches.

## v1.23.1
- **Usage Log URL is now baked in as the default** — same pattern as Managers/Quick Links. Every device just needs someone's name entered once; the logging endpoint itself works automatically, no URL to paste or configure.

## v1.23.0
- **New: simple usage tracking.** One-time prompt for your name (self-reported, no login/authentication — just enough to know who's using the app), then a single ping per day to a Google Sheet via a small Apps Script endpoint (same tech as Forklift Inspection/PTO/Safety Training, no new cost). Settings → Usage Tracking holds your name and the log URL. A pivot table on the raw log turns it into "John Smith — 12 days this month" with no formulas to maintain. Fails silently if unconfigured or offline — this is informational only and should never interrupt actual work.

## v1.22.0
- **New: Text extraction (OCR) in Doc Scanner** — each captured page now has an "Extract Text" button using Tesseract.js, which runs entirely in the browser via WebAssembly rather than any OS-native camera text detection. That's a deliberate choice: iOS Safari never implemented the browser text-detection API Android's Chrome exposed, so anything relying on that would only ever work on Android. This approach reads printed text the same way on both platforms. Extracted text appears in an editable box (fix any misreads before copying) with a Copy Text button. Works best on printed text, not handwriting — first extraction on a page is a bit slower since it loads the OCR engine over the network; faster on subsequent pages in the same session.

## v1.21.0
- **Fixed the voice search phone-number trap** — speech recognition was auto-formatting spoken digit sequences like a phone number (e.g. "4226615" coming back as "422-6615"), breaking numeric lookups. Now detects when the whole result is just digits once dashes/spaces are removed, and uses the plain digit string instead. Master Lookup's voice search specifically benefits; word-based speech elsewhere is untouched.
- **New: Translate** — Warehouse Tools tab using MyMemory's free, keyless translation API (no account, no billing, nothing to expose on the public repo). Type, paste, or speak a phrase, pick From/Language, get it translated — plus six Quick Phrase buttons for the exact carrier interactions described (paperwork, pickup/delivery number, dock directions, BOL, etc.) that translate in one tap. Swap button flips languages and carries the last result back into the input for a reply. Good for short practical exchanges; not a substitute for a paid service on long or complex text.

## v1.20.0
- **Safety Training added as a third hardcoded Quick Link** — same pattern as Forklift Inspection/PTO Requests. Includes a one-time migration so devices that already had the app set up get it too, without needing to touch Settings, and without disturbing anything already customized there.
- **Calculator now shows what you entered** — a line above the main display shows the running expression (e.g. "9 × 9", then "9 × 9 =" once you hit equals), not just the current number.
- **New: voice search on Master Lookup** — a "Speak Search" button using the browser's built-in speech recognition. Say a barcode number or item, it fills the search box and runs the same live search as typing would. Feature-detected: the button only appears on browsers that actually support it, rather than showing something broken. Note for testing: voice-to-text can occasionally spell out digits as words rather than numerals depending on the browser — worth a real test to see how it behaves in practice.

## v1.19.0
- **Fixed a real bug found in your screenshot:** blank cells coming through from the sheet as the literal text "NULL" were printing on labels as if it were real data (e.g. Customer ID showing "NULL"). Now treated as blank everywhere it's used — pallet labels and Pick List both fixed at the source.
- **Pallet label: removed the small Item field from the grid** — the big Item number already covers it, so this was pure duplication. Frees up room and reduces clutter, consistent with the same reasoning already applied to Qty/Lot.
- **New: Fuel Cost Estimator**, built into the Distance tab — enter your truck's MPG and current fuel price, and it estimates trip fuel cost using whatever distance was just calculated (driving distance if available, straight-line as a fallback). Updates live as MPG/price change, no need to recalculate the route.

## v1.18.1
- **Pallet label: Qty and Lot now flank the 1D barcode** — Qty large on the left, Lot on the right, matching what forklift drivers said they actually need at a glance. Removed from the small field grid since they're now prominently shown here instead (no more duplication, and it freed up some room in an already-tight layout).
- **New opt-in "Include Item # Barcode"** checkbox on Pallet Labels — adds a small barcode under the big Item number for customers who want to scan for their item number specifically. Off by default and clearly marked as worth testing before relying on it, since this label's vertical space is genuinely tight after everything that's been added.

## v1.18.0
- **New: Distance / Route Planner** — Warehouse Tools tab. Enter city+state or ZIP for a From and To (add more stops for multi-point trips like A → B → C), get driving distance, estimated drive time, a per-leg breakdown, and a map with the route plotted. Uses OpenStreetMap (Nominatim) for geocoding and OSRM's public server for routing — both free and keyless, no account or billing setup needed, no API key exposed on the public repo. Honest tradeoff: these are free shared community services, not paid infrastructure with an uptime guarantee, so occasional slowness or brief unavailability is possible; if the routing service is down, it falls back to showing straight-line distance instead of failing outright. Neither external service could be tested from this environment (no network path to them from here), so this is genuinely worth trying live before relying on it.

## v1.17.1
- **Split back into two distinct badge types**, correcting the earlier merge: Timecard Badge (simple, name/ID/barcode, landscape) and ID Badge (full front/back with logo/photo/title, portrait) are now separate modes on the same screen, switchable with a toggle at the top — one tap either way, sharing the Name/ID/code-type fields where it makes sense.
- **Fixed ID Badge orientation** — was printing landscape (3.375×2.125in), which reads sideways once clipped to a lanyard. Now prints portrait (2.125×3.375in) front and back, so it reads right-side-up hanging normally. Timecard Badge is unchanged — still landscape, since that's what already tested well on the printer.

## v1.17.0
- **Employee Timecard Badge evolved into a full Employee ID Badge** — front and back, same CR80 card stock as before. Front: your company logo and tagline (pulled automatically from Settings → App Settings), employee photo, name, and title/department. Back: the barcode or QR for door access/WMS scanning. "Front & Back (CR80)" generates both sides as a 2-page job; "Front Only, Letter Sheet" is the fallback for printers that won't accept a custom small page size.
- Added a Company Tagline setting (Settings → App Settings) — optional, shown on the badge front under the logo.
- HID DTC1000 duplex (both-sides-in-one-pass) behavior is still untested against the actual hardware — sized correctly, but that's the piece I can't verify from here.

## v1.16.0
- **New: Storage Revenue & Profitability** — Warehouse Tools tab for multiple customers at once. Enter pallet count and rate per pallet per customer to see total monthly storage revenue; add pallet dimensions to see actual square footage occupied (same math as the Storage Space Estimator) and the effective $/sq ft being charged; add your own cost per sq ft to see real profit or loss per customer, not just revenue. Rows persist between visits. Verified the math against a real three-customer example — total revenue and per-customer profit/loss both came out correct.

## v1.15.0
- **Storage Cost Estimator**: added a $/sq ft rate to the existing Storage Space Estimator — gives an actual dollar quote alongside the square footage.
- **New: Case/Layer/Pallet Counter** — units per case × cases per layer × layers per pallet = units per pallet; flip it around with a target quantity to see how many pallets are needed and how full the last one is.
- **New: Health tab** (BMI + Body Fat % via the U.S. Navy circumference method). Nothing entered here is ever saved anywhere, not even in local storage — it exists only while the screen is open and disappears the moment it's closed, matching the privacy point about personal devices.

## v1.14.0
- **Pallet Footprint: 4 size presets** — Standard 40×48, Bulk 56×44, Euro 47.5×39.8, and Small Standard 42×42, each one tap to fill in.
- **New: Employee Timecard Badge** — prints at exact CR80 card size (3.375×2.125in, standard credit-card size) with employee name, ID, optional department, and a 1D barcode or QR encoding the employee ID for time clock scanning. Two modes: Single CR80 Card (no cutting needed at all if the printer/OS accepts a custom small page size, or feeding straight to a card printer) and Multiple on Letter Sheet (tiles several badges on standard 8.5×11 paper with a visible border to cut along, for any printer that won't do custom page sizes). Honest note on the HID DTC1000 specifically: whether it accepts a direct browser print job depends on its own driver being installed and selected — the badge is sized exactly to what it expects, which is the main requirement, but this hasn't been tested against the actual hardware.

## v1.13.3
- **Customer ID QR moved off the bottom corner** — now sits in its own box directly beside the field grid (near Bay/Lot/InvRec), and made noticeably larger (was ~.72in in a shared corner, now ~.95in with its own dedicated space). Should scan much easier on rounded/curved units where the far corner was hard to reach. Item number stays full-width and prominent below the grid, unaffected. Barcode at the bottom now has the full row to itself and can run wider since it's no longer sharing space with the QR.

## v1.13.2
- **"Unique8" is now labeled "Item Description"** in Master Lookup results and on the printed pallet label, matching how the field is actually being used. Pure display-layer change — the sheet's actual column header doesn't need to change, and nothing about searching or parsing was touched. Both places now pull the same customizable label, so if it's ever renamed again in Settings → Customer Field Labels, the printed label updates right along with Master Lookup automatically.

## v1.13.1
- **Quick Links: Forklift Inspection and PTO Requests are now baked in as defaults** — every fresh install shows both on the Home screen automatically, no pasting links required. Seeded once on first run only, so anyone who edits or removes them later won't have that undone on a future load. Added a "Reset to Defaults" button in Settings too.

## v1.13.0
- **Date Calc:** added Day of the Week — enter any date, get the weekday back. Works for any date, past or future (verified against Jan 15, 1971 → Friday).
- **New: Quick Links** — Settings gets a new card to add named shortcuts (e.g. Forklift Inspection, PTO Request) with a URL each; they show up as tappable cards on the Home screen, opening in a new tab. Note: these are links, not embeds — Google Apps Script web apps generally block being embedded in another app's iframe via their own security headers, so true in-app embedding isn't realistic. This is the practical equivalent: one tap from Home to jump straight to any other tool.

## v1.12.0
- **New: Date Calc** — Warehouse Tools tab with three parts: days between two dates, add/subtract days from a date, and a bidirectional **Julian (day-of-year) date converter** for reading date codes off overseas/manufactured product packaging. YYDDD (5-digit, e.g. 24001 = Jan 1, 2024) is unambiguous; shorter 4/3-digit codes are also accepted, picking the closest matching year when the format is ambiguous. Verified against real dates including a leap-year edge case (Dec 31, 2024 → 24366) in both directions.

## v1.11.2
- **Managers CSV link is now baked in as the default** — every install auto-loads your real manager list on open with no sharing or manual setup needed, same as Master Lookup's default sheet. Settings still shows the link and allows overriding it per-device if ever needed, plus a "Reset to Default" button.

## v1.11.1
- **Fixed Managers CSV parsing:** the sheet's actual export came back tab-separated rather than comma-separated. Parser now auto-detects either delimiter, same safety trick already used for the Master Lookup sheet. Verified against your real 12-manager list — all parse correctly now.

## v1.11.0
- **Managers can now load from a Google Sheet CSV**, same auto-load-on-open pattern as Master Lookup — Settings → Managers gets a new CSV URL field, Load button, and status line. Expected format is dead simple: two columns, Name and Email. This is a completely separate, independent parser from the Master Lookup sheet's 19-column schema — touching one can't affect the other. Manual add/edit/remove is still there too, for quick local additions.

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
