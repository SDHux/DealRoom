import type { Context, Config } from "@netlify/functions";
import template from "../../demo/template.json";

// Starts a demo workspace for mybivy.com/?demo=solo|team -- no login, nothing typed.
//
// 1. Lazily purges expired demos (pg_cron also does this hourly).
// 2. Caps how many demos can start per hour, so the link can't be used to flood the DB.
// 3. Creates throwaway auth users via the Admin API (demo-<uuid>@demo.mybivy.com, email
//    pre-confirmed, so no mail is ever sent; that subdomain has no mailbox). Team demos
//    also get three teammate accounts that are never signed into.
// 4. Clones the template (demo/template.json, generated from demo/content.mjs) into a new
//    org via create_demo_workspace(), which is service-role only.
// 5. Returns the owner's one-off credential; the browser signs in with it immediately.
//
// If anything after step 3 fails, the users just created are deleted again.

const SUPABASE_URL = "https://hjumgvnuqvmxdusldeba.supabase.co";
const DEMOS_PER_HOUR = 60;
const TEAMMATE_COUNT = (template as { teammates: unknown[] }).teammates.length;

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) return json({ error: "The demo isn't configured yet (missing SUPABASE_SERVICE_ROLE_KEY)." }, 500);

  let kind: string | undefined;
  try {
    ({ kind } = await req.json());
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (kind !== "solo" && kind !== "team") return json({ error: "Unknown demo type" }, 400);

  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
  const rpc = (fn: string, body: unknown) =>
    fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(body) });

  // 1. Best-effort cleanup; never blocks a new demo.
  await rpc("purge_expired_demos", {}).catch(() => {});

  // 2. Global rate cap.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const countRes = await fetch(
    `${SUPABASE_URL}/rest/v1/organizations?select=id&is_demo=eq.true&created_at=gte.${encodeURIComponent(since)}`,
    { headers: { ...headers, Prefer: "count=exact", Range: "0-0" } }
  );
  const total = Number((countRes.headers.get("content-range") || "").split("/")[1] || 0);
  if (total >= DEMOS_PER_HOUR) {
    return json({ error: "A lot of demos are running right now. Please try again in a few minutes." }, 429);
  }

  // 3. Throwaway users.
  const created: string[] = [];
  const cleanup = () => Promise.all(created.map(id =>
    fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers }).catch(() => {})));
  const makeUser = async (label: string, meta: Record<string, unknown>) => {
    const email = `demo-${crypto.randomUUID()}${label}@demo.mybivy.com`;
    const password = crypto.randomUUID() + crypto.randomUUID();
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST", headers,
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: meta }),
    });
    if (!res.ok) throw new Error(`Couldn't create a demo account: ${await res.text()}`);
    const user = await res.json();
    created.push(user.id);
    return { id: user.id as string, email, password };
  };

  try {
    const owner = await makeUser("", { demo_kind: kind, full_name: "Alex Morgan" });
    const teammates: string[] = [];
    if (kind === "team") {
      for (let i = 0; i < TEAMMATE_COUNT; i++) {
        teammates.push((await makeUser(`-t${i + 1}`, { demo_kind: kind, demo_teammate: true })).id);
      }
    }

    // 4. Clone.
    const seedRes = await rpc("create_demo_workspace", {
      p_kind: kind, p_owner: owner.id, p_owner_email: owner.email, p_template: template, p_teammates: teammates,
    });
    if (!seedRes.ok) throw new Error(`Couldn't build the demo workspace: ${await seedRes.text()}`);
    const orgId = await seedRes.json();

    // 5. Hand back the one-off credential.
    return json({ kind, orgId, email: owner.email, password: owner.password, expiresInHours: 8 });
  } catch (e) {
    await cleanup();
    console.error("start-demo failed", e);
    return json({ error: "The demo workspace couldn't be created. Please try again.", detail: String((e as Error).message || e) }, 500);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export const config: Config = {
  path: "/api/start-demo",
};
