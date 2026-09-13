import type { Context, Config } from "@netlify/functions";

// ONE-OFF setup script, not a permanent part of the app -- creates the myBivy Team product
// and its three tier Prices in Stripe, then reports their ids so they can be pasted into
// Netlify env vars (STRIPE_PRICE_TEAM_5/10/15) and this file deleted. Refuses to run against
// a live-mode key without an explicit confirm=live query param, so it can't accidentally
// create real billable prices.

export default async (req: Request, context: Context) => {
  const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return json({ error: "STRIPE_SECRET_KEY not configured" }, 500);

  const url = new URL(req.url);
  const confirmLive = url.searchParams.get("confirm") === "live";
  const isLiveKey = stripeKey.startsWith("sk_live_");
  if (isLiveKey && !confirmLive) {
    return json({ error: "This is a LIVE Stripe key. Refusing to create real billable prices without ?confirm=live.", livemode: true }, 400);
  }

  const headers = { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" };

  const productRes = await fetch("https://api.stripe.com/v1/products", {
    method: "POST",
    headers,
    body: new URLSearchParams({ name: "myBivy Team", "metadata[app]": "mybivy" }),
  });
  if (!productRes.ok) return json({ error: "product creation failed", detail: await productRes.text() }, 500);
  const product = await productRes.json();

  const tiers = [
    { key: "team_5", amount: 44900 },
    { key: "team_10", amount: 69000 },
    { key: "team_15", amount: 99600 },
  ];

  const results: Record<string, any> = { livemode: product.livemode, product: product.id };
  for (const t of tiers) {
    const priceRes = await fetch("https://api.stripe.com/v1/prices", {
      method: "POST",
      headers,
      body: new URLSearchParams({
        product: product.id,
        currency: "usd",
        unit_amount: String(t.amount),
        "recurring[interval]": "month",
        "metadata[tier]": t.key,
        nickname: t.key,
      }),
    });
    if (!priceRes.ok) return json({ error: `price creation failed for ${t.key}`, detail: await priceRes.text(), partial: results }, 500);
    const price = await priceRes.json();
    results[t.key] = price.id;
  }

  return json(results);
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const config: Config = {
  path: "/api/_setup-team-prices",
};
