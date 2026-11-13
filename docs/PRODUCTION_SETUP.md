# Production — setup (Warehouse Toolkit v1.85.0)

Production replaces the **Scrapping Production Analytics** Apps Script web app. The data stays in the
**same Google Sheet** (`1licP1Il9hz21YziiOPVBsdSA3mscJc6lcvPdWXpV4cQ`). The managers keep the Sheet they know,
the screens move into the Toolkit, and the 9 AM email keeps going out.

```
Toolkit (GitHub Pages)  ──POST + signed-in session──►  Production Apps Script (gas/ProductionAPI.gs)  ──►  Google Sheet
                                                              │  asks Supabase whm_me "who is this?"
                                                              │  optional: prod_timeclock_hours (timeclock compare)
                                                              └─ 9 AM trigger → daily email
```

## 1. Back up
In the Sheet: **File → Make a copy** (just in case). In the Apps Script project, copy the old `Code.gs`
into a new file named `Code_OLD.gs.txt` or paste it somewhere safe. Nothing below deletes data.

## 2. Replace the code
1. Open the existing Apps Script project (the one with `Code.gs` and `Index.html`).
2. Replace **all** of `Code.gs` with `gas/ProductionAPI.gs` from this zip.
3. Delete `Index.html` (no longer used — the old URL now shows a "Production has moved" page with a button into the Toolkit).
4. Save.

## 3. Run the one-time setup
In the editor, pick **`setupProductionV2`** → **Run** → approve permissions (it now also asks for "connect to an external service" —
that's the Supabase sign-in check).

It adds, without touching existing data:

| Tab | What it's for |
|---|---|
| **Production** | 7 new columns at the right: Entry ID, Job ID, Emp ID, Regular Hours, Entered By, Entered At, Notes. Every old row gets an ID so it can be edited/deleted in the app. |
| **Employees** | New columns: Active, Emp ID, Updated By, Updated At. Everyone is marked Active. |
| **Projects** | The 9 project types (name, active, order, target units/hr). |
| **Rate History** | The current prices with a start date. Price changes made in the app are added here. |
| **Settings** | Customer OT rate ($40), OT after 40 hrs, 1.5×, OT watch at 36 hrs, report recipients (the same 6 addresses as before). |
| **Crews** | Saved crews. |
| **Access** | Who gets which role (see below). |
| **Audit Log** | Every add / edit / delete / price change, who did it and when. |

Optional: run **`recheckAllOvertime`** once. It refigures employee OT on every old row the new (correct) way —
by the whole Sun–Sat week. Skip it if you'd rather leave history exactly as it was.

## 4. Make yourself admin
**Access** tab → row 2: your employee ID in A, your name in B, `admin` in C.
(Or Project Settings → Script Properties → `ADMIN_EMP_IDS` = your ID — a break-glass admin that can't be removed from the app.)

Roles:

| Role | Who | Can |
|---|---|---|
| **manager** | Everyone on the warehouse manager list (Manager Messages), automatically | Record / edit / delete jobs, all dashboards with $, timeclock compare, email reports, crews |
| **entry** | Leads you add on the Access tab | Record / edit jobs and see units & hours. **No dollars or pay rates anywhere** — the script strips them out |
| **admin** | You (Access tab) | Everything, plus pricing, employees & pay rates, OT rules, report recipients, Access list, recheck OT, change log |
| **none** | Anyone you want blocked | Nothing (even if they're a manager) |

## 5. Deploy and connect
1. **Deploy → Manage deployments → ✏️ edit the existing deployment → Version: New version → Deploy.**
   Make sure it says **Execute as: Me** and **Who has access: Anyone** (the Toolkit runs on GitHub Pages, so
   "Anyone within Logistics Warehouse" won't work — the script itself checks the sign-in on every request).
2. Copy the **/exec** URL.
3. In `js/production.js`, line ~16: `const PROD_API_DEFAULT='https://script.google.com/macros/s/…/exec';` — paste it there before you upload,
   so every device is connected. (Or, after uploading, Production → Settings → Connection on one device.)
4. Run **`createDailyEmailTrigger`** once (it replaces the old 9 AM trigger with the new code's).
5. Optional check: open `<exec URL>?health=1` → `{"ok":true,"service":"LWH Production API"…}`.

## 6. Optional — timeclock comparison
Lets the **Timeclock** tab and the daily email show "clocked in but no production entered" and hour gaps.
1. Make up a long random key (30+ letters/numbers).
2. Supabase SQL Editor: run `sql/production_timeclock.sql`. Then run the commented `insert into public.prod_api_key …`
   statement **in the SQL Editor only**, with `CHANGE-ME` replaced by your key. (Don't save the key in GitHub — the repo is public.)
3. Apps Script → Project Settings → Script Properties → `PROD_TIMECLOCK_KEY` = the same key.
4. Toolkit → Production → Settings → Employees → Edit each person → pick them from the timeclock list (fills their employee ID).

Skip this and everything else still works; the Timeclock tab just says it isn't set up.

## 7. Check it
- Toolkit → Production (menu for managers, or Home → search "production").
- **Record**: pick 2–3 people, "Hours for everyone" → Apply, units → Save. Look at the Sheet: one row per person, same Job ID, units split by hours.
- **Entries → Edit** the job, change someone's hours → Save. Rows replaced, Audit Log shows the before/after.
- **Settings → Pricing & projects → Edit** a project → new rate starting today → Save. Rate History gets a row. Old jobs keep their price.
- **Settings → OT & daily report → Send yesterday's report now.**

## How the numbers work
- **Crew jobs**: units and customer OT hours are split by each person's share of the crew's hours (6 h of 24 h = 25% of the units).
  Revenue is figured for the whole job, then split the same way, so job totals are exact to the penny.
- **Employee OT**: refigured for the whole Sun–Sat week every time a job is added, edited or deleted. Hours count in date order,
  then in the order they were entered; the first 40 are regular. A late, back-dated or corrected entry can't leave OT wrong anymore.
- **Prices**: each job keeps the price that was in effect on its date. A back-dated price change only touches saved jobs if you
  tick "Re-price jobs already saved on or after the start date".
- **% of target**: units/hr ÷ the project's target units/hr. For a person who worked several projects, it's weighted by the hours on each.
- **Customer OT rate** changes apply to jobs saved from then on. **OT threshold / multiplier** changes recheck the current week; past weeks stay as they were figured.

## Bugs fixed from the old version
- OT was locked in at save time in entry order — back-dated, edited or deleted rows left it wrong.
- Emailing a report from the app read dates as UTC (in Central time that's 6 PM the day before), so the report day and 7-day window could be off by one.
- The email had "$40.00" typed in instead of reading the OT rate.
- `setupSheets()` cleared the Production tab — gone; `setupProductionV2()` never deletes anything.
- Unknown project names were silently saved as "Scrapping".
- 7-day tiles mixed two different date windows.
- The form's default date used UTC, so after 6 PM it defaulted to tomorrow.
