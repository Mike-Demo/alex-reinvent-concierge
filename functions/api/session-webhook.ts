/**
 * POST /api/session-webhook — receiver for Napster project webhooks
 * (session.started / session.closed / companion.* events).
 *
 * Registration is dashboard-only (Napster dashboard → Project →
 * Webhooks). When the signing secret is stored in the space env as
 * NAPSTER_WEBHOOK_SECRET, each delivery's X-Webhook-Signature is
 * verified as the hex HMAC-SHA256 of the raw body keyed with the secret
 * string as-is. Without the secret configured, events are accepted and
 * logged as unverified (setup mode).
 */

async function hmacHex(secret: string, raw: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(raw));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const handler = async (
  request: Request,
  context: { env: Record<string, unknown> },
): Promise<Response> => {
  const raw = await request.text();
  const secret =
    typeof context?.env?.NAPSTER_WEBHOOK_SECRET === "string"
      ? (context.env.NAPSTER_WEBHOOK_SECRET as string)
      : "";

  if (secret) {
    const expected = await hmacHex(secret, raw);
    const received = request.headers.get("X-Webhook-Signature") ?? "";
    if (received !== expected) {
      console.log("[webhook] signature mismatch — rejected");
      return Response.json({ error: "bad signature" }, { status: 401 });
    }
  }

  let eventType = "unknown";
  let sessionId = "";
  try {
    const body = JSON.parse(raw) as {
      eventType?: string;
      data?: { session?: { id?: string }; companion?: { id?: string } };
    };
    eventType = body.eventType ?? "unknown";
    sessionId = body.data?.session?.id ?? body.data?.companion?.id ?? "";
  } catch {
    // Non-JSON body: still acknowledge so the sender does not retry-loop.
  }
  console.log(
    `[webhook] ${eventType} ${sessionId} ${secret ? "verified" : "UNVERIFIED (no secret configured)"}`,
  );
  return Response.json({ ok: true, eventType });
};

export const POST = handler;
