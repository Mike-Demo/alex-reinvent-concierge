/**
 * POST /api/token — mint a short-lived Napster WebRTC connection token.
 *
 * The Napster API key lives in the SpaceFast space env var NAPSTER_API_KEY
 * and never reaches the browser. The browser only receives the token.
 */

const AGENT_ID = "54b8d70a-416f-450d-b449-04169a52f6cb";

const handler = async (
  _request: Request,
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
        body: JSON.stringify({ channelType: "webrtc" }),
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
