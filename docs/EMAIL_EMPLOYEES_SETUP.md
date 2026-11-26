# Email Employees — setup (Toolkit v1.103.0 + PTO Api.gs v1.4.0)

Managers open **Manager → Email Employees**, check the people they want, type a subject and message, and send.
Each person gets their own branded email ("Hi [first name]," optional). Replies go to the manager who sent it.

## Where the names and emails come from
The PTO tracker's **Employees** tab (the same list as the PTO app). Only people with an email there are listed.
The Toolkit sends employee IDs only — the PTO script looks up the addresses itself.

## One-time step (about 2 minutes)
1. Open the PTO tracker Google Sheet → **Extensions → Apps Script**.
2. Open **Api.gs**, select everything, and paste the contents of `gas/PTO_Api_v1.4.0.gs` over it. Save.
3. **Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy.** (Same /exec link — nothing else changes.)
4. Optional check: pick `apiSelfTest` in the function list → Run. The log shows how many people have an email,
   how many are hidden, and how many emails Google lets the account send today.
5. The first time someone sends, Google may ask the script owner to allow "Send email as you" — approve it once.

Until step 3 is done, the screen says "One-time setup needed" — nothing breaks.

## Who can send
- Anyone on the PTO sheet's **Managers** tab, **or**
- Anyone on the Toolkit's warehouse manager list (Manager Messages list).

The screen itself only shows in the Toolkit's **Manager** section (warehouse managers).

## People who don't work here anymore
Tap **Not here** on their row. They move to the **Not here** tab for every manager and aren't picked by
"Select all shown". The Employees tab is not touched. Tap **Back on list** to undo.
(Stored in the PTO script's Script Properties as `BCAST_HIDDEN`.) People marked Inactive on the PTO sheet are
in the Not here tab automatically.

## Saved groups
Select people → **Save as group** (e.g. "5th St. crew"). Groups are saved on that manager's device.

## Log
Every send is written to a new **Email_Broadcast_Log** tab on the PTO sheet (made automatically):
when, who sent it, subject, how many, names, anything that failed, and the message. The last 15 show under
**Recent sends** in the Toolkit.

## Limits
- Up to **250 people per send**. Big sends take a minute or two — keep the screen open.
- Google's daily email quota for the script owner's account applies (shown on the screen). A send that would go
  over it is stopped before anything goes out.
- A double tap / retry of the same send is caught and not sent twice.
