# Deployment Guide

## Prerequisites

- A [Supabase](https://supabase.com) project with the schema from `supabase/migrations/` applied.
- A [Vercel](https://vercel.com) project linked to this repository.
- Node.js 20.x locally (for running `vercel` CLI if needed).

---

## 1. Apply database migrations

From the project root, run all pending migrations against your Supabase Postgres instance:

```
supabase db push
```

Or connect directly and execute each file in `supabase/migrations/` in order.

The Supabase dashboard URL for your project is found at:
**Project → Settings → General → Reference ID** → `https://supabase.com/dashboard/project/<ref>`

---

## 2. Environment variables

Set the following environment variables in the **Vercel dashboard** under  
**Project → Settings → Environment Variables**.  
All variables apply to **Production**, **Preview**, and **Development** unless noted.

| Variable | Where to find the value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API → `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API → `service_role` key (**secret**) |
| `SUPABASE_DB_URL` | Supabase dashboard → Project Settings → Database → Connection string (URI, Transaction mode, port 6543) |
| `CRON_SECRET` | Generate locally — see section 3 below |

> `vercel.json` references these as `@vercel-secret-name` entries. If you prefer the Vercel secrets system (`vercel secrets add`), name the secrets exactly as listed in `vercel.json`.  
> The dashboard-based approach (above) is simpler and the recommended default.

---

## 3. Generating CRON_SECRET

`CRON_SECRET` authenticates Vercel's cron caller against `/api/cron/tick`.  
Generate a random 32-byte hex token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set the output as the `CRON_SECRET` environment variable in the Vercel dashboard **and** record it privately — you will need it if you ever invoke the cron endpoint manually.

---

## 4. Deploy

Push the `master` branch (or open a PR). Vercel picks it up automatically.  
For a manual deploy:

```bash
vercel --prod
```

---

## 5. Cron schedule

`vercel.json` registers one cron job:

```
POST /api/cron/tick   schedule: "0 6 * * *"   (daily at 06:00 UTC)
```

Vercel calls the endpoint with an `Authorization: Bearer <CRON_SECRET>` header.  
The handler at `app/api/cron/tick/route.ts` validates the header before executing.

You can monitor cron executions in the Vercel dashboard under  
**Project → Deployments → Functions → Cron Jobs**.

To trigger a manual run during local development:

```bash
curl -X POST http://localhost:3000/api/cron/tick \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## 6. OAuth / GSC sync — not yet configured

**OAuth GSC is not yet implemented.** The sync step inside the cron tick is a no-op until the OAuth wave (wave-oauth) is complete.

Do not set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or any GSC-related variables yet — they are out of scope for the current release. The application runs fully without them; the sync simply skips.

---

## 7. Smoke test after deploy

See `e2e/smoke.spec.ts`. Before running:

1. Pre-load a test project with detection data:
   ```bash
   npx tsx --conditions react-server scripts/try-detection.ts
   ```
2. Set `PLAYWRIGHT_PROJECT_ID`, `PLAYWRIGHT_EMAIL`, `PLAYWRIGHT_PASSWORD` env vars.
3. Run:
   ```bash
   PLAYWRIGHT_BASE_URL=https://<your-vercel-url> npx playwright test
   ```
