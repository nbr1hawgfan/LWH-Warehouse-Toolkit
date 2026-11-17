// insp-photo — photos for Monthly Facility Inspections (private bucket "insp-photos").
//
//   POST ?action=upload&zone=<id>&period=YYYY-MM-01&item=<id>      finding photo on an inspection item
//   POST ?action=upload&action_id=<id>                              "fixed" photo on a corrective action
//        raw JPEG body; header x-lwh-session (Toolkit sign-in)      → { ok, id, inspection_id }
//   POST ?action=urls   JSON { ids: [uuid…] }; header x-lwh-session  → { ok, urls: { id: signedUrl } }  (1 hour)
//
// Who may upload / view is decided in Postgres (insp_photo_register / insp_photo_paths) from the same
// employee ID + PIN session the Toolkit uses. The Toolkit shrinks photos to ~1600px JPEG before upload.
// Deployed with JWT verification off, like the other Toolkit functions.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lwh-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const MAX = 8 * 1024 * 1024;
const BUCKET = "insp-photos";
const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const intOrNull = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  const token = req.headers.get("x-lwh-session") || "";
  if (!token) return json({ ok: false, error: "signed_out" }, 401);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (action === "upload") {
    const buf = new Uint8Array(await req.arrayBuffer());
    if (!buf.length) return json({ ok: false, error: "Empty photo" }, 400);
    if (buf.length > MAX) return json({ ok: false, error: "Photo must be under 8 MB." }, 413);
    if (!isJpeg(buf)) return json({ ok: false, error: "Photos must be JPEG." }, 415);
    const period = url.searchParams.get("period");
    const reg = await db.rpc("insp_photo_register", {
      p_token: token,
      p_zone_id: intOrNull(url.searchParams.get("zone")),
      p_period: period && /^\d{4}-\d{2}-\d{2}$/.test(period) ? period : null,
      p_item_id: intOrNull(url.searchParams.get("item")),
      p_action_id: intOrNull(url.searchParams.get("action_id")),
      p_bytes: buf.length,
    });
    if (reg.error) return json({ ok: false, error: reg.error.message }, 500);
    const r = reg.data as { ok: boolean; error?: string; id?: string; path?: string; inspection_id?: string };
    if (!r.ok) return json(r, r.error === "signed_out" ? 401 : 400);

    const up = await db.storage.from(BUCKET).upload(r.path!, buf, { contentType: "image/jpeg", upsert: false });
    if (up.error) return json({ ok: false, error: up.error.message }, 500);
    await db.rpc("insp_photo_uploaded", { p_id: r.id });
    return json({ ok: true, id: r.id, inspection_id: r.inspection_id ?? null });
  }

  if (action === "urls") {
    let b: Record<string, unknown>;
    try { b = await req.json(); } catch { return json({ ok: false, error: "Bad JSON" }, 400); }
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(String)
      .filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 200);
    if (!ids.length) return json({ ok: true, urls: {} });
    const acc = await db.rpc("insp_photo_paths", { p_token: token, p_ids: ids });
    if (acc.error) return json({ ok: false, error: acc.error.message }, 500);
    const a = acc.data as { ok: boolean; error?: string; photos?: { id: string; path: string }[] };
    if (!a.ok) return json(a, a.error === "signed_out" ? 401 : 403);
    const photos = a.photos ?? [];
    const urls: Record<string, string> = {};
    if (photos.length) {
      const s = await db.storage.from(BUCKET).createSignedUrls(photos.map((p) => p.path), 3600);
      if (s.error) return json({ ok: false, error: s.error.message }, 500);
      (s.data ?? []).forEach((d, i) => { if (d.signedUrl) urls[photos[i].id] = d.signedUrl; });
    }
    return json({ ok: true, urls });
  }

  return json({ ok: false, error: "Unknown action" }, 400);
});
