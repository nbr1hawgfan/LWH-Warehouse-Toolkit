# Google Sheet Setup

One CSV source now feeds everything: Master Lookup **and** Receiving/InvRec Print. Publish the sheet as CSV and paste the published CSV URL into **Settings → Master Lookup Source**.

Expected columns, in order:

```text
ControlNumber, INV_Receipt, SubCustNm, ItemNm, LotNum, Qty, Location, Comments, Vendor, Unique2, Unique3, Unique5, Unique6, Unique7, Unique8, Warehouse, BayName, Still_In_Inventory, CurrentBay
```

Receiving/InvRec Print finds pallets by matching InvRec against the `INV_Receipt` column, then builds labels the same way Master Lookup does — same fields, same barcode, same layout, no separate source to keep in sync.

## How to publish a Google Sheet as CSV
1. In Google Sheets: **File → Share → Publish to web**.
2. Choose the specific sheet/tab, set format to **Comma-separated values (.csv)**, then **Publish**.
3. Copy the generated URL and paste it into Settings → Master Lookup Source.
4. Use **Test Load** in Settings to confirm the app can read it before relying on it.
