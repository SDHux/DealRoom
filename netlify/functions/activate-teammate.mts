import type { Context, Config } from "@netlify/functions";

// Second half of the invite-provisioning flow (provision-teammate.mts is the first): the
// rep's own first-login exchange. Takes their email + the 6-digit code, verifies it against
// the bcrypt hash stored on their organization_members row (verify_activation_code, 0044,
// which also enforces its own attempt cap and expiry, independent of Supabase's generic
// per-IP sign-in rate limit -- see that migration's comments for why the code isn't just
// the rep's literal Supabase password). A correct code doesn't log the rep in by itself; it
// authorizes this function to mint a one-time Supabase recovery token via the Admin API,
// which the client exchanges with verifyOtp() to get a real session and the exact
// PASSWORD_RECOVERY event the app's existing ResetPassword UI already handles.
//
// No caller-identity check here (unlike provision-teammate.mts) -- this endpoint IS the
// pre-login identity check. Anyone can call it, but all it can ever do is consume one
// specific rep's already-issued code; verify_activation_code is the actual gate.

const SUPABASE_URL = "https://hjumgvnuqvmxdusldeba.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_gRA_qf4uQVX9BKhJHuV6hQ_oMRTypV3";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    return json({ error: "Account activation is not configured yet. Add SUPABASE_SERVICE_ROLE_KEY in Netlify site settings." }, 500);
  }

  let body: { email?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const email = body.email?.trim().toLowerCase();
  const code = body.code?.trim();
  if (!email || !code) {
    return json({ error: "Enter your email and the 6-digit code" }, 400);
  }

  const serviceHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  // verify_activation_code is anon-callable BY DESIGN (0044 grants execute to
  // authenticated, anon) -- and that grant is the reason it has to be called with the anon
  // key, not the service-role key: 0044's "revoke all from public" on this function also
  // revokes service_role's normally-implicit access through the public pseudo-role, since
  // service_role was never explicitly re-granted alongside authenticated/anon. Found live
  // during QA: calling this with serviceHeaders returned Postgres 42501, "permission denied
  // for function verify_activation_code" -- not a logic bug in the function itself (direct
  // SQL and a raw curl with the anon key both verified it works correctly).
  const anonHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" };
  const verifyRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_activation_code`, {
    method: "POST",
    headers: anonHeaders,
    body: JSON.stringify({ p_email: email, p_code: code }),
  });
  if (!verifyRes.ok) {
    console.error("activate-teammate: verify_activation_code REST call failed", verifyRes.status, await verifyRes.text());
    return json({ error: "Couldn't verify that code -- please try again." }, 500);
  }
  const result = await verifyRes.json();

  if (!result.success) {
    const messages: Record<string, string> = {
      expired: "That code has expired -- ask your Admin to resend one.",
      locked: "Too many incorrect attempts -- ask your Admin to resend a fresh code.",
      invalid: "That code isn't right. Double-check it and try again.",
    };
    return json({ error: messages[result.error] || messages.invalid }, 400);
  }

  const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({ type: "recovery", email }),
  });
  if (!linkRes.ok) {
    console.error("activate-teammate: admin/generate_link failed", linkRes.status, await linkRes.text());
    return json({ error: "Couldn't finish activating your account -- please try again or ask your Admin to resend a code." }, 500);
  }
  const link = await linkRes.json();
  const tokenHash: string | undefined = link?.properties?.hashed_token;
  if (!tokenHash) {
    return json({ error: "Couldn't finish activating your account -- please try again or ask your Admin to resend a code." }, 500);
  }

  return json({ email, tokenHash });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const config: Config = {
  path: "/api/activate-teammate",
};
