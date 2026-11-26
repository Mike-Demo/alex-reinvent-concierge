# Alex Rivers — AWS re:Invent 2026 Concierge

A face-and-voice concierge for AWS re:Invent 2026, built on the
[Napster Companion API](https://developers.napster.com) for the Napster API
Ignite Hackathon (Microsoft Ignite 2026).

**Live demo:** https://partnerships-concierge.space.fast/

Alex is a custom cyberpunk persona (generated avatar, non-binary host) who
knows the whole re:Invent week and talks attendees through it in a live
WebRTC session: the official program (keynotes, sessions, Expo, sponsors),
39 verified side events, campus venues and maps, walking routes, shuttles,
and the Las Vegas Monorail. Visitors can share their precise location and
Alex answers with where they actually are. Alex is also the concierge for a
real event series — the Web Agencies Coffee Meetup at AWS re:Invent 2026
(Nov 30 – Dec 4, Urth Caffé, Wynn Plaza Shops, Las Vegas), hosted by Mike
"Demo" Demopoulos — and captures qualified partnership introduction
requests with a confirmation step before anything is recorded.

## How it works

- **Persona** — custom Napster companion "Alex Rivers" (generated avatar),
  created with `POST /public/companions`.
- **Agent** — created with `POST /public/agents`: Azure OpenAI Realtime,
  `alloy` voice, tuned turn detection, an 11-pair FAQ collection (the
  coffee meetup), a knowledge base, and one implicit function,
  `capture_intro_request`.
- **Knowledge base** — four researched guides (in `public/` as
  `guide-*.txt`, also served by the live site): the official agenda and
  sponsors, 39 verified side events, venues and transport, and maps,
  walking directions, and Monorail details. Every fact was verified
  against a source page; unverifiable details are marked "not listed"
  rather than guessed. Uploaded by public URL with
  `POST /public/knowledge-bases/{id}/files` and attached to the agent.
- **Location context** — the page's "Share my location" button uses the
  browser Geolocation API, computes straight-line distances to the seven
  campus landmarks client-side, and injects them into the session as a
  silent system message (`send_message`, `role: "system"`), so Alex can
  answer "what's near me?" grounded in the visitor's real position.
  Location is session-only and never stored.
- **Channel** — WebRTC. The channel config sets an `initialSpeech`
  greeting. Connection tokens are minted server-side
  (`POST /public/agents/{agentId}/connections` with
  `channelType: "webrtc"`) so the API key never reaches the browser.
- **Client** — Napster Web SDK v2 (standalone build) in `index.html`,
  using the canonical Napster panel structure and `omniagent-ui.css`.
  Implicit tool calls are handled in `onData` with `call_id` dedupe,
  answered with `send_function_output`, and rendered into the on-page
  requests list.

## Deployment (SpaceFast)

Live at https://partnerships-concierge.space.fast/ — a SpaceFast space
using the functions runtime:

- `public/` contents publish at the site root — the static page
  (`index.html`, `omniagent-ui.css`) and the four knowledge-base guides.
- `functions/api/token.ts` — `POST /api/token`, mints the WebRTC token
  server-side. The Napster API key is the space env var `NAPSTER_API_KEY`
  (secret, set in SpaceFast — never in the repo).
- `sf.jsonc` — space config: public access, functions runtime.

Publish (public contents go at the publish root, in a fresh folder):

```bash
OUT=$(mktemp -d)/sf-publish; mkdir -p "$OUT"
cp -a public/. "$OUT/"; cp -a functions sf.jsonc "$OUT/"
sf publish "$OUT" --space partnerships-concierge -y --wait
```

## Local development

`local-token-server/` holds the stock Napster prototype token server for
running the panel locally (copy `.env.example` to `.env`, add your key,
`npm start`, open the printed URL). The production path above is the
SpaceFast function instead.

## Files

- `public/index.html` — the demo page and Web SDK wiring
- `public/omniagent-ui.css` — canonical Napster panel stylesheet (unmodified)
- `public/guide-*.txt` — the four knowledge-base guides
- `omniagent-panel-reference.html` — the canonical panel markup this page follows
- `functions/api/token.ts` — the token endpoint
- `local-token-server/` — local prototype token server (development only)

## Note on demo data

Introduction requests in this demo are captured in the visitor's browser
only and shown on the page. No request data is transmitted or stored
elsewhere. Event facts were researched on November 25, 2026 from AWS's
official re:Invent pages and public event listings; times are Pacific.
