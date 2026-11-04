# Forklift Certification — Setup (v1.76.0)

Three new screens in the Toolkit, under **Safety & Training** on Home:

| Screen | Who | What |
|---|---|---|
| **Forklift Test** | Employees | Enter 5-digit ID → pick manager + equipment → written test → result |
| **Forklift Certs** | Managers (Missed Punches passcode) | Driving evaluations, certificates, wallet cards, test history, settings |
| **Verify Forklift Cert** | Anyone | Where the QR code on certificates and wallet cards goes |

Records live in Supabase. Emails are sent by a small Google Apps Script.

---

## 1. Supabase (5 min)

1. Supabase → SQL Editor → paste **`sql/forklift_certs.sql`** → Run.
   (Needs `sql/missed_punches.sql` already run — it uses the same manager passcode.)
2. That loads your 17 questions from `forklift_test.xlsx`. Two typos were fixed:
   Q15 "When is is" → "When is it", Q16 "safe breaking distance" → "safe braking distance".

Safe to re-run any time. Re-running never overwrites question edits made in the app.

## 2. Apps Script mailer (10 min)

1. Go to script.google.com → **New project** → name it `LWH Forklift Cert Mailer`.
   Use the company Google account you want emails to come **from**.
2. Paste **`gas/ForkliftCertMailer.gs`** into `Code.gs`.
   (Optional: Project Settings → "Show appsscript.json" and paste **`gas/appsscript.json`**.)
3. Project Settings → **Script Properties** → add:
   - `SUPABASE_URL` = `https://tjivcqxnkftujceumdtx.supabase.co`
   - `SUPABASE_ANON_KEY` = the same anon key the Toolkit uses (in `js/forkliftcert.js`)
   - `FC_MAILER_KEY` = make up a long random string (30+ characters)
4. Back in Supabase SQL Editor, run this **with your same key** (don't save the key in the repo):
   ```sql
   update public.fc_settings set mailer_key_hash =
     encode(sha256(convert_to('YOUR-LONG-RANDOM-KEY', 'UTF8')), 'hex') where id = 1;
   ```
5. In the script editor, pick **`setupDailyTrigger`** → Run → approve permissions.
   (This is the daily 60-day / 30-day expiration reminder.)
6. **Deploy → New deployment → Web app** → Execute as **Me**, Who has access **Anyone** → Deploy.
   Copy the URL ending in `/exec`.

## 3. Toolkit settings (2 min)

Toolkit → **Forklift Certs** → passcode → **Settings**:

- **Mailer URL** — paste the `/exec` URL.
- **HR email(s)** — comma-separated. HR gets every result and certificate.
- **Managers** — add each manager with email and location. Employees pick from this list;
  that manager gets the emails. If only one manager matches the employee's location, it's picked for them.
- Defaults: 12 questions per test, 90% to pass (11 of 12), certificate good for 3 years,
  3 failed tries per 24 hours.

## How a certification happens

1. **Classroom training** — in the app (Forklift Test → Start Classroom Training): 6 video modules, about 32 minutes,
   recorded in Supabase and good for 90 days. Content and videos: `js/forkliftcert-training.js`.
   Turn the requirement off or change the minimum minutes in Forklift Certs → **Training**.
2. **Written test** — employee takes it in Forklift Test. 12 random questions from the bank,
   answer order shuffled, "None of the above" always last. Scored in the database, so the
   answers can't be seen on the phone. Result emailed to employee (if they gave an email), manager, HR.
3. **Driving evaluation** — manager opens Forklift Certs → **Driving Evaluations**, watches them operate,
   marks the 11-item checklist, checks only the equipment they actually drove, signs with their name.
   Anything marked "Needs work" = not passed.
4. **Certificate issued** — number like `LWH-FL-2026-0001`, expires in 3 years. PDF emailed to
   employee, manager and HR. Print the certificate (11×8.5 landscape) and the **wallet card**
   (CR80, front + back) from the same screen. Any older cert for that person is marked "Replaced".

## Reprints

Forklift Certs → **Certificates** → search → **Open** → Print Certificate / Print Wallet Card /
Download PDF / Email Again. Works for any cert, any time. Employees can also download their own
certificate PDF from Forklift Test by entering their ID.

**Wallet card printing:** same as Employee Badges — pick the HID card printer in the print dialog;
the page is set to exact CR80 size and uses the Print Calibration offsets from Settings. Page 1 is the
front, page 2 is the back (use the printer's duplex/flip setting, or run the card through twice).
The photo is optional and isn't saved.

## When to retest (OSHA 1910.178(l)(4))

At least every 3 years, and sooner after an accident or near miss, unsafe operation, a bad
evaluation, a new type of truck, or a workplace change that affects safe operation. A manager can
**Revoke** a cert (reason required) — the QR then shows REVOKED.

## Exports

Certificates and Test History each have **Export to Excel**.

## Email limits

Apps Script on a regular Gmail account can send to 100 recipients per day; on Google Workspace, 1,500.
Each result or certificate email counts each recipient (usually 3).
