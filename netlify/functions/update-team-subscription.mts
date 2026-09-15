import type { Context, Config } from "@netlify/functions";

// Lets an existing Team subscriber change seat tiers in-app, without depending on Stripe's
// hosted Customer Portal having price-switching enabled for the right set of Prices (that
// config lives outside this repo and isn't something a deploy here can guarantee stays
// correct). Same auth pattern as create-team-checkout-session.mts: forwards the caller's own
// Supabase access token so RLS does the real authorization, no service-role key.
//
// plan_tier itself is NOT written here -- same discipline as every other subscription field
// in this app (see stripe-webhook.mts's own comment on this). This function only asks Stripe
// to change the subscription's price; Stripe confirms the change via a
// customer.subscription.updated webhook, and that handler is what actually updates plan_tier
// once Stripe has really committed to it.

const SUPABASE_URL = "https://hjumgvnuqvmxdusldeba.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_gRA_qf4uQVX9BKhJHuV6hQ_oMRTypV3";

const TIER_ENV: Record<string, string> = {
  team_5: "STRIPE_PRICE_TEAM_5",
  team_10: "STRIPE_PRICE_TEAM_10",
  team_15: "STRIPE_PRICE_TEAM_15",
};
const TIER_SEATS: Record<string, number> = { team_5: 5, team_10: 10, team_15: 15 };

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

  const memberRes = await fetch(
    `${SUPABASE_URL}/rest/v1/organization_members?select=is_admin&org_id=eq.${orgId}&user_id=eq.${user.id}`,
    { headers: authHeaders }
  );
  const members = memberRes.ok ? await memberRes.json() : [];
  if (!members.length || !members[0].is_admin) {
    return json({ error: "Only this organization's Admin can manage billing" }, 403);
  }

  // Seat-cap safety on downgrade: the enforce_seat_cap trigger only stops a NEW member from
  // joining past the cap, it has no opinion on an existing roster suddenly exceeding a
  // smaller tier's limit -- that has to be checked here, before Stripe is ever asked to
  // change anything.
  const activeRes = await fetch(
    `${SUPABASE_URL}/rest/v1/organization_members?select=id&org_id=eq.${orgId}&status=neq.deactivated`,
    { headers: authHeaders }
  );
  const activeMembers = activeRes.ok ? await activeRes.json() : [];
  const activeCount = activeMembers.length;
  if (activeCount > TIER_SEATS[tier]) {
    return json({
      error: `This organization has ${activeCount} active members -- deactivate down to ${TIER_SEATS[tier]} or fewer before switching to this tier.`,
    }, 400);
  }

  const orgRes = await fetch(
    `${SUPABASE_URL}/rest/v1/organizations?select=stripe_subscription_id,plan_tier&id=eq.${orgId}`,
    { headers: authHeaders }
  );
  const orgRows = orgRes.ok ? await orgRes.json() : [];
  const subscriptionId: string | undefined = orgRows[0]?.stripe_subscription_id;
  if (!subscriptionId) {
    return json({ error: "No active subscription to change -- use checkout to subscribe first" }, 400);
  }
  if (orgRows[0]?.plan_tier === tier) {
    return json({ error: "Already on this tier" }, 400);
  }

  const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  if (!subRes.ok) {
    return json({ error: "Couldn't look up the current subscription", detail: await subRes.text() }, 500);
  }
  const sub = await subRes.json();
  const itemId: string | undefined = sub.items?.data?.[0]?.id;
  if (!itemId) {
    return json({ error: "Couldn't find a subscription item to update" }, 500);
  }

  // create_prorations, not none -- a mid-cycle tier change should bill/credit the difference
  // immediately, same behavior Stripe's own Customer Portal would apply.
  const updateRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      "items[0][id]": itemId,
      "items[0][price]": priceId,
      proration_behavior: "create_prorations",
      "metadata[plan_tier]": tier,
      "metadata[org_id]": orgId,
    }),
  });
  if (!updateRes.ok) {
    return json({ error: "Couldn't change the subscription tier", detail: await updateRes.text() }, 500);
  }

  return json({ success: true, tier });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const config: Config = {
  path: "/api/update-team-subscription",
};
