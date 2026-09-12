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
    `${SUPABASE_URL}/rest/v1/organizations?select=stripe_customer_id,trial_ends_at&id=eq.${orgId}`,
    { headers: authHeaders }
  );
  const orgRows = orgRes.ok ? await orgRes.json() : [];
  let customerId: string | undefined = orgRows[0]?.stripe_customer_id;

  // Early Activation Promo: everyone already gets a free 14-day trial with no card at
  // signup (organizations.trial_ends_at, set once at signup -- see
  // create_organization_with_owner, 0032). If they subscribe before that window closes,
  // this is an *early* activation, so as an incentive they get 2 months (60 days, measured
  // from checkout per Mark) free on top, in exchange for putting in a card now. If they
  // subscribe after their free 14 days are already gone -- including orgs created by a
  // returning email, whose trial_ends_at is set to signup time itself (0032), closing the
  // signup-cancel-resignup loop -- there is no Stripe trial at all; they're charged
  // immediately, since they already had (or forfeited the chance at) their free days.
  const trialEndsAt = orgRows[0]?.trial_ends_at ? new Date(orgRows[0].trial_ends_at) : null;
  const isEarlyActivation = !!trialEndsAt && trialEndsAt.getTime() > Date.now();
  const EARLY_ACTIVATION_TRIAL_DAYS = 60;

  async function createStripeCustomer(): Promise<string | Response> {
    const custRes = await fetch("https://api.stripe.com/v1/customers", {
      method: "POST",
      headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: user.email, "metadata[org_id]": orgId }),
    });
    if (!custRes.ok) return json({ error: "Couldn't create Stripe customer", detail: await custRes.text() }, 500);
    const customer = await custRes.json();

    // SECURITY DEFINER RPC (0018) -- the only path allowed to write stripe_customer_id;
    // a plain client/REST update is blocked at the column-privilege level.
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

  async function createCheckoutSession(forCustomerId: string) {
    return fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        mode: "subscription",
        customer: forCustomerId,
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": "1",
        ...(isEarlyActivation ? { "subscription_data[trial_period_days]": String(EARLY_ACTIVATION_TRIAL_DAYS) } : {}),
        success_url: `${origin}/?checkout=success`,
        cancel_url: `${origin}/?checkout=cancel`,
        client_reference_id: orgId,
      }),
    });
  }

  let sessionRes = await createCheckoutSession(customerId!);

  // Orgs whose stripe_customer_id was saved back when Stripe was still in test/sandbox
  // mode hold a customer id that simply doesn't exist in live mode (test and live data are
  // fully separate in Stripe even though ids look identical). Stripe reports that as a 400
  // resource_missing error on the `customer` param. Rather than leaving those pre-existing
  // trial accounts permanently unable to upgrade, detect that one specific failure and
  // transparently mint a fresh live-mode customer, save it over the stale id, and retry
  // once. Any other checkout failure (bad price id, card errors, etc.) is returned as-is.
  if (!sessionRes.ok) {
    const errText = await sessionRes.text();
    let isStaleCustomer = false;
    try {
      const errBody = JSON.parse(errText);
      isStaleCustomer = errBody?.error?.code === "resource_missing" && errBody?.error?.param === "customer";
    } catch {
      isStaleCustomer = /No such customer/i.test(errText);
    }

    if (isStaleCustomer) {
      const result = await createStripeCustomer();
      if (result instanceof Response) return result;
      customerId = result;
      sessionRes = await createCheckoutSession(customerId);
      if (!sessionRes.ok) {
        return json({ error: "Couldn't create checkout session", detail: await sessionRes.text() }, 500);
      }
    } else {
      return json({ error: "Couldn't create checkout session", detail: errText }, 500);
    }
  }

  const session = await sessionRes.json();
  return json({ url: session.url });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const config: Config = {
  path: "/api/create-checkout-session",
};
