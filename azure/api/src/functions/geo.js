/**
 * GET /api/geo — Azure Functions port of the SpaceFast
 * functions/api/geo.ts. Coarse, IP-based location hint: city-level
 * only, computed per request, never stored. Fallback for when GPS is
 * unavailable or declined; the app pairs it with a venue picker.
 */
const { app } = require("@azure/functions");

const STRIP = { lat: 36.115, lng: -115.17 };

function milesBetween(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function isPrivateIp(ip) {
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

const cache = new Map();
const TTL_MS = 10 * 60 * 1000;

app.http("geo", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "geo",
  handler: async (request) => {
    const h = request.headers;
    const fwd = (h.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const ip = h.get("cf-connecting-ip") || fwd || h.get("x-real-ip") || "";
    if (!ip || isPrivateIp(ip)) {
      return {
        jsonBody: { found: false, source: "none" },
        headers: { "Cache-Control": "private, max-age=60" },
      };
    }
    const hit = cache.get(ip);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return { jsonBody: hit.body, headers: { "Cache-Control": "private, max-age=300" } };
    }

    let body = { found: false, source: "ip" };
    try {
      const res = await fetch(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,city,regionName,country,lat,lon`,
      );
      if (res.ok) {
        const d = await res.json();
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
      /* fall through */
    }
    if (!body.found) {
      try {
        const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
        if (res.ok) {
          const d = await res.json();
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
    return { jsonBody: body, headers: { "Cache-Control": "private, max-age=300" } };
  },
});
