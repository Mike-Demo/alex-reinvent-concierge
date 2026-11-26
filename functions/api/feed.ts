/**
 * GET /api/feed — live social + news feeds for the concierge app.
 *
 * Sources:
 * - Bluesky public AppView search for re:Invent posts (no key).
 * - X (Twitter) API v2 recent search for re:Invent posts, using the
 *   app-only Bearer token in the space env var X_BEARER_TOKEN. When
 *   ?lat=&lng= are supplied (the visitor shared their location), a
 *   second X query returns geo-tagged posts near them via the
 *   point_radius operator (25 mi cap; only a small share of posts
 *   carry geo, so this slice can legitimately be empty).
 * - AWS News Blog RSS.
 * Failures degrade to empty lists; the client shows link-outs instead.
 */

type FeedPost = {
  author: string;
  handle: string;
  text: string;
  url: string;
  createdAt: string;
  place?: string;
};

type NewsItem = { title: string; url: string; published: string };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function bluesky(): Promise<FeedPost[]> {
  try {
    const res = await fetch(
      "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=" +
        encodeURIComponent("awsreinvent") +
        "&limit=15&sort=latest",
      { headers: { "User-Agent": UA, Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { posts?: unknown[] };
    const out: FeedPost[] = [];
    for (const p of (data.posts ?? []) as Array<Record<string, unknown>>) {
      const author = (p.author ?? {}) as Record<string, unknown>;
      const record = (p.record ?? {}) as Record<string, unknown>;
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

async function xSearch(token: string, query: string, max: number): Promise<FeedPost[]> {
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
    const data = (await res.json()) as {
      data?: Array<Record<string, unknown>>;
      includes?: { users?: Array<Record<string, unknown>>; places?: Array<Record<string, unknown>> };
    };
    const users = new Map((data.includes?.users ?? []).map((u) => [String(u.id), u]));
    const places = new Map((data.includes?.places ?? []).map((p) => [String(p.id), p]));
    const out: FeedPost[] = [];
    for (const t of data.data ?? []) {
      const u = users.get(String(t.author_id)) ?? {};
      const geo = (t.geo ?? {}) as Record<string, unknown>;
      const place = geo.place_id ? places.get(String(geo.place_id)) : undefined;
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

function deTag(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

async function awsNews(): Promise<NewsItem[]> {
  try {
    const res = await fetch("https://aws.amazon.com/blogs/aws/feed/", {
      headers: { "User-Agent": UA, Accept: "application/rss+xml" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: NewsItem[] = [];
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

const handler = async (
  request: Request,
  context: { env: Record<string, unknown> },
): Promise<Response> => {
  const env = context?.env ?? {};
  const token = typeof env.X_BEARER_TOKEN === "string" ? env.X_BEARER_TOKEN : "";
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const hasLoc =
    Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (lat !== 0 || lng !== 0);

  const jobs: [Promise<FeedPost[]>, Promise<NewsItem[]>, Promise<FeedPost[]>, Promise<FeedPost[]>] = [
    bluesky(),
    awsNews(),
    token ? xSearch(token, X_QUERY, 12) : Promise.resolve([]),
    token && hasLoc
      ? xSearch(token, `${X_QUERY} point_radius:[${lng.toFixed(5)} ${lat.toFixed(5)} 25mi]`, 10)
      : Promise.resolve([]),
  ];
  const [posts, news, x, xNear] = await Promise.all(jobs);
  return Response.json(
    { bluesky: posts, awsNews: news, x, xNear, xConfigured: Boolean(token), fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "public, max-age=120" } },
  );
};

export const GET = handler;
