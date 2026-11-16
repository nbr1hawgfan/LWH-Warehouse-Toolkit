# Sonoco Reels — v1.86.0

## 1. Apps Script (do this first) — full steps in docs/SONOCO_REELS_SETUP.md
1. Back up the Sheet and the old Code.gs.
2. Replace Code.gs with `gas/SonocoReelsAPI.gs`. Leave Index.html alone.
3. Run `setupToolkitApi` once. Put the allowed employee IDs on the new **Access** tab.
4. Deploy → **New deployment** → Web app (Execute as Me, Anyone). Copy the /exec URL.

## 2. URL
Put it in `js/sonocoreels.js` (`SR_API_DEFAULT`), or paste it on the Connect screen on each device.

## 3. Files in this release (everything else is unchanged)
- `js/sonocoreels.js` — **new file**
- `index.html` — menu entry, screen, script tag, version 1.86.0
- `js/hometiles.js` — Sonoco Reels tile under Time & Hours
- `css/app.css` — Sonoco Reels styles at the end
- `service-worker.js` — cache v1-86-0, new file cached
- `gas/SonocoReelsAPI.gs`, `docs/SONOCO_REELS_SETUP.md` — reference copies
- `CHANGELOG.md`, `README.md`, `REDEPLOY_NOTES.md` — docs

Hard refresh after it's live; on phones close and reopen the app once with signal.

## 4. Check after deploy
- Signed in as someone on the Access tab → Home → search "sonoco" → opens.
- Save an entry → Production tab has the row with your name in column F; Dashboard tab updated.
- Reports → Weekly incentive → Last week matches Monday's email.
- Someone not on the Access tab → "You don't have access".
- Bookmark: `index.html?view=sonocoReels` opens straight to it.
- When happy: archive the old web app deployment.
