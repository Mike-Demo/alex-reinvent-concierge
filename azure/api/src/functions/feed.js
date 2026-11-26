/**
 * GET /api/feed — live social + news feeds for the concierge app.
 * Azure Functions (Node.js v4 programming model) port of the SpaceFast
 * functions/api/feed.ts — behavior and JSON shape preserved.
 *
 * Sources:
 * - Bluesky public AppView search for re:Invent posts (no key).
 * - X (Twitter) API v2 recent search, app-only Bearer token in the app
 *   setting X_BEARER_TOKEN. With ?lat=&lng=, a second query returns
 *   geo-tagged posts near the visitor (point_radius, 25 mi cap).
 * - AWS News Blog RSS.
 * Failures degrade to empty lists; the client shows link-outs instead.
 */
const { app } = require("@azure/functions");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function bluesky() {
  try {
    const res = await fetch(
      "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=" +
        encodeURIComponent("awsreinvent") +
        "&limit=15&sort=latest",
      { headers: { "User-Agent": UA, Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const out = [];
    for (const p of data.posts ?? []) {
      const author = p.author ?? {};
      const record = p.record ?? {};
      const handle = String(author.handle ?? "");
      const uri = String(p.uri ?? "");
      const rkey = uri.split("/").pop() ?? "";
      out.push({
        author: String(author.displayName ?? handle),
        handle,
        text: String(record.text ?? "").slice(0, 280),
        url: handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : "https://bsky.app/search?q=%23AWSreInvent",
        createdAt: String(record.createdAt ?? p.indexedAt ?? ""),
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function xSearch(token, query, max) {
  try {
    const params = new URLSearchParams({
      query,
      max_results: String(max),
      "tweet.fields": "created_at,geo",
      expansions: "author_id,geo.place_id",
      "user.fields": "name,username",
      "place.fields": "full_name",
    });
    const res = await fetch(`https://api.x.com/2/tweets/search/recent?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const users = new Map((data.includes?.users ?? []).map((u) => [String(u.id), u]));
    const places = new Map((data.includes?.places ?? []).map((p) => [String(p.id), p]));
    const out = [];
    for (const t of data.data ?? []) {
      const u = users.get(String(t.author_id)) ?? {};
      const place = t.geo?.place_id ? places.get(String(t.geo.place_id)) : undefined;
      const username = String(u.username ?? "");
      out.push({
        author: String(u.name ?? username ?? "X user"),
        handle: username,
        text: String(t.text ?? "").slice(0, 280),
        url: username ? `https://x.com/${username}/status/${String(t.id)}` : "https://x.com/search?q=%23AWSreInvent",
        createdAt: String(t.created_at ?? ""),
        ...(place?.full_name ? { place: String(place.full_name) } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function deTag(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

async function awsNews() {
  try {
    const res = await fetch("https://aws.amazon.com/blogs/aws/feed/", {
      headers: { "User-Agent": UA, Accept: "application/rss+xml" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [];
    const blocks = xml.split("<item>").slice(1, 9);
    for (const b of blocks) {
      const title = deTag((b.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1] ?? "");
      const url = deTag((b.match(/<link>([\s\S]*?)<\/link>/) ?? [])[1] ?? "");
      const published = deTag((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) ?? [])[1] ?? "");
      if (title && url) items.push({ title, url, published });
    }
    return items;
  } catch {
    return [];
  }
}

const X_QUERY = "(#AWSreInvent OR #reInvent) -is:retweet";

app.http("feed", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "feed",
  handler: async (request) => {
    const token = process.env.X_BEARER_TOKEN || "";
    const lat = Number(request.query.get("lat"));
    const lng = Number(request.query.get("lng"));
    const hasLoc =
      Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (lat !== 0 || lng !== 0);
    const [posts, news, x, xNear] = await Promise.all([
      bluesky(),
      awsNews(),
      token ? xSearch(token, X_QUERY, 12) : Promise.resolve([]),
      token && hasLoc
        ? xSearch(token, `${X_QUERY} point_radius:[${lng.toFixed(5)} ${lat.toFixed(5)} 25mi]`, 10)
        : Promise.resolve([]),
    ]);
    return {
      jsonBody: { bluesky: posts, awsNews: news, x, xNear, xConfigured: Boolean(token), fetchedAt: new Date().toISOString() },
      headers: { "Cache-Control": "public, max-age=120" },
    };
  },
});
