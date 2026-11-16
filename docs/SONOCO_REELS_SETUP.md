# Sonoco Reels — setup (Warehouse Toolkit v1.86.0)

Sonoco Reels moves the screens of the **Employee Production Tracker** Apps Script web app into the Toolkit.
The data stays in the **same Google Sheet**, and the same Apps Script project keeps sending the 8 AM daily
email and the Monday incentive email, and keeps writing the CSV that feeds TLand.

```
Toolkit (GitHub Pages)  ──POST + signed-in session──►  Production Tracker Apps Script (gas/SonocoReelsAPI.gs)  ──►  Google Sheet
                                                              │  asks Supabase whm_me "who is this?"
                                                              │  lets in only employee IDs on the Access tab
                                                              ├─ 8:00 AM daily email, Monday 10:30 incentive email
                                                              └─ Drive CSV → TLand
```

## 1. Back up
In the Sheet: **File → Make a copy**. In the Apps Script project, copy the current `Code.gs` somewhere safe
(a new file named `Code_OLD.gs.txt` works). Nothing below deletes data.

## 2. Replace Code.gs
1. Open the Apps Script project attached to the Sheet (Extensions → Apps Script).
2. Replace **all** of `Code.gs` with `gas/SonocoReelsAPI.gs`.
3. Leave `Index.html` and the other HTML files where they are for now.
4. Save.

From this moment the scheduled emails and the 5-minute rebuild run the new code (triggers always run the saved code).
The old web page keeps running its old published version until step 7.

## 3. Run the one-time setup
Pick **`setupToolkitApi`** → **Run** (or in the Sheet: Production Tracker menu → *Toolkit: set up Access tab*).
It adds, without touching existing data:

| Tab | What's added |
|---|---|
| **Access** | New tab: Employee ID, Name, Note. |
| **Production** | Headings in F–G: Entered By, Entered At (filled for entries made in the Toolkit). |
| **Attendance** | Headings in F–G: Entered By, Entered At. |
| **Production Issues** | Heading in H: Entered By. |

## 4. Say who gets in
On the **Access** tab, put one employee ID per row in column A — the same ID the person signs in to the Toolkit with.
Name and Note are for you. **Only IDs on this list get in**; being a warehouse manager is not enough, because
everyone who gets in sees cost, incentive and revenue figures and can add employees with pay rates.

Removing a row takes effect within 5 minutes. Optional break-glass: Project Settings → Script Properties →
`ADMIN_EMP_IDS` = your ID (always allowed, even if the Access tab is emptied).

## 5. Deploy
1. **Deploy → New deployment → Web app.** Execute as: **Me**. Who has access: **Anyone**.
   ("Anyone" is needed because the Toolkit runs on GitHub Pages. The script checks the sign-in and the Access tab
   on every request, and a browser visit to the link only shows a "has moved" page.)
2. Copy the new **/exec** link.
3. Check: open `<exec link>?health=1` → `{"ok":true,"service":"LWH Sonoco Reels API"…}`.

Using a **new** deployment (not editing the existing one) leaves the old web app link working exactly as it was.

## 6. Connect the Toolkit
Either put the link in `js/sonocoreels.js` (`const SR_API_DEFAULT='…/exec';`) so every device has it, or open
Toolkit → Home → **Sonoco Reels** on each device and paste it on the Connect screen.

## 7. Check it, then retire the old page
- Sign in to the Toolkit as someone on the Access tab → Home → search "sonoco" → **Sonoco Reels**.
- Enter → save one entry → it shows under "Entered for…" and on the Production tab with your name in column F.
- Save the same entry again → it asks before saving twice.
- Dashboard → This month matches the Dashboard tab. Reports → Weekly incentive → Last week matches Monday's email.
- Attendance → mark a Call-In → the weekly incentive shows that person INELIGIBLE with $0.00 payout → delete it → Eligible again.
- Sign in as someone **not** on the Access tab → "You don't have access".

When you're happy: **Deploy → Manage deployments → select the old deployment → Archive.** The old link stops working.
Do this soon if the old web app was shared as "Anyone" — it shows pay figures to anyone who has that link.

## Going back
Paste the old `Code.gs` back and save. The Sheet is unchanged apart from the added headings and the Access tab.

## What changed in the script
- New `doPost()` API and sign-in check (bottom of the file, under "TOOLKIT API").
- The Dashboard rebuild runs one at a time and no longer empties the tab before rewriting it.
- Deleting an absence only goes through if that row is still the record that was on screen.
- Emailing a Weekly Incentive report from the Toolkit sends the detailed layout with the Excel file (the Monday format).
  Part Summary, Employee Performance and Issues emails no longer carry the summary cards, which only fit Dashboard tables.
- Not changed: incentive, cost and revenue math; the daily and Monday emails; the TLand CSV; all trigger times.
