import type { Context, Config } from "@netlify/functions";

// Server-side proxy for the AI Coach / deal-extraction features.
// The Anthropic API key lives ONLY in Netlify's environment variables
// (Site settings -> Environment variables -> ANTHROPIC_API_KEY) and is
// never sent to the browser. The client calls this function instead of
// calling api.anthropic.com directly.

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "AI Coach is not configured yet. Add ANTHROPIC_API_KEY in Netlify site settings." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: { system?: string; messages?: unknown; max_tokens?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { system, messages, max_tokens } = body;
  if (!messages) {
    return new Response(JSON.stringify({ error: "Missing messages" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
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
        model: "claude-sonnet-4-20250514",
        max_tokens: Math.min(max_tokens || 1400, 2000),
        system,
        messages,
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      return new Response(JSON.stringify({ error: "Upstream AI request failed", detail: errText }), {
        status: r.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await r.json();
    const text = data?.content?.[0]?.text || "";
    return new Response(JSON.stringify({ text }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "AI Coach request failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/api/ai-coach",
};
