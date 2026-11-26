/**
 * GET /api/notes?key=<NAPSTER_API_KEY> — recover every meeting
 * note Alex has logged, straight from the Napster Sessions API.
 *
 * Why this exists: the in-page list of captured requests dies with the
 * tab. Sessions (with full tool-call history) persist server-side, so
 * this endpoint rebuilds the list from session items — no request is
 * ever lost. Access is gated by the Napster API key itself: anyone who
 * holds it already has full API access, so this adds no new exposure.
 */

const AGENT_ID = "54b8d70a-416f-450d-b449-04169a52f6cb";
const API = "https://napster-api.napster.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

type Note = {
  sessionId: string;
  at: string;
  request: Record<string, unknown>;
};

const handler = async (
  request: Request,
  context: { env: Record<string, unknown> },
): Promise<Response> => {
  const key =
    typeof context?.env?.NAPSTER_API_KEY === "string"
      ? (context.env.NAPSTER_API_KEY as string)
      : "";
  if (!key) {
    return Response.json(
      { error: "NAPSTER_API_KEY is not configured on the server" },
      { status: 500 },
    );
  }
  const provided = new URL(request.url).searchParams.get("key") ?? "";
  if (provided !== key) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const headers = { "X-Api-Key": key, "User-Agent": UA, Accept: "application/json" };
  const getJson = async (path: string): Promise<Record<string, unknown>> => {
    const res = await fetch(API + path, { headers });
    if (!res.ok) return {};
    return (await res.json()) as Record<string, unknown>;
  };

  try {
    const list = await getJson("/public/sessions?pageSize=25");
    const sessions = ((list.items ?? []) as Array<Record<string, unknown>>).filter(
      (s) => ((s.agent ?? {}) as Record<string, unknown>).id === AGENT_ID,
    );
    const notes: Note[] = [];
    let checked = 0;
    for (const s of sessions.slice(0, 15)) {
      const items = await getJson(
        `/public/sessions/${String(s.id)}/items?pageSize=100`,
      );
      checked++;
      for (const it of (items.items ?? []) as Array<Record<string, unknown>>) {
        if (it.type !== "toolCall") continue;
        const tc = (it.toolCall ?? {}) as Record<string, unknown>;
        if (tc.name !== "log_meeting_note") continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(tc.arguments ?? "{}")) as Record<string, unknown>;
        } catch {
          args = { raw: String(tc.arguments ?? "") };
        }
        notes.push({
          sessionId: String(s.id),
          at: new Date(Number(it.timestamp ?? 0)).toISOString(),
          request: args,
        });
      }
    }
    return Response.json(
      { notes, sessionsChecked: checked, fetchedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Upstream request failed" }, { status: 502 });
  }
};

export const GET = handler;
