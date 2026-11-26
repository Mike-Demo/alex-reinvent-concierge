/**
 * GET /api/feed — live social + news feeds for the concierge app.
 * Azure Functions (Node.js v4 programming model) port of the SpaceFast
 * functions/api/feed.ts — behavior and JSON shape preserved exactly.
 *
 * Sources (both public, no keys):
 * - Bluesky public AppView search for re:Invent posts.
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

app.http("feed", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "feed",
  handler: async (request, context) => {
    const [posts, news] = await Promise.all([bluesky(), awsNews()]);
    return {
      jsonBody: { bluesky: posts, awsNews: news, fetchedAt: new Date().toISOString() },
      headers: { "Cache-Control": "public, max-age=300" },
    };
  },
});
