/**
 * GET|POST /api/buzz — compact live digest for Alex's explicit
 * (server-side) tool `get_live_conference_buzz`. Napster's servers call
 * this endpoint directly mid-conversation; the JSON returned here is
 * what Alex summarizes for the visitor.
 *
 * Sources (public, no keys): Bluesky search for re:Invent posts and the
 * AWS News Blog RSS — same upstreams as /api/feed, trimmed for a tool
 * result. Failures degrade to empty lists.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function bluesky(): Promise<Array<{ author: string; text: string; at: string }>> {
  try {
    const res = await fetch(
      "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=" +
        encodeURIComponent("awsreinvent") +
        "&limit=6&sort=latest",
      { headers: { "User-Agent": UA, Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { posts?: unknown[] };
    const out: Array<{ author: string; text: string; at: string }> = [];
    for (const p of (data.posts ?? []) as Array<Record<string, unknown>>) {
      const author = (p.author ?? {}) as Record<string, unknown>;
      const record = (p.record ?? {}) as Record<string, unknown>;
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

async function awsNews(): Promise<Array<{ title: string; published: string }>> {
  try {
    const res = await fetch("https://aws.amazon.com/blogs/aws/feed/", {
      headers: { "User-Agent": UA, Accept: "application/rss+xml" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const out: Array<{ title: string; published: string }> = [];
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

const handler = async (): Promise<Response> => {
  const [posts, news] = await Promise.all([bluesky(), awsNews()]);
  return Response.json(
    {
      about:
        "Live conference buzz for AWS re:Invent 2026: the latest Bluesky posts about the event and the newest AWS News Blog headlines. Summarize the freshest 2-3 items briefly and name the source.",
      bluesky: posts,
      awsNews: news,
      fetchedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "public, max-age=120" } },
  );
};

export const GET = handler;
export const POST = handler;
