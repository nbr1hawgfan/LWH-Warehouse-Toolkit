# Sonoco Inventory & BOM — setup (Warehouse Toolkit v1.87.0)

One Toolkit screen replaces two Apps Script pages. Both Sheets stay the database and keep their own emails.

| Sheet / project | Old page | New Code.gs | Keeps doing |
|---|---|---|---|
| **Sonoco Inventory** | Spool Works Dashboard | `gas/SonocoInventoryAPI.gs` | 7 AM inventory & open orders email, 7 AM shipment email, TLand inventory snapshot CSV |
| **Sonoco BOM Inventory** | Sonoco Component Inventory | `gas/SonocoBomAPI.gs` | 8 AM component stock email |

The two IMPORTRANGE tabs (Components on the Inventory sheet, OpenOrders on the BOM sheet) are left alone. The Toolkit
reads open orders from the Inventory sheet and component stock from the BOM sheet directly.

## Do these steps once for EACH project

1. **Back up.** File → Make a copy of the Sheet, and save the current `Code.gs` text somewhere.
2. **Replace Code.gs** with the file from the table above (all of it). Leave the HTML file alone. Save.
3. **Run `setupToolkitApi`** once from the editor and approve the permissions prompt (it now calls an outside service
   to check the Toolkit sign-in). It adds an **Access** tab to that Sheet and changes nothing else.
4. **Access tab:** one employee ID per row in column A (the ID used to sign in to the Toolkit). Column C is the role:
   `edit` (default if blank) or `view` (can look, can't add / ship / build / change counts / send emails).
5. **Deploy → Manage deployments → pencil → Version: New version.** Execute as **Me**, Who has access **Anyone** → Deploy.
   The /exec link stays the same. The old page stops and shows a "moved" notice.
6. Check: open `<exec link>?health=1` → `{"ok":true,"service":"LWH Sonoco Inventory API"…}` (or `…BOM API`).

Then put both /exec links in `js/sonocoinv.js` (`API_DEFAULT`), or paste them on the Connect screen on a device.

## Check it
- Home → search "sonoco" → **Sonoco Inventory & BOM**. The switch at the top goes to Reels Production and back.
- **Open Orders:** matches the OpenOrders tab; tap an order to see its components.
- **Inventory:** add 1 to an item, then ship 1 → both appear under Transactions with your name, and
  `sonoco_inventory_current.csv` in the Drive export folder is refreshed.
- **Components:** Set count on one component → the Inventory tab of the BOM Sheet changes and a row appears on the new **Stock_Log** tab.
- **Builds:** pick an item → the preview shows what comes out of stock. Record 1 → components drop, Production_History gets a row with your name.
- Someone not on an Access tab → "You don't have access".

## What changed in the scripts
**Both:** new `doPost()` API with the sign-in check (bottom of each file, under "TOOLKIT API"); `doGet()` shows a "moved" page.

**Sonoco Inventory**
- Add / Ship take a lock, so two people saving together can't overwrite each other.
- The transaction log's User column gets the Toolkit sign-in name.
- If the TLand snapshot fails after a stock change is saved, the change is still reported as saved (it used to report a failure, inviting a duplicate entry). The next change re-exports.

**Sonoco BOM Inventory**
- Recording a build takes a lock and deducts nothing unless every component is covered. A component listed twice on a BOM is added up.
- Production_History records who entered the build instead of "Web User".
- Changing a count is locked, only works for components already on the Inventory tab (a typo no longer creates a new row), and is written to **Stock_Log**.
- Open orders match the exact BOM item number first, so items with a hyphen in their own name (`N0260150140A010-SP27`, `N0320190160A014- SP33`) are no longer "BOM Missing".
- The Toolkit screen uses each component's limits from the **Thresholds** tab. **The 8 AM email is unchanged** and still uses 10 / 20 for every component.

## Going back
Paste the old `Code.gs` back, then Manage deployments → New version. The Sheets are unchanged apart from the Access and Stock_Log tabs.
