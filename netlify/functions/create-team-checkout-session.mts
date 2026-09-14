import type { Context, Config } from "@netlify/functions";
// Redeploy trigger: STRIPE_PRICE_TEAM_5/10/15 were found missing from Netlify env at some
// point after they were first set today and had to be re-added; functions don't pick up an
// env var change until the next deploy, so this touch forces one.

// Team's own checkout, separate from Solo's create-checkout-session.mts: three flat-rate
// seat-band tiers instead of one price times quantity (spec: "Tiered/banded, hard seat
// caps, no metering within a tier"), and no trial at all -- Team signups go straight to
// paid billing, unlike Solo's 14-day trial / Early Activation Promo logic, which doesn't
// apply here. Same auth pattern as create-checkout-session.mts: forwards the caller's own
// Supabase access token so RLS does the real authorization, no service-role key.
//
// plan_tier itself is set by stripe-webhook.mts's checkout.session.completed handler, once
// Stripe actually confirms the subscription -- not optimistically here, same reasoning as
// every other subscription field this app tracks.

const SUPABASE_URL = "https://hjumgvnuqvmxdusldeba.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_gRA_qf4uQVX9BKhJHuV6hQ_oMRTypV3";

const TIER_ENV: Record<string, string> = {
  team_5: "STRIPE_PRICE_TEAM_5",
  team_10: "STRIPE_PRICE_TEAM_10",
  team_15: "STRIPE_PRICE_TEAM_15",
};

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return json({ error: "Billing is not configured yet. Add STRIPE_SECRET_KEY in Netlify site settings." }, 500);
  }

  let body: { orgId?: string; accessToken?: string; tier?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { orgId, accessToken, tier } = body;
  if (!orgId || !accessToken || !tier) {
    return json({ error: "Missing orgId, accessToken, or tier" }, 400);
  }
  const priceEnvKey = TIER_ENV[tier];
  if (!priceEnvKey) {
    return json({ error: "Unknown tier" }, 400);
  }
  const priceId = Netlify.env.get(priceEnvKey);
  if (!priceId) {
    return json({ error: `Billing is not configured yet. Add ${priceEnvKey} in Netlify site settings.` }, 500);
  }

  const authHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` };

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: authHeaders });
  if (!userRes.ok) return json({ error: "Not authenticated" }, 401);
  const user = await userRes.json();

  // is_admin, not role='owner' -- Team's own authority model (a converted owner is both
  // today, but this is the check that's actually correct going forward).
  const memberRes = await fetch(
    `${SUPABASE_URL}/rest/v1/organization_members?select=is_admin&org_id=eq.${orgId}&user_id=eq.${user.id}`,
    { headers: authHeaders }
  );
  const members = memberRes.ok ? await memberRes.json() : [];
  if (!members.length || !members[0].is_admin) {
    return json({ error: "Only this organization's Admin can manage billing" }, 403);
  }

  const orgRes = await fetch(`${SUPABASE_URL}/rest/v1/organizations?select=stripe_customer_id&id=eq.${orgId}`, { headers: authHeaders });
  const orgRows = orgRes.ok ? await orgRes.json() : [];
  let customerId: string | undefined = orgRows[0]?.stripe_customer_id;

  async function createStripeCustomer(): Promise<string | Response> {
    const custRes = await fetch("https://api.stripe.com/v1/customers", {
      method: "POST",
      headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: user.email, "metadata[org_id]": orgId }),
    });
    if (!custRes.ok) return json({ error: "Couldn't create Stripe customer", detail: await custRes.text() }, 500);
    const customer = await custRes.json();
    const setRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_org_stripe_customer_id`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ p_org_id: orgId, p_customer_id: customer.id }),
    });
    if (!setRes.ok) return json({ error: "Couldn't save Stripe customer id", detail: await setRes.text() }, 500);
    return customer.id as string;
  }

  if (!customerId) {
    const result = await createStripeCustomer();
    if (result instanceof Response) return result;
    customerId = result;
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
      "metadata[org_id]": orgId,
      "metadata[plan_tier]": tier,
      "subscription_data[metadata][org_id]": orgId,
      "subscription_data[metadata][plan_tier]": tier,
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
      client_reference_id: orgId,
    }),
  });
  if (!sessionRes.ok) {
    return json({ error: "Couldn't create checkout session", detail: await sessionRes.text() }, 500);
  }
  const session = await sessionRes.json();
  return json({ url: session.url });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const config: Config = {
  path: "/api/create-team-checkout-session",
};
