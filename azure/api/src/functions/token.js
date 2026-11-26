/**
 * POST /api/token — mint a short-lived Napster WebRTC connection token.
 * Azure Functions (Node.js v4 programming model) port of the SpaceFast
 * functions/api/token.ts — behavior preserved exactly.
 *
 * The Napster API key lives in the Static Web App's application settings
 * (NAPSTER_API_KEY) and never reaches the browser. The browser only
 * receives the token.
 */
const { app } = require("@azure/functions");

const AGENT_ID = "54b8d70a-416f-450d-b449-04169a52f6cb";

app.http("token", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "token",
  handler: async (request, context) => {
    const key = process.env.NAPSTER_API_KEY || "";
    if (!key) {
      return {
        status: 500,
        jsonBody: { error: "NAPSTER_API_KEY is not configured on the server" },
      };
    }

    // Optional cross-session memory: a stable externalClientId (+ small
    // profile) from the client; Napster scopes memory to persona + ID.
    let client = {};
    try {
      client = await request.json();
    } catch {}
    const payload = { channelType: "webrtc" };
    const extId = typeof client.externalClientId === "string" ? client.externalClientId : "";
    if (/^[A-Za-z0-9_-]{1,32}$/.test(extId)) {
      payload.externalClientId = extId;
      const prof = client.profile ?? {};
      const profile = {};
      if (typeof prof.name === "string" && prof.name) profile.name = prof.name.slice(0, 80);
      if (typeof prof.company === "string" && prof.company) profile.company = prof.company.slice(0, 80);
      if (Object.keys(profile).length) payload.externalClientProfile = profile;
    }

    let upstream;
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
      return { status: 502, jsonBody: { error: "Upstream request failed" } };
    }

    const body = await upstream.text();
    return {
      status: upstream.status,
      body,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    };
  },
});
