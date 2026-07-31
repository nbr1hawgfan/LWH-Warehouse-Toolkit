# LWH Warehouse Toolkit v1.3.0

## Biggest fix
Master Lookup now actually auto-loads when the app opens. Before this release, only the Receiving CSV was fetched on startup — the Master Lookup screen (the one everyone searches) depended on whatever was cached from the last manual "Load / Refresh Data" click. Settings also had no field to view or change the Master Lookup source at all. Both are fixed: each source loads independently on open, and Settings now has a dedicated Master Lookup Source card.

## Redesign
New teal-based look and feel — spacing, type, and cards were cleaned up across every screen. Logo and color customization from Settings still work exactly as before; the default color is now a deep teal instead of maroon. Emoji in navigation and Quick Actions were replaced with a small custom icon set. Label, sign, and badge print output was not touched.

## Camera scanning
The camera scanner now uses the same approach proven reliable on iPhone in LWH_Master-Lookup (the html5-qrcode library), replacing the previous implementation.

## Why
Same goal as before: fewer wrong clicks, less confusion on the floor, fewer calls saying the app "isn't working" when it's really just waiting on stale data.
