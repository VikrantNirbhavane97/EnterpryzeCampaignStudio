// Cloudflare Pages Function — POST /api/generate
//
// The browser posts { messages, tools, maxTokens } here. This function adds the
// secret Anthropic API key (never sent to the browser), calls the Anthropic
// Messages API from the server, and returns { text }.
//
// Required secret:   ANTHROPIC_API_KEY   (mark as "Encrypt" in Cloudflare)
// Optional variable: ANTHROPIC_MODEL     (defaults to DEFAULT_MODEL below)
// Optional variable: ALLOWED_ORIGINS     (comma-separated extra origins to allow)

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const MAX_BODY_BYTES = 100 * 1024; // 100 KB — plenty for a prompt, blocks abuse
const HARD_MAX_TOKENS = 4000; // ceiling regardless of what the client asks for

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// Basic origin allow-list. Same-origin POSTs from the deployed site are always
// allowed; ALLOWED_ORIGINS can add more (e.g. a preview domain). NOTE: origin
// checking is NOT authentication — see README for Cloudflare Access.
function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // curl / same-origin navigations may omit Origin
  const allowed = [new URL(request.url).origin];
  if (env.ALLOWED_ORIGINS) {
    env.ALLOWED_ORIGINS.split(",").forEach((o) => {
      const t = o.trim();
      if (t) allowed.push(t);
    });
  }
  return allowed.includes(origin);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. Origin check (lightweight abuse guard, not real auth)
  if (!originAllowed(request, env)) {
    return json({ error: "Requests from this origin are not allowed." }, 403);
  }

  // 2. Secret must be configured
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Do not leak which secret is missing beyond what an admin needs.
    return json(
      { error: "The writing service isn't configured yet. Please contact your administrator." },
      503
    );
  }

  // 3. Size guard (header first, then actual body length)
  const declaredLen = Number(request.headers.get("content-length") || 0);
  if (declaredLen && declaredLen > MAX_BODY_BYTES) {
    return json({ error: "That request is too large." }, 413);
  }

  // 4. Parse + validate body
  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ error: "That request is too large." }, 413);
    }
    body = raw ? JSON.parse(raw) : {};
  } catch (e) {
    return json({ error: "The request could not be read. Please try again." }, 400);
  }

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return json({ error: "No prompt was provided." }, 400);
  }
  if (messages.length > 50) {
    return json({ error: "Too many messages in one request." }, 400);
  }
  for (const m of messages) {
    if (!m || typeof m.role !== "string" || typeof m.content === "undefined") {
      return json({ error: "The prompt was malformed." }, 400);
    }
  }

  // 5. Clamp max_tokens
  let maxTokens = parseInt(body.maxTokens, 10);
  if (!Number.isFinite(maxTokens) || maxTokens < 1) maxTokens = 1000;
  if (maxTokens > HARD_MAX_TOKENS) maxTokens = HARD_MAX_TOKENS;

  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const payload = { model, max_tokens: maxTokens, messages };

  // 6. Tools. The server can run Anthropic's server-side web_search tool, so we
  //    pass supported tools straight through. Unknown/unsupported tool types are
  //    dropped rather than failing the whole request.
  if (Array.isArray(body.tools) && body.tools.length) {
    const tools = body.tools.filter((t) => t && typeof t.type === "string");
    if (tools.length) payload.tools = tools;
  }

  // 7. Call Anthropic
  let anthResp;
  try {
    anthResp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json({ error: "Could not reach the writing service. Please try again shortly." }, 502);
  }

  let data;
  try {
    data = await anthResp.json();
  } catch (e) {
    data = null;
  }

  // 8. Map upstream errors to safe, user-facing messages (full detail stays in logs)
  if (!anthResp.ok) {
    console.error("Anthropic API error", anthResp.status, JSON.stringify(data));

    const upstreamType = data && data.error && data.error.type;

    if (anthResp.status === 429) {
      return json({ error: "The writing service is busy right now. Please wait a moment and try again." }, 429);
    }
    if (anthResp.status === 401 || anthResp.status === 403) {
      return json({ error: "The writing service isn't configured correctly. Please contact your administrator." }, 502);
    }
    if (anthResp.status === 400 && /tool/i.test(String(upstreamType) + JSON.stringify(data))) {
      return json({ error: "A requested research tool isn't available. Please try again." }, 400);
    }
    return json({ error: "The writing service couldn't complete this request. Please try again." }, 502);
  }

  // 9. Extract plain text from content blocks
  let text = "";
  if (data && Array.isArray(data.content)) {
    text = data.content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("")
      .trim();
  }

  if (!text) {
    return json({ error: "The writing service returned an empty response. Please try again." }, 502);
  }

  return json({ text });
}

// Any non-POST method → clean 405 (never exposes the key or logic).
export async function onRequestGet() {
  return json({ error: "Method not allowed. Use POST." }, 405);
}

export async function onRequestPut() {
  return json({ error: "Method not allowed. Use POST." }, 405);
}

export async function onRequestDelete() {
  return json({ error: "Method not allowed. Use POST." }, 405);
}
