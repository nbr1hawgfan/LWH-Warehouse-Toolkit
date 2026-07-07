# LWH Warehouse Toolkit v1.1.4

Patch focus:

- Hard-coded Tim's published Google CSV as the default inventory source.
- Shows the exact URL being loaded on the Inventory Lookup screen.
- Adds Reset to Default CSV in Settings.
- Improves lookup error messages so a failed URL is visible.
- Updates service worker cache to v1.1.4 and uses network-first for app files.
- Keeps 4x6 auto-fit label improvements from v1.1.3.

## Changed files

Replace these files in the repo:

```text
index.html
service-worker.js
js/app.js
js/inventory.js
js/labels.js
```

After upload, open the app and press Ctrl+Shift+R. If the old app still appears, open DevTools > Application > Service Workers > Unregister, then refresh.
