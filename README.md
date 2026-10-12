# FFK Tech: one repository, one Dokploy application

This folder contains copies of the legacy frontend and backend. The original sibling folders are preserved.

One Node gateway listens on public port 3000. `/api` and `/api/*` go to Express on internal port 5000; all other paths go to Next.js on internal port 3001. Only port 3000 needs a domain. The frontend uses relative `/api` URLs, so a separate API domain and NEXT_PUBLIC_API_URL configuration are unnecessary. Both services stop if either process fails. Database connection failure stops the backend.

## Upload to GitHub

Upload the contents of this folder as the root of a new repository. Include the Dockerfile, frontend, backend, scripts, package.json and both dependency lockfiles. Do not upload node_modules, .next, real .env files, logs, credentials or database backups. Ignore rules are provided. Example environment values contain no credentials.

## Dokploy

1. Add one Application and select the new GitHub repository and its branch.
2. Set Build Path to `/`.
3. Select Dockerfile build type. Dockerfile Path: `Dockerfile`; Docker Context Path: `.`. No custom install/build/start commands are needed.
4. Paste backend environment variables into the runtime Environment tab using rotated credentials. Use `.env.example` as the field checklist. Set PORT=3000, CLIENT_URL=https://oldapp-194-163-174-142.sslip.io and API_PUBLIC_URL to that same URL (without `/api`). Do not set PORT=5000: the launcher assigns internal ports itself.
5. For Google login, set GOOGLE_CLIENT_ID in the runtime environment and NEXT_PUBLIC_GOOGLE_CLIENT_ID in Docker Build Time Arguments to the same public client ID. Register the website origin with Google. Rebuild when the public client ID changes. No private secrets belong in build arguments.
6. Add domain oldapp-194-163-174-142.sslip.io, path `/`, container port 3000 and HTTPS. Deploy.
7. Confirm backend logs say MongoDB Connected and `/api/health` returns `{ "ok": true }`, then check the website, `/api/products`, `/admin/login`, customer login and order flow. Use Stripe test keys while testing payments.

The Dockerfile uses Node 22 and includes Chromium for the Puppeteer supplier scraper. It avoids the Nixpacks GitHub archive download that failed previously.

## Existing MongoDB and initial startup

Use an Atlas connection string targeting the confirmed existing database. The original URI omitted the database name; do not guess or switch databases without checking the existing collections. Allow the deployment server's outbound IP in Atlas. Test against a database copy first.

Startup admin synchronization and product-approval backfill are disabled by default in this combined copy. Existing admin accounts can log in with their stored password. Setting ADMIN_PASSWORD alone does not change them while this safeguard is off.

To deliberately create/synchronize the environment admin and run the original backfill, set COMBINED_ALLOW_STARTUP_WRITES=true and redeploy. This can change admin credentials, delete duplicate owner accounts and update product approval fields. Set it back to false afterward. This flag only controls startup maintenance; normal website/admin operations can still write data.

Monthly reminders and automatic supplier scraping default to disabled. Enable them only intentionally by setting MONTHLY_REMINDER=on and a positive SCRAPE_INTERVAL_HOURS. Scraping can change catalog data and send new-product emails. Docker scraper reports are ephemeral unless a persistent storage strategy is added.

Manual scrape endpoints `/api/scrape` and `/api/scrape-save` now require an admin token, preventing anonymous visitors from triggering catalog writes. The first product request respects SCRAPE_INTERVAL_HOURS=0 in this copy.

## Local verification and development

Requirements: Node 22 (or a compatible version), npm, and a MongoDB test database for live integration.

```powershell
npm ci --prefix frontend
$env:PUPPETEER_SKIP_DOWNLOAD = 'true'
npm ci --prefix backend
npm test
npm run build
npm run smoke
```

For local `npm start`, set environment variables in the PowerShell session first, including MONGO_URI, JWT_SECRET and CLIENT_URL=http://localhost:3000. The root .env.example is a reference; the launcher does not load a root .env file automatically. A local scraper needs Chromium/Puppeteer configured separately; Docker handles that setup.

```powershell
$env:MONGO_URI = 'YOUR_TEST_DATABASE_URI'
$env:JWT_SECRET = 'YOUR_LOCAL_RANDOM_SECRET'
$env:CLIENT_URL = 'http://localhost:3000'
$env:API_PUBLIC_URL = 'http://localhost:3000'
$env:PORT = '3000'
npm start
```

Open http://localhost:3000. Ports 3001 and 5000 must be free. The launcher supports production HTTP traffic; it is not a development hot-reload proxy.

`npm run smoke` verifies the production frontend through the gateway with a mock API. It does not connect to MongoDB or verify live catalog, login, payments, emails or browser interactions.
