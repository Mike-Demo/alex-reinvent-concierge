/**
 * GET /api/notes?key=<NAPSTER_API_KEY> — Azure Functions port of the
 * SpaceFast functions/api/notes.ts. Rebuilds every captured
 * introduction request from the Napster Sessions API so no request is
 * lost when a visitor closes the tab. Gated by the API key itself.
 */
const { app } = require("@azure/functions");

const AGENT_ID = "54b8d70a-416f-450d-b449-04169a52f6cb";
const API = "https://napster-api.napster.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

app.http("notes", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "notes",
  handler: async (request) => {
    const key = process.env.NAPSTER_API_KEY || "";
    if (!key) {
      return { status: 500, jsonBody: { error: "NAPSTER_API_KEY is not configured on the server" } };
    }
    if ((request.query.get("key") ?? "") !== key) {
      return { status: 401, jsonBody: { error: "unauthorized" } };
    }
    const headers = { "X-Api-Key": key, "User-Agent": UA, Accept: "application/json" };
    const getJson = async (path) => {
      const res = await fetch(API + path, { headers });
      if (!res.ok) return {};
      return res.json();
    };
    try {
      const list = await getJson("/public/sessions?pageSize=25");
      const sessions = (list.items ?? []).filter((s) => (s.agent ?? {}).id === AGENT_ID);
      const notes = [];
      let checked = 0;
      for (const s of sessions.slice(0, 15)) {
        const items = await getJson(`/public/sessions/${s.id}/items?pageSize=100`);
        checked++;
        for (const it of items.items ?? []) {
          if (it.type !== "toolCall") continue;
          const tc = it.toolCall ?? {};
          if (tc.name !== "log_meeting_note") continue;
          let args = {};
          try {
            args = JSON.parse(String(tc.arguments ?? "{}"));
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
      return {
        jsonBody: { notes, sessionsChecked: checked, fetchedAt: new Date().toISOString() },
        headers: { "Cache-Control": "no-store" },
      };
    } catch {
      return { status: 502, jsonBody: { error: "Upstream request failed" } };
    }
  },
});
