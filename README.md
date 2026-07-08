# LWH Warehouse Toolkit v1.2.1

Internal PWA for Logistics Warehouse labels, signs, visitor badges, inventory lookup, receiving label printing, camera scanning, and customer lookup.

## v1.2.1 additions

- New **Customer Lookup** module.
- Separate Customer Lookup CSV source.
- Searches all customer fields, including generic/hidden report fields.
- Shows all customer lookup columns in result cards.
- Shows which field matched the search.
- Lets users copy a full result for phone calls.
- Lets users print pallet labels from customer lookup results.
- Supports friendly display labels for Unique2, Unique3, Unique5, Unique6, Unique7, and Unique8.

## Customer Lookup source layout

Expected published CSV headers:

```text
ControlNumber, INV_Receipt, SubCustNm, ItemNm, LotNum, Qty, Location, Comments, Vendor, Unique2, Unique3, Unique5, Unique6, Unique7, Unique8, Warehouse, BayName, Still_In_Inventory, CurrentBay
```

Default Customer Lookup CSV:

```text
https://docs.google.com/spreadsheets/d/e/2PACX-1vR88eoG2Hhmq_JCsS_jZMnBiTWlcmehB4i0A5Z6BXZ2oykJ0KqGB6IhrZc0Tr5l5ZOYxtuy8OffpPL-/pub?output=csv
```

## Deployment

Upload all files/folders in this ZIP to the GitHub Pages repo root, replacing existing files. Then hard refresh the site. If the PWA still shows the old version, clear site data once or unregister the service worker.
