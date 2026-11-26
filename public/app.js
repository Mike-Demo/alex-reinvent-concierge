/* Alex Rivers — re:Invent Concierge app */
"use strict";

// ---------------------------------------------------------------- data ----
const DAYS = [
  { date: "2026-11-29", label: "Sun 29", name: "Sunday, Nov 29" },
  { date: "2026-11-30", label: "Mon 30", name: "Monday, Nov 30" },
  { date: "2026-12-01", label: "Tue 1", name: "Tuesday, Dec 1" },
  { date: "2026-12-02", label: "Wed 2", name: "Wednesday, Dec 2" },
  { date: "2026-12-03", label: "Thu 3", name: "Thursday, Dec 3" },
  { date: "2026-12-04", label: "Fri 4", name: "Friday, Dec 4" },
];
const TYPES = [
  ["", "All"], ["keynote", "Keynotes"], ["session", "Sessions"], ["expo", "Expo"],
  ["side-event", "Side events"], ["social", "Socials"], ["meetup", "Meetup"], ["logistics", "Logistics"],
];
const TYPE_ICON = {
  keynote: "fa-solid fa-microphone", session: "fa-solid fa-chalkboard-user",
  expo: "fa-solid fa-store", "side-event": "fa-solid fa-champagne-glasses",
  social: "fa-solid fa-people-group", meetup: "fa-solid fa-mug-hot",
  logistics: "fa-solid fa-id-card",
};
// Coordinates geocoded from the venues' published street addresses.
const VENUES = [
  { name: "The Venetian (Expo, keynotes, badge pickup)", lat: 36.12215, lng: -115.16981 },
  { name: "Caesars Forum", lat: 36.11837, lng: -115.16628 },
  { name: "Caesars Palace", lat: 36.11601, lng: -115.17474 },
  { name: "MGM Grand", lat: 36.10228, lng: -115.16579 },
  { name: "Wynn Las Vegas (Urth Caffé coffee meetup is in Wynn Plaza Shops)", lat: 36.12655, lng: -115.16455 },
  { name: "Encore at Wynn", lat: 36.12971, lng: -115.16441 },
  { name: "Allegiant Stadium (re:Play, Thursday night)", lat: 36.09086, lng: -115.18313 },
];

const state = {
  events: [],
  day: defaultDay(),
  nearDay: defaultDay(),
  type: "",
  userLoc: null, // {lat, lng, accuracy}
  selected: null,
};

function defaultDay() {
  const now = new Date();
  const key = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const hit = DAYS.find((d) => d.date === key);
  if (hit) return hit.date;
  return key < "2026-11-29" ? "2026-11-30" : "2026-11-30";
}

function distanceMiles(aLat, aLng, bLat, bLng) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ap}`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function googleDirUrl(dest) {
  const o = state.userLoc ? `origin=${state.userLoc.lat},${state.userLoc.lng}&` : "";
  return `https://www.google.com/maps/dir/?api=1&${o}destination=${dest.lat},${dest.lng}&travelmode=walking`;
}
function mapquestUrl(dest) {
  return `https://www.mapquest.com/latlng/${dest.lat},${dest.lng}`;
}

// ------------------------------------------------------------- views ------
const isDesktop = () => window.matchMedia("(min-width: 1024px)").matches;
function switchView(name) {
  document.querySelectorAll(".view-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => {
    const on = v.dataset.viewPanel === name || (isDesktop() && v.dataset.viewPanel === "talk");
    v.classList.toggle("is-active", on);
  });
  if (name === "map") { initMap(); setTimeout(() => map && map.invalidateSize(), 60); }
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll(".view-btn").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));

// ------------------------------------------------------------ agenda ------
function dayTabs(el, current, onPick) {
  el.innerHTML = "";
  for (const d of DAYS) {
    const b = document.createElement("button");
    b.className = "day-tab" + (d.date === current ? " is-active" : "");
    b.textContent = d.label;
    b.addEventListener("click", () => onPick(d.date));
    el.appendChild(b);
  }
}
function typeChips(el, current, onPick) {
  el.innerHTML = "";
  for (const [val, label] of TYPES) {
    const b = document.createElement("button");
    b.className = "type-chip" + (val === current ? " is-active" : "");
    b.textContent = label;
    b.addEventListener("click", () => onPick(val));
    el.appendChild(b);
  }
}
function eventCard(e, showDistance) {
  const card = document.createElement("wa-card");
  card.className = "event-item";
  const time = e.start ? `${fmtTime(e.start)}${e.end ? " – " + fmtTime(e.end) : ""}` : "Time not listed";
  const dist = showDistance && state.userLoc && e.lat != null
    ? `<span class="ev-dist">${distanceMiles(state.userLoc.lat, state.userLoc.lng, e.lat, e.lng).toFixed(1)} mi</span>` : "";
  card.innerHTML = `
    <div class="ev-head"><h4><i class="${TYPE_ICON[e.type] || "fa-solid fa-calendar"}"></i> ${esc(e.name)}</h4>${dist}</div>
    <p class="ev-meta">${esc(time)} · ${esc(e.venue)}${e.cost ? " · " + esc(e.cost) : ""}</p>
    <p class="ev-desc">${esc(e.description)}</p>
    <div class="ev-actions"></div>`;
  const actions = card.querySelector(".ev-actions");
  if (e.lat != null) {
    const walk = document.createElement("wa-button");
    walk.size = "small"; walk.variant = "brand";
    walk.innerHTML = `<i class="fa-solid fa-person-walking" slot="start"></i>Walk here`;
    walk.addEventListener("click", () => { selectEvent(e); switchView("map"); walkTo(e); });
    actions.appendChild(walk);
    const g = document.createElement("a");
    g.className = "ext-btn"; g.target = "_blank"; g.rel = "noopener"; g.href = googleDirUrl(e);
    g.innerHTML = `<i class="fa-brands fa-google"></i> Google`;
    actions.appendChild(g);
    const mq = document.createElement("a");
    mq.className = "ext-btn"; mq.target = "_blank"; mq.rel = "noopener"; mq.href = mapquestUrl(e);
    mq.innerHTML = `<i class="fa-solid fa-map-pin"></i> MapQuest`;
    actions.appendChild(mq);
  }
  if (e.url) {
    const r = document.createElement("a");
    r.className = "ext-btn"; r.target = "_blank"; r.rel = "noopener"; r.href = e.url;
    r.innerHTML = `<i class="fa-solid fa-ticket"></i> RSVP / info`;
    actions.appendChild(r);
  }
  return card;
}
function renderAgenda() {
  dayTabs(document.getElementById("day-tabs"), state.day, (d) => { state.day = d; renderAgenda(); refreshMap(); });
  typeChips(document.getElementById("type-chips"), state.type, (t) => { state.type = t; renderAgenda(); });
  const list = document.getElementById("agenda-list");
  list.innerHTML = "";
  const items = state.events
    .filter((e) => e.date === state.day && (!state.type || e.type === state.type))
    .sort((a, b) => (a.start || "99") < (b.start || "99") ? -1 : 1);
  if (!items.length) list.innerHTML = `<p class="muted">Nothing scheduled in this view.</p>`;
  for (const e of items) list.appendChild(eventCard(e, true));
}
function renderNear() {
  dayTabs(document.getElementById("near-day-tabs"), state.nearDay, (d) => { state.nearDay = d; renderNear(); });
  const list = document.getElementById("near-list");
  const note = document.getElementById("near-noloc");
  list.innerHTML = "";
  if (!state.userLoc) { note.hidden = false; return; }
  note.hidden = true;
  const items = state.events
    .filter((e) => e.date === state.nearDay && e.lat != null)
    .map((e) => ({ e, d: distanceMiles(state.userLoc.lat, state.userLoc.lng, e.lat, e.lng) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 20);
  if (!items.length) list.innerHTML = `<p class="muted">No mappable events that day.</p>`;
  for (const { e } of items) list.appendChild(eventCard(e, true));
}

// --------------------------------------------------------------- map ------
let map = null, markers = null, userMarker = null, routeLine = null;
function initMap() {
  if (map) { refreshMap(); return; }
  map = L.map("map").setView([36.1145, -115.169], 14);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);
  markers = L.layerGroup().addTo(map);
  const daySel = document.getElementById("map-day");
  daySel.innerHTML = DAYS.map((d) => `<option value="${d.date}">${d.name}</option>`).join("");
  daySel.value = state.day;
  daySel.addEventListener("change", () => { state.day = daySel.value; refreshMap(); renderAgenda(); });
  document.getElementById("map-type").addEventListener("change", (ev) => { state.type = ev.target.value; refreshMap(); });
  document.getElementById("map-near-me").addEventListener("click", () => {
    if (state.userLoc) map.flyTo([state.userLoc.lat, state.userLoc.lng], 16);
    else shareLocation();
  });
  refreshMap();
  if (state.userLoc) markUser();
}
function refreshMap() {
  if (!map || !markers) return;
  document.getElementById("map-day").value = state.day;
  document.getElementById("map-type").value = state.type;
  markers.clearLayers();
  for (const e of state.events) {
    if (e.date !== state.day || e.lat == null) continue;
    if (state.type && e.type !== state.type) continue;
    const m = L.marker([e.lat, e.lng]).addTo(markers);
    m.bindPopup(`<b>${esc(e.name)}</b>${e.start ? fmtTime(e.start) : ""} · ${esc(e.venue)}`);
    m.on("click", () => selectEvent(e));
  }
}
function markUser() {
  if (!map || !state.userLoc) return;
  if (userMarker) userMarker.remove();
  userMarker = L.circleMarker([state.userLoc.lat, state.userLoc.lng], {
    radius: 9, color: "#d8f24b", weight: 3, fillColor: "#d8f24b", fillOpacity: 0.85,
  }).addTo(map).bindPopup("<b>You are here</b>");
}
function selectEvent(e) {
  state.selected = e;
  const card = document.getElementById("event-card");
  card.hidden = false;
  document.getElementById("event-card-title").textContent = e.name;
  const dayName = (DAYS.find((d) => d.date === e.date) || {}).name || e.date;
  const time = e.start ? `${fmtTime(e.start)}${e.end ? " – " + fmtTime(e.end) : ""}` : "Time not listed";
  document.getElementById("event-card-meta").textContent = `${dayName} · ${time} · ${e.venue}${e.cost ? " · " + e.cost : ""}`;
  document.getElementById("event-card-desc").textContent = e.description || "";
  document.getElementById("event-google").href = googleDirUrl(e);
  document.getElementById("event-mapquest").href = mapquestUrl(e);
  const rsvp = document.getElementById("event-rsvp");
  if (e.url) { rsvp.hidden = false; rsvp.href = e.url; } else rsvp.hidden = true;
  document.getElementById("event-walk").onclick = () => walkTo(e);
  if (map && e.lat != null) map.flyTo([e.lat, e.lng], 16);
}
document.getElementById("event-close").addEventListener("click", () => { document.getElementById("event-card").hidden = true; });
document.getElementById("route-close").addEventListener("click", () => {
  document.getElementById("route-card").hidden = true;
  if (routeLine) { routeLine.remove(); routeLine = null; }
});

function osrmInstruction(step) {
  const m = step.maneuver || {};
  const name = step.name && step.name !== "-" ? step.name : "the path";
  const mod = m.modifier || "";
  switch (m.type) {
    case "depart": return `Head ${mod || "out"} on ${name}`;
    case "arrive": return `Arrive at your destination`;
    case "turn": return `Turn ${mod} onto ${name}`;
    case "new name": return `Continue onto ${name}`;
    case "merge": return `Merge onto ${name}`;
    case "fork": return `Take the ${mod} fork onto ${name}`;
    case "roundabout": case "rotary": return `At the roundabout, take exit ${m.exit || ""} onto ${name}`;
    case "end of road": return `At the end of the road, turn ${mod} onto ${name}`;
    default: return `Continue on ${name}`;
  }
}
async function walkTo(e) {
  if (e.lat == null) return;
  if (!state.userLoc) { shareLocation(); return; }
  initMap();
  const { lat, lng } = state.userLoc;
  const url = `https://router.project-osrm.org/route/v1/foot/${lng},${lat};${e.lng},${e.lat}?overview=full&geometries=geojson&steps=true`;
  const card = document.getElementById("route-card");
  card.hidden = false;
  document.getElementById("route-title").textContent = `Walking to ${e.name}`;
  document.getElementById("route-summary").textContent = "Routing…";
  document.getElementById("route-steps").innerHTML = "";
  document.getElementById("route-google").href = googleDirUrl(e);
  document.getElementById("route-mapquest").href = mapquestUrl(e);
  try {
    const res = await fetch(url);
    const data = await res.json();
    const route = data.routes && data.routes[0];
    if (!route) throw new Error("no route");
    if (routeLine) routeLine.remove();
    routeLine = L.geoJSON(route.geometry, { style: { color: "#d8f24b", weight: 5, opacity: 0.9 } }).addTo(map);
    map.flyToBounds(routeLine.getBounds().pad(0.12));
    const miles = (route.distance / 1609.34).toFixed(2);
    const mins = Math.max(1, Math.round(route.duration / 60));
    document.getElementById("route-summary").textContent = `${miles} mi · about ${mins} min on foot`;
    const steps = (route.legs[0].steps || []).filter((s) => s.distance > 1);
    document.getElementById("route-steps").innerHTML =
      steps.map((s) => `<li>${esc(osrmInstruction(s))} <span class="muted">(${(s.distance / 1609.34).toFixed(2)} mi)</span></li>`).join("");
  } catch {
    document.getElementById("route-summary").textContent =
      "In-app routing didn't answer — use the Google Maps or MapQuest buttons below for turn-by-turn directions.";
  }
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ------------------------------------------------------------- feeds ------
async function loadFeeds() {
  try {
    const res = await fetch("api/feed");
    const data = await res.json();
    const bs = document.getElementById("feed-bluesky");
    if (data.bluesky && data.bluesky.length) {
      bs.innerHTML = data.bluesky.map((p) => `
        <div class="feed-post">
          <div class="fp-head"><b>${esc(p.author)}</b> @${esc(p.handle)}</div>
          <p>${esc(p.text)}</p>
          <div class="fp-head"><a href="${esc(p.url)}" target="_blank" rel="noopener">View post</a></div>
        </div>`).join("");
    } else {
      bs.innerHTML = `<p class="muted">The live Bluesky feed didn't answer. <a href="https://bsky.app/search?q=%23AWSreInvent" target="_blank" rel="noopener">Open Bluesky search</a>.</p>`;
    }
    const aw = document.getElementById("feed-aws");
    if (data.awsNews && data.awsNews.length) {
      aw.innerHTML = data.awsNews.map((n) => `
        <div class="feed-post feed-news"><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>
        <div class="fp-head">${esc(n.published)}</div></div>`).join("");
    } else {
      aw.innerHTML = `<p class="muted">AWS News didn't answer. <a href="https://aws.amazon.com/blogs/aws/" target="_blank" rel="noopener">Open the AWS News Blog</a>.</p>`;
    }
  } catch {
    document.getElementById("feed-bluesky").innerHTML = `<p class="muted">Feeds are unavailable right now.</p>`;
  }
}

// ---------------------------------------------------------- location ------
let omniInstance = null;
let pendingLocationText = null;
function sendLocationContext(text) {
  if (omniInstance) {
    omniInstance.sendCommand({ type: "send_message", data: { role: "system", text, trigger_response: false } });
  } else {
    pendingLocationText = text;
  }
}
function shareLocation() {
  const status = document.getElementById("location-status");
  if (!("geolocation" in navigator)) {
    status.textContent = "This browser doesn't support location sharing. You can still tell Alex where you are.";
    return;
  }
  status.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      state.userLoc = { lat: latitude, lng: longitude, accuracy };
      const ranked = VENUES
        .map((v) => ({ ...v, miles: distanceMiles(latitude, longitude, v.lat, v.lng) }))
        .sort((a, b) => a.miles - b.miles);
      const nearest = ranked[0];
      const list = ranked.map((v) => `${v.name}: ${v.miles.toFixed(2)} mi`).join("; ");
      sendLocationContext(
        `Visitor location context: the visitor has shared their precise location ` +
        `(latitude ${latitude.toFixed(5)}, longitude ${longitude.toFixed(5)}, GPS accuracy about ${Math.round(accuracy)} meters). ` +
        `Nearest re:Invent campus venue: ${nearest.name}, about ${nearest.miles.toFixed(2)} miles away (straight-line). ` +
        `Straight-line distances to campus venues: ${list}. ` +
        `Use this when the visitor asks what is near them, how far a venue or event is, or for walking directions, ` +
        `and combine it with the walking times, routes, shuttle, and Monorail details in your knowledge base. ` +
        `Do not read the raw coordinates aloud unless the visitor asks.`
      );
      status.textContent = `Location shared — you're near ${nearest.name} (~${nearest.miles.toFixed(1)} mi). Alex now knows where you are.`;
      const chip = document.getElementById("loc-chip");
      chip.hidden = false;
      document.getElementById("loc-chip-text").textContent = `Near ${nearest.name.split(" (")[0]}`;
      markUser();
      renderAgenda();
      renderNear();
    },
    () => {
      status.textContent = "Location wasn't shared. No problem — just tell Alex which venue or hotel you're at.";
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}
document.getElementById("share-location").addEventListener("click", shareLocation);

// ------------------------------------------------------------ Napster -----
async function getToken() {
  const res = await fetch("api/token", { method: "POST" });
  if (!res.ok) throw new Error("Token request failed: " + res.status);
  const data = await res.json();
  return data.token;
}
const seenCalls = new Set();
function showError(message) {
  const box = document.getElementById("omniagent-error");
  box.textContent = message;
  box.style.display = "block";
}
function handleIntroRequest(args) {
  const list = document.getElementById("requests-list");
  const empty = document.getElementById("requests-empty");
  if (empty) empty.remove();
  const li = document.createElement("li");
  const parts = [args.name, args.company, args.looking_for, args.contact, args.preferred_day].filter(Boolean);
  li.textContent = parts.join(" — ");
  list.appendChild(li);
  return { ok: true, recorded: true, message: "Introduction request recorded. Demo will follow up personally." };
}
function findEvent(query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return null;
  const evs = state.events;
  let hit = evs.find((e) => e.name.toLowerCase() === q);
  if (hit) return hit;
  hit = evs.find((e) => e.name.toLowerCase().includes(q) || q.includes(e.name.toLowerCase()));
  if (hit) return hit;
  hit = evs.find((e) => e.venue.toLowerCase().includes(q));
  if (hit) return hit;
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  let best = null, bestScore = 0;
  for (const e of evs) {
    const hay = (e.name + " " + e.venue).toLowerCase();
    const score = words.filter((w) => hay.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return bestScore ? best : null;
}
function handleNavigateView(args) {
  const view = ["talk", "map", "agenda", "near", "social"].includes(args.view) ? args.view : "talk";
  switchView(view);
  if (view === "near" && !state.userLoc) {
    return { ok: true, view, message: "Near view opened, but the visitor has not shared their location yet. Remind them to tap the Share my location button so the list can sort by distance." };
  }
  return { ok: true, view, message: `The ${view} view is now on the visitor's screen.` };
}
function handleShowEvent(args) {
  const e = findEvent(args.event_name);
  if (!e) return { ok: false, error: "not_found", message: `No event matched "${args.event_name}". Offer the agenda view instead.` };
  const dayName = (DAYS.find((d) => d.date === e.date) || {}).name || e.date;
  const when = `${dayName}${e.start ? " at " + fmtTime(e.start) : ""}`;
  if (e.lat == null) {
    state.day = e.date; renderAgenda(); switchView("agenda");
    return { ok: true, event: e.name, venue: e.venue, when, message: `${e.name} has no fixed map location, so the agenda for ${dayName} is on screen instead.` };
  }
  state.day = e.date;
  switchView("map");
  refreshMap();
  selectEvent(e);
  return { ok: true, event: e.name, venue: e.venue, when, message: `${e.name} is now highlighted on the map.` };
}
async function handleWalkingDirections(args) {
  const e = findEvent(args.destination);
  if (!e) return { ok: false, error: "not_found", message: `No event or venue matched "${args.destination}".` };
  if (e.lat == null) return { ok: false, error: "no_location", message: `${e.name} has no fixed location to route to.` };
  if (!state.userLoc) {
    shareLocation();
    return { ok: false, error: "needs_location", message: "The visitor has not shared their location yet; the location prompt was just triggered. Ask them to allow location sharing, then ask for directions again." };
  }
  state.day = e.date;
  switchView("map");
  refreshMap();
  selectEvent(e);
  await walkTo(e);
  const summary = document.getElementById("route-summary").textContent;
  return { ok: true, destination: e.name, summary, message: `Walking directions to ${e.name} are on the map. ${summary}` };
}
function handleFilterAgenda(args) {
  if (DAYS.some((d) => d.date === args.day)) state.day = args.day;
  state.type = typeof args.type === "string" ? args.type : "";
  renderAgenda();
  switchView("agenda");
  const count = state.events.filter((e) => e.date === state.day && (!state.type || e.type === state.type)).length;
  const dayName = (DAYS.find((d) => d.date === state.day) || {}).name || state.day;
  return { ok: true, day: dayName, count, message: `The agenda on screen shows ${count} item(s) for ${dayName}${state.type ? " of type " + state.type : ""}.` };
}
async function handleData(msg) {
  const ev = msg.event ?? msg.type;
  if (ev === "function_call_timeout") { console.warn("tool timeout", msg.data); return; }
  if (ev !== "function_implicitly_called") return;
  const { call_id, name, arguments: args } = msg.data || {};
  if (!call_id || !name || seenCalls.has(call_id)) return;
  seenCalls.add(call_id);
  let result;
  if (name === "capture_intro_request") {
    result = handleIntroRequest(args || {});
  } else if (name === "navigate_view") {
    result = handleNavigateView(args || {});
  } else if (name === "show_event_on_map") {
    result = handleShowEvent(args || {});
  } else if (name === "start_walking_directions") {
    result = await handleWalkingDirections(args || {});
  } else if (name === "filter_agenda") {
    result = handleFilterAgenda(args || {});
  } else {
    result = { ok: false, error: "unknown_function" };
  }
  if (omniInstance) {
    omniInstance.sendCommand({ type: "send_function_output", data: { call_id, output: result, delay: false } });
  }
}
window.napsterCompanionApiSDK.init(getToken, {
  layout: { type: "inline", mountContainer: "#omniagent-mount" },
  style: { view: "rectangle", className: "omniagent-sdk-root" },
  onData: handleData,
  onAvatarReady: (isReady) => { if (isReady) console.log("[concierge] session live"); },
  onError: (error) => {
    console.error("[concierge]", error);
    showError("The concierge session hit a problem and closed. Reload the page to try again.");
  },
}).then((instance) => {
  omniInstance = instance;
  window.__omniagent = instance; // debugging only
  if (pendingLocationText) {
    omniInstance.sendCommand({ type: "send_message", data: { role: "system", text: pendingLocationText, trigger_response: false } });
    pendingLocationText = null;
  }
}).catch((error) => {
  console.error("[concierge] init failed", error);
  showError("The concierge could not start. Reload the page to try again.");
});

// --------------------------------------------------------------- boot -----
(async function boot() {
  try {
    const res = await fetch("events.json");
    state.events = await res.json();
  } catch {
    state.events = [];
  }
  renderAgenda();
  renderNear();
  loadFeeds();
})();
