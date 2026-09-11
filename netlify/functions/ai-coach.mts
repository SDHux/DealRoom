import type { Context, Config } from "@netlify/functions";

// Server-side proxy for the AI Coach / deal-extraction features.
// The Anthropic API key lives ONLY in Netlify's environment variables
// (Site settings -> Environment variables -> ANTHROPIC_API_KEY) and is
// never sent to the browser. The client calls this function instead of
// calling api.anthropic.com directly.
//
// Previously this endpoint had NO authentication at all -- any caller who found the
// URL could run unlimited requests against the shared Anthropic key, myBivy user or
// not. It now requires the caller's Supabase access token, confirms org membership,
// and enforces a per-org monthly cap (check_and_increment_ai_coach_usage, migration
// 0029) before ever reaching Anthropic. Mirrors create-checkout-session.mts's auth
// shape: forward the user's own token, talk to Supabase via plain REST, let RLS/the
// SECURITY DEFINER RPC do the real authorization -- no service-role key here either.
// Rep-only by product decision -- the client already keeps the AI panel and its
// trigger buttons behind viewMode==="rep"; this is the server-side backstop for that
// same boundary, not a new restriction.

const SUPABASE_URL = "https://hjumgvnuqvmxdusldeba.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_gRA_qf4uQVX9BKhJHuV6hQ_oMRTypV3";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json(
      { error: "AI Coach is not configured yet. Add ANTHROPIC_API_KEY in Netlify site settings." },
      500
    );
  }

  let body: { system?: string; messages?: unknown; max_tokens?: number; accessToken?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const { system, messages, max_tokens, accessToken } = body;
  if (!messages) return json({ error: "Missing messages" }, 400);
  if (!accessToken) return json({ error: "Not authenticated" }, 401);

  const authHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` };

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: authHeaders });
  if (!userRes.ok) return json({ error: "Not authenticated" }, 401);
  const user = await userRes.json();

  // Same "does this user actually belong to an org" lookup as create-checkout-session.mts --
  // organization_members RLS only lets you read your own membership row.
  const memRes = await fetch(
    `${SUPABASE_URL}/rest/v1/organization_members?select=org_id&user_id=eq.${user.id}&limit=1`,
    { headers: authHeaders }
  );
  const members = memRes.ok ? await memRes.json() : [];
  const orgId = members[0]?.org_id;
  if (!orgId) return json({ error: "No organization found for this user" }, 403);

  const usageRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_and_increment_ai_coach_usage`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ p_org_id: orgId }),
  });
  if (!usageRes.ok) {
    return json({ error: "Couldn't verify AI Coach usage", detail: await usageRes.text() }, 500);
  }
  const usageRows = await usageRes.json();
  const usage = usageRows?.[0];
  if (!usage?.allowed) {
    return json(
      { error: `Monthly AI Coach limit reached (${usage?.monthly_cap ?? "?"} requests). Resets next month.` },
      429
    );
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        // Ceiling raised 2000->4000 for the transcript-extraction call (app.jsx's gen()),
        // whose JSON payload (exec summary, discovery, stakeholders, now tasks too) can
        // exceed 2000 tokens and get cut off mid-structure before the closing braces.
        max_tokens: Math.min(max_tokens || 1400, 4000),
        system,
        messages,
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      return json({ error: "Upstream AI request failed", detail: errText }, r.status);
    }

    const data = await r.json();
    // Confirmed via Netlify function logs (2026-09-08): claude-sonnet-5 emits a leading
    // thinking block ahead of the text block ([`"thinking"`, `"text"`], stop_reason
    // end_turn), so content[0] is not reliably the answer -- find the text block by type
    // instead of assuming its position.
    const textBlock = data?.content?.find((b: any) => b.type === "text");
    const text = textBlock?.text || "";
    return json({ text });
  } catch (err) {
    return json({ error: "AI Coach request failed" }, 500);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const config: Config = {
  path: "/api/ai-coach",
};
