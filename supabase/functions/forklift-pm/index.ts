// forklift-pm — Forklift PM Admin for warehouse managers, inside the Warehouse Toolkit.
//
// The forklift inspection Apps Script protects its PM actions with an admin passcode. Instead of every
// manager knowing that passcode, the Toolkit sends the manager's sign-in (header x-lwh-session — the
// PTO / time off PIN sign-in). This function checks they're on the warehouse manager list
// (whm_me → is_manager), then calls the Apps Script with the passcode, which lives only here as the
// Supabase secret FORKLIFT_PM_PASSCODE. The old PM Admin page (passcode) keeps working unchanged.
//
//   POST ?action=status                      → { ok, data: [ {liftNumber, type, pmInterval, lastPmMeter, lastPmDate,
//                                                             currentReading, hoursUntilPm, status} ] }
//   POST ?action=record  JSON {liftNumber, meterReading, performedBy, notes} → { ok }
//
// Deployed with JWT verification off, like the other Toolkit functions.
import { createClient } from "jsr:@supabase/supabase-js@2";

const GAS = "https://script.google.com/macros/s/AKfycbx04ENDs7GEiiudO_kQMMYr8r1oIGBNy4IBZ2KmKNokjiZ9bwt3c20hivF2fh8oDKxd/exec";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lwh-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function gasJson(res: Response) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return { success: false, message: "The forklift server sent an unexpected reply." }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const action = new URL(req.url).searchParams.get("action") || "";
  const token = req.headers.get("x-lwh-session") || "";
  if (!token) return json({ ok: false, error: "signed_out" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const me = await db.rpc("whm_me", { p_token: token });
  const m = (me.data || {}) as { ok?: boolean; is_manager?: boolean; name?: string };
  if (me.error || !m.ok) return json({ ok: false, error: "signed_out" }, 401);
  if (!m.is_manager) return json({ ok: false, error: "Forklift PM Admin is for warehouse managers." }, 403);

  const passcode = Deno.env.get("FORKLIFT_PM_PASSCODE") || "";
  if (!passcode) return json({ ok: false, error: "setup_needed" }, 503);

  try {
    if (action === "status") {
      const r = await gasJson(await fetch(`${GAS}?action=pmStatus&passcode=${encodeURIComponent(passcode)}`, { redirect: "follow" }));
      if (!r.success) return json({ ok: false, error: r.message || "Could not load PM status." }, 502);
      return json({ ok: true, data: r.data, manager: m.name });
    }
    if (action === "record") {
      let b: Record<string, unknown>;
      try { b = await req.json(); } catch { return json({ ok: false, error: "Bad JSON" }, 400); }
      const liftNumber = String(b.liftNumber || "").slice(0, 40);
      const meterReading = String(b.meterReading || "").replace(/[^\d]/g, "").slice(0, 7);
      const performedBy = String(b.performedBy || "").trim().slice(0, 80);
      let notes = String(b.notes || "").trim().slice(0, 400);
      if (!liftNumber || !meterReading || !performedBy) return json({ ok: false, error: "Forklift, meter reading and performed-by are required." }, 400);
      notes = (notes ? notes + " " : "") + `(logged in Toolkit by ${m.name})`;
      const r = await gasJson(await fetch(GAS, {
        method: "POST", redirect: "follow",
        body: JSON.stringify({ action: "recordPM", payload: { liftNumber, meterReading, performedBy, notes, passcode } }),
      }));
      if (!r.success) return json({ ok: false, error: r.message || "Could not record the PM." }, 502);
      return json({ ok: true });
    }
  } catch (_e) {
    return json({ ok: false, error: "Could not reach the forklift server. Try again." }, 502);
  }
  return json({ ok: false, error: "Unknown action" }, 400);
});
