/**
 * GET /api/geo — coarse, IP-based location hint for the concierge app.
 *
 * Used only as a fallback when precise location is unavailable (GPS is
 * unreliable deep inside casino venues, and visitors may decline the
 * permission prompt). The caller's IP is resolved to a CITY by
 * ip-api.com (ipapi.co fallback). That is the honest ceiling of IP
 * geolocation: on venue WiFi it can say "Las Vegas", never which of
 * the six campus venues — the app pairs this with a venue picker for
 * the exact spot. The result is computed per request, cached briefly
 * in memory, and never stored or logged.
 */

const STRIP = { lat: 36.115, lng: -115.17 };

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function isPrivateIp(ip: string): boolean {
  return (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("127.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip === "::1" ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe80")
  );
}

type GeoBody = {
  found: boolean;
  city?: string;
  region?: string;
  country?: string;
  lat?: number;
  lng?: number;
  nearVegas?: boolean;
  source: string;
};

const cache = new Map<string, { at: number; body: GeoBody }>();
const TTL_MS = 10 * 60 * 1000;

const handler = async (request: Request): Promise<Response> => {
  const h = request.headers;
  // Platform-provided geo headers, when the host supplies them.
  const platLat = Number(h.get("cf-iplatitude"));
  const platLng = Number(h.get("cf-iplongitude"));
  if (Number.isFinite(platLat) && Number.isFinite(platLng) && (platLat !== 0 || platLng !== 0)) {
    const body: GeoBody = {
      found: true,
      city: h.get("cf-ipcity") ?? undefined,
      region: h.get("cf-region") ?? undefined,
      country: h.get("cf-ipcountry") ?? undefined,
      lat: Math.round(platLat * 10) / 10,
      lng: Math.round(platLng * 10) / 10,
      nearVegas: milesBetween(platLat, platLng, STRIP.lat, STRIP.lng) < 40,
      source: "platform-headers",
    };
    return Response.json(body, { headers: { "Cache-Control": "private, max-age=300" } });
  }

  const fwd = (h.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ip = h.get("cf-connecting-ip") || fwd || h.get("x-real-ip") || "";
  if (!ip || isPrivateIp(ip)) {
    return Response.json(
      { found: false, source: "none" },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  }

  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return Response.json(hit.body, { headers: { "Cache-Control": "private, max-age=300" } });
  }

  let body: GeoBody = { found: false, source: "ip" };
  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,city,regionName,country,lat,lon`,
    );
    if (res.ok) {
      const d = (await res.json()) as Record<string, unknown>;
      if (d.status === "success" && Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lon))) {
        const lat = Number(d.lat);
        const lng = Number(d.lon);
        body = {
          found: true,
          city: String(d.city ?? ""),
          region: String(d.regionName ?? ""),
          country: String(d.country ?? ""),
          lat: Math.round(lat * 10) / 10,
          lng: Math.round(lng * 10) / 10,
          nearVegas: milesBetween(lat, lng, STRIP.lat, STRIP.lng) < 40,
          source: "ip-api",
        };
      }
    }
  } catch {
    /* fall through to the fallback provider */
  }
  if (!body.found) {
    try {
      const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
      if (res.ok) {
        const d = (await res.json()) as Record<string, unknown>;
        const lat = Number(d.latitude);
        const lng = Number(d.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          body = {
            found: true,
            city: String(d.city ?? ""),
            region: String(d.region ?? ""),
            country: String(d.country_name ?? ""),
            lat: Math.round(lat * 10) / 10,
            lng: Math.round(lng * 10) / 10,
            nearVegas: milesBetween(lat, lng, STRIP.lat, STRIP.lng) < 40,
            source: "ipapi.co",
          };
        }
      }
    } catch {
      /* no hint available */
    }
  }

  cache.set(ip, { at: Date.now(), body });
  return Response.json(body, { headers: { "Cache-Control": "private, max-age=300" } });
};

export const GET = handler;
