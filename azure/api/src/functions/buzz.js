/**
 * GET|POST /api/buzz — Azure Functions port of the SpaceFast
 * functions/api/buzz.ts. Compact live digest for Alex's explicit
 * (server-side) tool `get_live_conference_buzz`.
 */
const { app } = require("@azure/functions");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function bluesky() {
  try {
    const res = await fetch(
      "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=" +
        encodeURIComponent("awsreinvent") +
        "&limit=6&sort=latest",
      { headers: { "User-Agent": UA, Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const out = [];
    for (const p of data.posts ?? []) {
      const author = p.author ?? {};
      const record = p.record ?? {};
      out.push({
        author: String(author.displayName ?? author.handle ?? "Bluesky user"),
        text: String(record.text ?? "").slice(0, 200),
        at: String(record.createdAt ?? ""),
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function xPosts(token) {
  if (!token) return [];
  try {
    const params = new URLSearchParams({
      query: "(#AWSreInvent OR #reInvent) -is:retweet",
      max_results: "10", // X recent search only accepts 10-100
      "tweet.fields": "created_at",
      expansions: "author_id",
      "user.fields": "name,username",
    });
    const res = await fetch(`https://api.x.com/2/tweets/search/recent?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const users = new Map((data.includes?.users ?? []).map((u) => [String(u.id), u]));
    return (data.data ?? []).slice(0, 6).map((t) => {
      const u = users.get(String(t.author_id)) ?? {};
      return {
        author: String(u.name ?? u.username ?? "X user"),
        text: String(t.text ?? "").slice(0, 200),
        at: String(t.created_at ?? ""),
      };
    });
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
    const out = [];
    for (const b of xml.split("<item>").slice(1, 6)) {
      const title = deTag((b.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1] ?? "");
      const published = deTag((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) ?? [])[1] ?? "");
      if (title) out.push({ title, published });
    }
    return out;
  } catch {
    return [];
  }
}

app.http("buzz", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "buzz",
  handler: async () => {
    const token = process.env.X_BEARER_TOKEN || "";
    const [x, posts, news] = await Promise.all([xPosts(token), bluesky(), awsNews()]);
    return {
      jsonBody: {
        about:
          "Live conference buzz for AWS re:Invent 2026: the latest X and Bluesky posts about the event and the newest AWS News Blog headlines. Summarize the freshest 2-3 items briefly and name the source (X, Bluesky, or AWS News).",
        x,
        bluesky: posts,
        awsNews: news,
        fetchedAt: new Date().toISOString(),
      },
      headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" },
    };
  },
});
