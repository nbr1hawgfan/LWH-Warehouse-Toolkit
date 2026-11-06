# Messages — setup and day-to-day

## Who can send
The 12 people on the warehouse manager list (from `Manager_List.xlsx`, Nov 6, 2026), stored in the
Supabase table `msg_wh_managers` (by employee ID). To add or remove a manager, in the SQL Editor:

```sql
-- add (use their timeclock employee ID)
insert into msg_wh_managers (emp_id, manager_code, email, name)
values (12345, 'SMITH01', 'jsmith@logistics-warehouse.com', 'John Smith')
on conflict (emp_id) do update set is_active = true;

-- remove
update msg_wh_managers set is_active = false where emp_id = 12345;
```

## Getting everyone signed in
1. A manager who already has a PIN opens the **Warehouse Message Center** (`/messages/`, or
   Messages → *Open Warehouse Message Center*) and signs in with employee ID + PIN.
2. **Employee Sign-in** tab lists a setup code for everyone without a PIN (managers included).
   Print it or hand codes out. New hires get a code automatically once they're in the timeclock sync.
3. Each person: Warehouse Toolkit → **Messages → First time sign-in** → employee ID, setup code,
   then a 6-digit PIN they choose. A code works once.
4. Forgot PIN → **Reset PIN** on that tab gives a new code. It's the same PIN for every company app
   that uses employee sign-in, so a reset applies there too.

## Notes
- **By location** uses where each person last clocked in. People who haven't clocked in yet only
  get **Everyone** or **Pick people** messages.
- **Everyone** and **By location** skip managers.
- All warehouse managers share one Employee Inbox; "Seen by" / "Done by" shows who picked it up.
- Files (PDF or photo, 10 MB) are removed after 14 days; messages and read receipts stay.
- Employees' messages are checked every 30 seconds while the Toolkit is open.
