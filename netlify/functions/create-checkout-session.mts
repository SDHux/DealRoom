import type { Context, Config } from "@netlify/functions";

// Starts a Stripe Checkout session for an org's owner to subscribe. Mirrors ai-coach.mts's
// shape (Netlify.env.get, plain fetch, no npm SDKs -- this repo has no package.json/build
// step, same reasoning as everything else here). Talks to Supabase via plain REST calls
// forwarding the caller's own access token, so Postgres RLS (owner-only on organizations,
// membership-only on organization_members) does the real authorization -- this function
// never uses a service-role key, unlike stripe-webhook.mts, which has no user session to
// forward at all.

const SUPABASE_URL = "https://hjumgvnuqvmxdusldeba.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_gRA_qf4uQVX9BKhJHuV6hQ_oMRTypV3";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
  const priceId = Netlify.env.get("STRIPE_PRICE_ID");
  if (!stripeKey || !priceId) {
    return json({ error: "Billing is not configured yet. Add STRIPE_SECRET_KEY and STRIPE_PRICE_ID in Netlify site settings." }, 500);
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

  // organization_members RLS only lets you read your own membership rows -- this also
  // doubles as the "does this user actually belong to this org" check.
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
  let customerId: string | undefined = orgRows[0]?.stripe_customer_id;

  if (!customerId) {
    const custRes = await fetch("https://api.stripe.com/v1/customers", {
      method: "POST",
      headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: user.email, "metadata[org_id]": orgId }),
    });
    if (!custRes.ok) return json({ error: "Couldn't create Stripe customer", detail: await custRes.text() }, 500);
    const customer = await custRes.json();
    customerId = customer.id;

    // SECURITY DEFINER RPC (0018) -- the only path allowed to write stripe_customer_id;
    // a plain client/REST update is blocked at the column-privilege level.
    const setRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_org_stripe_customer_id`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ p_org_id: orgId, p_customer_id: customerId }),
    });
    if (!setRes.ok) return json({ error: "Couldn't save Stripe customer id", detail: await setRes.text() }, 500);
  }

  const origin = req.headers.get("origin") || "https://mybivy.com";
  const sessionRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      mode: "subscription",
      customer: customerId!,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
      client_reference_id: orgId,
    }),
  });
  if (!sessionRes.ok) return json({ error: "Couldn't create checkout session", detail: await sessionRes.text() }, 500);
  const session = await sessionRes.json();

  return json({ url: session.url });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const config: Config = {
  path: "/api/create-checkout-session",
};
