import type { Context, Config } from "@netlify/functions";

// Admin invites a teammate -> this creates their real account immediately (Team Admin/
// Manager Rework, Data model #1), not a passive pending row the rep completes themselves.
// Account creation goes through Supabase's Admin API (service-role key, already configured
// in Netlify -- see stripe-webhook.mts, the only other function that needs it) rather than
// a direct auth.users INSERT: auth.users is Supabase-owned internal schema, not a
// documented interface, so writing to it directly bypasses the interface Supabase actually
// maintains and could silently break on a future Auth upgrade. The org-membership/profile/
// activation-code half of this is a single atomic Postgres call (finish_teammate_
// provisioning, 0044) so that half can't itself partially fail.
//
// Two-step, not one transaction (Admin API call, then a DB call) -- if the second step
// fails after the first succeeds, deleteJustCreatedUser cleans up the orphaned auth.users
// row so the Admin can just retry the invite, rather than being permanently blocked by
// Bug 7's own "email already has an account" check against their own half-finished attempt.

const SUPABASE_URL = "https://hjumgvnuqvmxdusldeba.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_gRA_qf4uQVX9BKhJHuV6hQ_oMRTypV3";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    return json({ error: "Teammate provisioning is not configured yet. Add SUPABASE_SERVICE_ROLE_KEY in Netlify site settings." }, 500);
  }

  let body: { orgId?: string; accessToken?: string; fullName?: string; email?: string; isManager?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { orgId, accessToken, fullName, email, isManager } = body;
  if (!orgId || !accessToken || !email) {
    return json({ error: "Missing orgId, accessToken, or email" }, 400);
  }
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail.includes("@")) {
    return json({ error: "Enter a valid email address" }, 400);
  }

  // Caller's own token, not the service-role key, for the authorization check -- same
  // pattern as create-checkout-session.mts/create-portal-session.mts. The privileged part
  // (Admin API call) only happens after this confirms the caller is actually this org's
  // Admin, checked against their own real session, not merely asserted by the request body.
  const callerHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` };
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: callerHeaders });
  if (!userRes.ok) return json({ error: "Not authenticated" }, 401);
  const caller = await userRes.json();

  const memberRes = await fetch(
    `${SUPABASE_URL}/rest/v1/organization_members?select=is_admin&org_id=eq.${orgId}&user_id=eq.${caller.id}`,
    { headers: callerHeaders }
  );
  const members = memberRes.ok ? await memberRes.json() : [];
  if (!members.length || !members[0].is_admin) {
    return json({ error: "Only this organization's Admin can add a teammate" }, 403);
  }

  const serviceHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  // A long random value the client never sees and can never authenticate with directly --
  // GoTrue requires some password for a password-auth user, but the actual credential the
  // rep uses is the 6-digit code, verified separately (verify_activation_code, 0044), never
  // this. If a naive client somehow tried this value as a password, it would simply fail --
  // there's no path where it's ever exposed to be tried.
  const placeholderPassword = crypto.randomUUID() + crypto.randomUUID();

  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({
      email: cleanEmail,
      password: placeholderPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName || null },
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    let isDuplicate = false;
    try {
      const errBody = JSON.parse(errText);
      isDuplicate =
        errBody?.error_code === "email_exists" ||
        /already been registered|already exists/i.test(errBody?.msg || errBody?.message || "");
    } catch {
      isDuplicate = /already been registered|already exists/i.test(errText);
    }
    // Bug 7 from the punch list: an email that already has ANY myBivy account (Solo or
    // otherwise) must fail loudly and explicitly here, not silently create a duplicate or
    // leave an orphaned, unactionable invite.
    if (isDuplicate) {
      return json({ error: "existing_account", message: `${cleanEmail} already has a myBivy account and can't be provisioned as a new teammate this way.` }, 409);
    }
    return json({ error: "Couldn't create the teammate's account", detail: errText }, 500);
  }

  const newUser = await createRes.json();
  const newUserId: string = newUser.id;

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");

  const finishRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/finish_teammate_provisioning`, {
    method: "POST",
    headers: { ...callerHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_org_id: orgId,
      p_user_id: newUserId,
      p_full_name: fullName || null,
      p_email: cleanEmail,
      p_is_manager: !!isManager,
      p_code: code,
    }),
  });

  if (!finishRes.ok) {
    const detail = await finishRes.text();
    // Compensating cleanup: the account now exists but has no organization_members/profiles
    // row, which would otherwise make it invisible to the Admin Portal roster AND
    // permanently block a retry (the email would now trip the "already has an account"
    // check above on the very next attempt for a case that was actually just a failed
    // provisioning, not a real duplicate). Delete it so the Admin can just try again cleanly.
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${newUserId}`, { method: "DELETE", headers: serviceHeaders });
    return json({ error: "Couldn't finish setting up this teammate. Nothing was created -- please try again.", detail }, 500);
  }

  const origin = req.headers.get("origin") || "https://mybivy.com";
  return json({
    email: cleanEmail,
    code,
    activationUrl: `${origin}/?activate=${encodeURIComponent(cleanEmail)}`,
  });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const config: Config = {
  path: "/api/provision-teammate",
};
