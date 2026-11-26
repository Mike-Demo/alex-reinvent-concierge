/**
 * POST /api/token — mint a short-lived Napster WebRTC connection token.
 *
 * The Napster API key lives in the SpaceFast space env var NAPSTER_API_KEY
 * and never reaches the browser. The browser only receives the token.
 */

const AGENT_ID = "54b8d70a-416f-450d-b449-04169a52f6cb";

const handler = async (
  request: Request,
  context: { env: Record<string, unknown> },
): Promise<Response> => {
  const env = context?.env ?? {};
  const key = typeof env.NAPSTER_API_KEY === "string" ? env.NAPSTER_API_KEY : "";
  if (!key) {
    return Response.json(
      { error: "NAPSTER_API_KEY is not configured on the server" },
      { status: 500 },
    );
  }

  // Optional cross-session memory: the client may send a stable
  // externalClientId (+ a small profile). Napster scopes its memory to
  // persona + client ID, so the same ID recalls past conversations.
  let client: Record<string, unknown> = {};
  try {
    client = (await request.json()) as Record<string, unknown>;
  } catch {}
  const payload: Record<string, unknown> = { channelType: "webrtc" };
  const extId = typeof client.externalClientId === "string" ? client.externalClientId : "";
  if (/^[A-Za-z0-9_-]{1,32}$/.test(extId)) {
    payload.externalClientId = extId;
    const prof = (client.profile ?? {}) as Record<string, unknown>;
    const profile: Record<string, string> = {};
    if (typeof prof.name === "string" && prof.name) profile.name = prof.name.slice(0, 80);
    if (typeof prof.company === "string" && prof.company) profile.company = prof.company.slice(0, 80);
    if (Object.keys(profile).length) payload.externalClientProfile = profile;
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://napster-api.napster.com/public/agents/${AGENT_ID}/connections`,
      {
        method: "POST",
        headers: {
          "X-Api-Key": key,
          "Content-Type": "application/json",
          // napster-api.napster.com sits behind Cloudflare, which blocks
          // non-browser client signatures (Error 1010). Send a browser UA.
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
        body: JSON.stringify(payload),
      },
    );
  } catch {
    return Response.json(
      { error: "Upstream request failed" },
      { status: 502 },
    );
  }

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};

export const POST = handler;
