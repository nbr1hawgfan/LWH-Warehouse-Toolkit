# Google Sheet Setup

There are **two separate CSV sources** in Settings — make sure each published sheet matches the right column layout below.

## Master Lookup Source
Feeds the Master Lookup screen (the one used for day-to-day searching). Publish this sheet as CSV and paste the published CSV URL into **Settings → Master Lookup Source**.

Expected columns, in order:

```text
ControlNumber, INV_Receipt, SubCustNm, ItemNm, LotNum, Qty, Location, Comments, Vendor, Unique2, Unique3, Unique5, Unique6, Unique7, Unique8, Warehouse, BayName, Still_In_Inventory, CurrentBay
```

## Receiving Print Source
Feeds Receiving/InvRec batch label printing. Publish this sheet as CSV and paste the published CSV URL into **Settings → Receiving Print Source**.

Expected columns, in order:

```text
Location, LWH_ID, Customer_ID, Customer, InvRec, BillToRef, ItemNm, ItemDesc, LotNum, Qty, Units, BayName, DateReceived
```

## How to publish a Google Sheet as CSV
1. In Google Sheets: **File → Share → Publish to web**.
2. Choose the specific sheet/tab, set format to **Comma-separated values (.csv)**, then **Publish**.
3. Copy the generated URL and paste it into the matching Settings field above.
4. Use **Test Load** in Settings to confirm the app can read it before relying on it.
