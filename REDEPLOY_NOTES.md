# Sonoco Inventory & BOM — v1.87.0

## 1. Apps Script (do this first, once per project) — full steps in docs/SONOCO_INVENTORY_SETUP.md
| Project | Replace Code.gs with |
|---|---|
| Sonoco Inventory (Spool Works) | `gas/SonocoInventoryAPI.gs` |
| Sonoco BOM Inventory | `gas/SonocoBomAPI.gs` |

For each: back up → paste → run `setupToolkitApi` → add employee IDs on the new **Access** tab →
Manage deployments → edit → **New version** (Execute as Me, Anyone).

## 2. URLs
Put both /exec links in `js/sonocoinv.js` (`API_DEFAULT`), or paste them on the Connect screen on each device.

## 3. Files in this release (everything else is unchanged)
- `js/sonocoinv.js` — **new file**
- `js/sonocoreels.js` — Sonoco switch at the top
- `index.html` — menu entry, screen, script tag, version 1.87.0
- `js/hometiles.js` — Sonoco Inventory & BOM tile
- `css/app.css` — styles at the end
- `service-worker.js` — cache v1-87-0, new file cached
- `gas/SonocoInventoryAPI.gs`, `gas/SonocoBomAPI.gs`, `docs/SONOCO_INVENTORY_SETUP.md` — reference copies
- `CHANGELOG.md`, `README.md`, `REDEPLOY_NOTES.md` — docs

Hard refresh after it's live; on phones close and reopen the app once with signal.
