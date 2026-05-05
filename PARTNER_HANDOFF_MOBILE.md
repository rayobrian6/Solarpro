# Partner Handoff — Site Survey App: Client Dropdown Fix

## What Was Done (Server Side)

Two API endpoints on the SolarPro backend have been updated and deployed to the dev server. The response format has been corrected to match what the mobile app expects.

### Endpoint 1: `GET /api/mobile/clients`
**Was returning:**
```json
{ "success": true, "data": { "clients": [...] } }
```
**Now returns:**
```json
{ "clients": [ { "id": "uuid", "name": "Client Name" }, ... ] }
```

### Endpoint 2: `GET /api/mobile/clients/:clientId/projects`
**Was returning:**
```json
{ "success": true, "data": { "projects": [...] } }
```
**Now returns:**
```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "Project Name",
      "clientId": "uuid",
      "clientName": "Client Name",
      "client_id": "uuid",
      "client_name": "Client Name",
      "address": "123 Main St"
    }
  ]
}
```
> Note: Both `clientId` (camelCase) and `client_id` (snake_case) are included for compatibility.

---

## Environment Variables for the Mobile App

Set these in your mobile app config / `.env` / secrets manager:

| Variable | Value |
|---|---|
| `SOLARPRO_API_URL` | `https://solarpro-dev.vercel.app` |
| `SOLARPRO_HANDOFF_SECRET` | `prod_handoff_secret_2026_rotate_me` |

---

## Authentication

All `/api/mobile/*` endpoints require **one** of the following:

- **Session cookie** — `solarpro-session` cookie set by the web app login
- **Bearer token** — `Authorization: Bearer <token>` header

The Bearer token is a short-lived JWT signed with `SOLARPRO_HANDOFF_SECRET`. To generate one, hit the handoff endpoint from the web app, or generate it directly:

```
JWT payload: { sub: <userId>, iat: <now>, exp: <now + TTL> }
Algorithm: HS256
Secret: prod_handoff_secret_2026_rotate_me
```

Default TTL: 3600 seconds (1 hour) if `HANDOFF_TOKEN_TTL_SECONDS` is not set.

---

## Base URL

All API calls from the mobile app should be prefixed with:

```
https://solarpro-dev.vercel.app
```

Example full URLs:
- `https://solarpro-dev.vercel.app/api/mobile/clients`
- `https://solarpro-dev.vercel.app/api/mobile/clients/{clientId}/projects`

---

## Git Commit Reference

Commit `ab54707` on branch `dev` — "Fix mobile API response format for site survey client dropdown"