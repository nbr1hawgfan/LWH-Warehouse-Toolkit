// transaction-history-csv — CSV export of transaction_history_export for the Warehouse Toolkit.
// Requires a signed-in Toolkit session (header x-lwh-session) once the lock is on
// (lwh_settings.enforce — see sql/toolkit_lock.sql in the Warehouse Toolkit repo).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const COLUMNS = ["LWH_ID", "Customer_ID", "MadeFrom", "TransactionType", "Unique2", "INV_Receipt", "BillToRef", "SubCustNm", "ItemNm", "ItemDesc", "LotNum", "Qty", "TransactionDate", "Location", "SyncedAt"];

const PAGE_SIZE = 1000;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lwh-session",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Row-Count",
};

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Sign-in check (passes everyone while the lock switch is off).
    const token = req.headers.get("x-lwh-session") || "";
    const chk = await supabase.rpc("lwh_session_check", { p_token: token });
    if (chk.error) throw chk.error;
    if (!(chk.data as { ok?: boolean })?.ok) {
      return new Response(JSON.stringify({ ok: false, error: "sign_in_required" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Supabase's default "Max Rows" API setting caps a single .select() at 1000 rows.
    // Page through with .range() until an empty page comes back.
    const rows: Record<string, unknown>[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("transaction_history_export")
        .select(COLUMNS.join(","))
        .order("TransactionDate", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      rows.push(...(data as unknown as Record<string, unknown>[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    const lines = [COLUMNS.join(",")];
    for (const row of rows) {
      lines.push(COLUMNS.map((c) => csvEscape(row[c])).join(","));
    }
    const csv = lines.join("\r\n") + "\r\n";

    return new Response(csv, {
      headers: {
        ...CORS,
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Row-Count": String(rows.length),
      },
    });
  } catch (err) {
    return new Response(`Export failed: ${String(err)}`, {
      status: 500,
      headers: CORS,
    });
  }
});
