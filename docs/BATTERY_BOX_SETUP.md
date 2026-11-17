# Battery Box & BOM — setup (Warehouse Toolkit v1.89.0)

One Toolkit screen replaces the "BOM Inventory — Manager Portal" Apps Script page. The **BOM Inventory** Google Sheet
stays the database, and the script keeps every email, timer and the Battery Box Shipment Tracking sync.

| Sheet / project | Old page | New Code.gs | Keeps doing |
|---|---|---|---|
| **BOM Inventory** (`1Z2HUvxf…jx00`) | BOM Inventory — Manager Portal | `gas/BatteryBoxAPI.gs` | Production run, shipment, cancellation and low-stock emails · 8 AM daily inventory report · Saturday 6 PM weekly customer report + CSV · 7 AM sync to the Battery Box Shipment Tracking sheet · the Sheet's "Inventory System" menu |

No tabs are moved or renamed. Two new tabs are added: **Access** and **Stock_Log**.

## Do this once

1. **Back up.** File → Make a copy of the Sheet, and save the current `Code.gs` text somewhere.
2. **Replace Code.gs** with `gas/BatteryBoxAPI.gs` (all of it). Leave the `index` HTML file alone. Save.
3. **Run `setupToolkitApi`** once from the editor and approve the permissions prompt (it now calls an outside service
   to check the Toolkit sign-in). It adds the **Access** and **Stock_Log** tabs and changes nothing else.
4. **Access tab:** one employee ID per row in column A (the ID used to sign in to the Toolkit). Column C is the role:
   `edit` (default if blank) or `view` (can look; can't build, ship, receive, change counts, edit orders / BOMs / customers, send emails or set timers).
   Optional: Script Property `ADMIN_EMP_IDS` (comma list) is always let in with edit.
5. **Deploy → Manage deployments → pencil → Version: New version.** Execute as **Me**, Who has access **Anyone** → Deploy.
   The /exec link stays the same. The old page now shows a "moved" notice with a button into the Toolkit.
6. Check: open `<exec link>?health=1` → `{"ok":true,"service":"LWH Battery Box BOM API","version":"1.89.0"}`.

Then put the /exec link in `js/batterybox.js` (`API_DEFAULT`) so every device connects on its own — or paste it on the
Connect screen the first time on a device.

The timers you already have keep running (they call the same function names). If you ever need to set them again, the
Reports tab has a button for each (it replaces the old one, never doubles it).

## Check it
- Home → search "battery" → **Battery Box & BOM**.
- **Dashboard:** same numbers as the old page.
- **Build:** pick an item and quantity → the preview shows each component, what's on hand and what's left after.
  Record 1 → components drop on the Inventory tab, Master_Stock goes up 1, a Production_Log row with your name, the production email.
- **Orders → Ship:** one row per box for FedEx tracking + LD number (Enter jumps to the next box). Ship → Shipments row,
  order marked Shipped, Master_Stock down, Production_History row with the Shipment_ID, the shipment email.
- **Components → Set count** → the Inventory tab changes and a row appears on **Stock_Log** with who / from / to.
- **Reports → Sync now** → new boxes appear on the Battery Box Shipment Tracking sheet.
- Someone not on the Access tab → "You don't have access".

## What changed in the script
- New `doPost()` API with the sign-in check (bottom of the file, under "TOOLKIT API"); `doGet()` shows the "moved" page.
- **One save at a time:** builds, shipments, receiving, counts, orders, components, BOMs and customers take a lock, so two
  people saving together can't overwrite each other's numbers.
- **Who did it:** Built By / Shipped By / Received By start as the signed-in name. If someone enters it for another
  person, "Entered by …" is added to Notes.
- **Shipping** uses the order on the Sheet for customer, address, item and quantity (not what the phone sends), and an order
  already Shipped or Cancelled can't be shipped again (no double deduction from a second tap).
- **LD numbers stay with their box.** A box with no LD between two that have one used to shift the later LD numbers up a box in
  the emails, reports, CSV and tracking sheet. Fixed — this also fixes older shipments already saved.
- **BOM re-save fix:** saving an existing BOM item used to delete only its first row, leaving the other component rows behind —
  they then counted as part of the item above it. Saving now replaces the item's whole block.
- A component listed twice on one BOM is added up before the stock check.
- PO numbers on the shipment reports / weekly CSV come from the Shipment_ID (exact) instead of matching item + date.
- Receiving IDs use the full timestamp (they could repeat).
- New: change a component's low / critical limits from the screen (they could only be set when the component was added).

## Going back
Paste the old `Code.gs` back, then Manage deployments → New version. The Sheet is unchanged apart from the Access and Stock_Log tabs.
