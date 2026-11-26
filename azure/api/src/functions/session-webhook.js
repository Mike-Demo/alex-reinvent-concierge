/**
 * POST /api/session-webhook — Azure Functions port of the SpaceFast
 * functions/api/session-webhook.ts. Receiver for Napster project
 * webhooks. Verifies X-Webhook-Signature (hex HMAC-SHA256 of the raw
 * body, keyed with the NAPSTER_WEBHOOK_SECRET string as-is) when the
 * secret is configured; otherwise accepts and logs as unverified.
 */
const { app } = require("@azure/functions");
const { createHmac } = require("node:crypto");

app.http("session-webhook", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "session-webhook",
  handler: async (request, context) => {
    const raw = await request.text();
    const secret = process.env.NAPSTER_WEBHOOK_SECRET || "";
    if (secret) {
      const expected = createHmac("sha256", secret).update(raw).digest("hex");
      const received = request.headers.get("x-webhook-signature") ?? "";
      if (received !== expected) {
        context.log("[webhook] signature mismatch — rejected");
        return { status: 401, jsonBody: { error: "bad signature" } };
      }
    }
    let eventType = "unknown";
    let sessionId = "";
    try {
      const body = JSON.parse(raw);
      eventType = body.eventType ?? "unknown";
      sessionId = body.data?.session?.id ?? body.data?.companion?.id ?? "";
    } catch {
      // Non-JSON body: still acknowledge.
    }
    context.log(
      `[webhook] ${eventType} ${sessionId} ${secret ? "verified" : "UNVERIFIED (no secret configured)"}`,
    );
    return { jsonBody: { ok: true, eventType } };
  },
});
