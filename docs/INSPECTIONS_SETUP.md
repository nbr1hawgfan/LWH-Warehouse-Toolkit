# Monthly Facility Inspections — setup (v1.88.0)

Replaces the Google Form monthly safety inspection. Lives in the Toolkit under **Safety & Training → Inspections**
(and in the menu for warehouse managers).

## What's already done
- **Supabase** (project LWH Companion): tables, functions and the private photo bucket `insp-photos` —
  `sql/facility_inspections.sql`, applied Nov 17, 2026.
- **Edge Function** `insp-photo` (photo upload + signed links) — `supabase/functions/insp-photo/index.ts`, deployed.
- **Sites, zones, checklist** loaded: 9 sites (WHSE10/11/40/41/60/70/85, CORP, SHOP), 5th St. split into
  South End + North End, 53 checklist items (the 39 Google Form items with wording fixes + 14 new).
- **Admins:** Tim (93945) and Ryan (12345). **Rotation:** Tim, Ryan.
- **Mailer key** hash is set in `insp_settings` (the key itself was sent to Tim, not stored in this repo).

## Mailer (emails + Google Sheet log) — one-time
1. Make a new Google Sheet, e.g. **LWH Facility Inspections**. Extensions → Apps Script.
2. Paste `gas/InspectionMailer.gs` into Code.gs.
3. Project Settings → Script Properties:

   | Property | Value |
   |---|---|
   | `SUPABASE_URL` | `https://tjivcqxnkftujceumdtx.supabase.co` |
   | `SUPABASE_ANON_KEY` | the Toolkit's publishable key (`sb_publishable_PYlW…`, in `js/auth.js`) |
   | `INSP_MAILER_KEY` | the mailer key |
   | `APP_URL` | `https://nbr1hawgfan.github.io/LWH-Warehouse-Toolkit/` (optional) |
4. Run **setup()** once and approve the permissions. It makes the *Inspections* and *Findings* tabs and a
   15-minute trigger. Nothing to deploy as a web app.

New key later: make one up, put it in `INSP_MAILER_KEY`, then in the Supabase SQL Editor:
```sql
update public.insp_settings set mailer_key_hash = encode(sha256(convert_to('NEW-KEY','UTF8')),'hex') where id = 1;
```

## Who gets what
- **Report email** (each submitted inspection): admins + extra recipients (Setup → People & email) + whoever submitted.
- **"Your zones this month"** on the 1st — only if zones are assigned for the month.
- **"Still open"** reminder X days before month end (default 5) to each assignee, plus a summary to admins.
- Emails need an address: warehouse managers use the one on the manager list; extra inspectors need one entered in Setup.

## Day to day
- **Any inspector can do any zone.** Inspectors = warehouse manager list + anyone added in Setup → People & email
  (e.g. the Trailer Shop lead). They sign in with their own employee ID + PIN.
- **Admins** assign the month on *This Month → Assignments* (one person for everything, or per zone);
  "Next in rotation" suggests who's after last month's inspector.
- **Doesn't Meet Standard** needs a comment and a photo (photo optional on forklift-operation, compressed-air psi,
  lockout/tagout and incident/plan items) and opens a **corrective action** due in 14 days (setting). If it's still
  open next month and fails again, it counts as "found again" instead of a new action.
- Answers save as you go (and on the phone, so a dead spot loses nothing). Photos need a signal.
- Submitted inspections are locked. An admin can **Reopen**; resubmitting emails it again marked "resubmitted".

## Adding Dallas (or any site)
Setup → Sites & zones → **Add a site**: code (e.g. `WHSE90`), name, kind, equipment. It starts with one zone,
"Whole building"; add zones to split it. The checklist fills in from the kind + equipment; fine-tune under
**Checklist by site**.

## Changing the checklist
Setup → Checklist. Rewording an item doesn't change past inspections — each keeps the wording it was answered with.
Turning an item off removes it from future inspections only.

## Storage
Photos are shrunk on the phone to ~1600px (~250–400 KB). Bucket: `insp-photos` (private, 8 MB limit per file).
