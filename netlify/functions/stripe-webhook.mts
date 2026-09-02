import type { Context, Config } from "@netlify/functions";
import { createHmac, timingSafeEqual } from "node:crypto";

// Stripe calls this endpoint directly -- there's no Supabase user session to forward, which
// is why this is the one function in the app that uses the Supabase service-role key
// (everything else is either a SECURITY DEFINER RPC or an RLS-respecting request with the
// caller's own JWT, see create-checkout-session.mts/create-portal-session.mts). Trust here
// comes entirely from verifying Stripe's webhook signature below, not from Supabase auth.

const SUPABASE_URL = "https://hjumgvnuqvmxdusldeba.supabase.co";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const webhookSecret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!webhookSecret || !serviceRoleKey) {
    return new Response("Webhook not configured yet", { status: 500 });
  }

  const rawBody = await req.text();
  const signatureHeader = req.headers.get("stripe-signature");
  if (!signatureHeader || !verifyStripeSignature(rawBody, signatureHeader, webhookSecret)) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  const dbHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  const patchOrgByCustomer = async (customerId: string, patch: Record<string, unknown>) => {
    await fetch(`${SUPABASE_URL}/rest/v1/organizations?stripe_customer_id=eq.${customerId}`, {
      method: "PATCH",
      headers: dbHeaders,
      body: JSON.stringify(patch),
    });
  };

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${session.subscription}`, {
          headers: { Authorization: `Bearer ${Netlify.env.get("STRIPE_SECRET_KEY")}` },
        });
        const sub = subRes.ok ? await subRes.json() : null;
        const orgId = session.client_reference_id;
        if (orgId && sub) {
          await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgId}`, {
            method: "PATCH",
            headers: dbHeaders,
            body: JSON.stringify({
              stripe_subscription_id: sub.id,
              subscription_status: mapStripeStatus(sub.status),
              current_period_end: new Date(currentPeriodEndOf(sub) * 1000).toISOString(),
            }),
          });
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object;
        await patchOrgByCustomer(sub.customer, {
          stripe_subscription_id: sub.id,
          subscription_status: mapStripeStatus(sub.status),
          current_period_end: new Date(currentPeriodEndOf(sub) * 1000).toISOString(),
        });
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await patchOrgByCustomer(sub.customer, { subscription_status: "canceled" });
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        await patchOrgByCustomer(invoice.customer, { subscription_status: "past_due" });
        break;
      }
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        await patchOrgByCustomer(invoice.customer, { subscription_status: "active" });
        break;
      }
      default:
        break; // Unhandled event types are ignored, not errors -- still ack with 200.
    }
  } catch (err) {
    console.error("stripe-webhook error:", err);
    return new Response("Webhook processing failed", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
};

// Stripe's Basil API version (2025-03-31 onward, which includes 2026-08-26.dahlia this
// webhook is pinned to) removed current_period_end/current_period_start from the top-level
// Subscription object -- they now live per subscription item instead. This app only ever
// creates single-item subscriptions (one price, see create-checkout-session.mts), so the
// first item is always the one that matters.
// https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end
function currentPeriodEndOf(sub: any): number | undefined {
  return sub.items?.data?.[0]?.current_period_end;
}

// Real Stripe subscription statuses (trialing/active/past_due/canceled/unpaid/incomplete/
// incomplete_expired/paused) collapsed onto this app's narrower check constraint (0018).
function mapStripeStatus(status: string): string {
  if (status === "active" || status === "trialing") return status;
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled" || status === "incomplete_expired") return "canceled";
  return "incomplete";
}

// Stripe-Signature header: "t=<timestamp>,v1=<hex hmac>[,v0=...]". Verifies HMAC-SHA256 of
// "<timestamp>.<rawBody>" against the webhook signing secret, timing-safe, with a 5-minute
// tolerance against replay -- Stripe's own documented verification algorithm.
function verifyStripeSignature(rawBody: string, header: string, secret: string): boolean {
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=")) as [string, string][]);
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(v1, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export const config: Config = {
  path: "/api/stripe-webhook",
};
