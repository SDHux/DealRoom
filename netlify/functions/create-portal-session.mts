import type { Context, Config } from "@netlify/functions";

// Opens the Stripe Billing Portal (payment method, invoices, cancel) for an already-
// subscribed org's owner. Same auth pattern as create-checkout-session.mts: forwards the
// caller's own Supabase access token so RLS does the real authorization, no service-role
// key here.

const SUPABASE_URL = "https://hjumgvnuqvmxdusldeba.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_gRA_qf4uQVX9BKhJHuV6hQ_oMRTypV3";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return json({ error: "Billing is not configured yet. Add STRIPE_SECRET_KEY in Netlify site settings." }, 500);
  }

  let body: { orgId?: string; accessToken?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { orgId, accessToken } = body;
  if (!orgId || !accessToken) {
    return json({ error: "Missing orgId or accessToken" }, 400);
  }

  const authHeaders = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
  };

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: authHeaders });
  if (!userRes.ok) return json({ error: "Not authenticated" }, 401);
  const user = await userRes.json();

  const roleRes = await fetch(
    `${SUPABASE_URL}/rest/v1/organization_members?select=role&org_id=eq.${orgId}&user_id=eq.${user.id}`,
    { headers: authHeaders }
  );
  const roles = roleRes.ok ? await roleRes.json() : [];
  if (!roles.length || roles[0].role !== "owner") {
    return json({ error: "Only the organization owner can manage billing" }, 403);
  }

  const orgRes = await fetch(
    `${SUPABASE_URL}/rest/v1/organizations?select=stripe_customer_id&id=eq.${orgId}`,
    { headers: authHeaders }
  );
  const orgRows = orgRes.ok ? await orgRes.json() : [];
  const customerId = orgRows[0]?.stripe_customer_id;
  if (!customerId) {
    return json({ error: "No billing account yet -- subscribe first." }, 400);
  }

  const origin = req.headers.get("origin") || "https://mybivy.com";
  const portalRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ customer: customerId, return_url: origin }),
  });
  if (!portalRes.ok) return json({ error: "Couldn't open billing portal", detail: await portalRes.text() }, 500);
  const portal = await portalRes.json();

  return json({ url: portal.url });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const config: Config = {
  path: "/api/create-portal-session",
};
