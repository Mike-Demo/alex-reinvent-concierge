# Azure Static Web Apps mirror — Alex Rivers Concierge

Mirror of https://partnerships-concierge.space.fast/ for Azure Static Web Apps
(Free tier). The SpaceFast site is untouched and remains the primary demo.

## Layout

- `app/` — static site (copy of `../app/public/`) + `staticwebapp.config.json`
- `api/` — Azure Functions, Node.js v4 programming model (managed API for the SWA)
  - `api/src/functions/token.js` — POST /api/token (Napster WebRTC token mint)
  - `api/src/functions/feed.js` — GET /api/feed (Bluesky + AWS News aggregation)
  - `api/host.json`, `api/package.json` (`main: src/functions/*.js`)

The browser calls the APIs with relative paths (`api/token`, `api/feed`), so no
client changes were needed.

## App setting required

`NAPSTER_API_KEY` must be set on the Static Web App (Portal → the SWA resource →
Configuration → Application settings, or
`az staticwebapp appsettings set --name <swa> --resource-group rg-alex-concierge --setting-names NAPSTER_API_KEY=<key>`).
Without it, /api/token returns HTTP 500 `{"error":"NAPSTER_API_KEY is not configured on the server"}`
— same as the SpaceFast behavior. The key value lives in the Secure Vault
(connector custom.napster) and is not readable back programmatically.

## Deploy (once `az login` is done on subscription "Azure subscription 1")

```bash
az group create --name rg-alex-concierge --location eastus2
az staticwebapp create --name alex-reinvent-concierge --resource-group rg-alex-concierge \
  --location eastus2 --sku Free
# deploy with the SWA CLI (npm i -g @azure/static-web-apps-cli) from this folder:
swa deploy ./app --api-location ./api --deployment-token <token from `az staticwebapp secrets list`>
az staticwebapp appsettings set --name alex-reinvent-concierge --resource-group rg-alex-concierge \
  --setting-names NAPSTER_API_KEY=<key>
```

Free tier only — do not switch the SKU.
