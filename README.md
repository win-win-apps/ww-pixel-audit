# WW Pixel Audit

A Shopify app that audits a merchant's tracking pixels and tells them which ones will stop working when Shopify retires legacy checkout on August 26, 2026.

App 101 in the Win-Win Apps portfolio. Public name: WW Pixel Audit. Handle: ww-pixel-audit.

## What it does (V1, free tier)

The Auditor scans four sources and produces a Migration Readiness Report:
1. **Script tags** via the Shopify Admin GraphQL `scriptTags` query
2. **Theme code** in the published theme (layout/theme.liquid + common tracking snippet paths)
3. **Custom Pixels** registered via the Web Pixel API
4. **Sales channels** installed (Google, Facebook, TikTok, Pinterest)

Each detected tracker is classified `safe` / `broken_aug_26` / `unknown`, with a plain-language reason and a recommended fix.

V1 is admin-only, no theme app extension required.

## Future modules (not in V1)

- **Pro $29/mo:** Migration Wizard — installs the right Custom Pixel for each broken tracker
- **Agency $79/mo:** Validator — daily reconciliation between ad-platform reported conversions and Shopify orders, multi-store dashboard

## First-time setup

1. **Register the app on Partners** (one-time, requires a real terminal):
   ```bash
   cd "/Users/omarshahban/Documents/CLAUDE/Operation Spray and Pray/Operation Spray and Pray/App 101 - Checkout Tracking Auditor/ww-pixel-audit"
   shopify app dev --reset
   ```
   Pick the Win-Win Apps Partner org, "Create a new app", accept the name "WW Pixel Audit". When the tunnel URL prints, ctrl+c. This writes the real `client_id` into `shopify.app.toml`.

2. **Install dependencies and migrate the local DB:**
   ```bash
   npm install
   npx prisma db push
   ```

3. **Run the dev server:**
   ```bash
   shopify app dev
   ```
   Open the install URL, install on `win-win-ccae-dev.myshopify.com`, and run a scan from the dashboard.

## Scopes (defined in shopify.app.toml)

| Scope | Why |
|-------|-----|
| `read_themes` | Scan theme files for hardcoded tracking snippets |
| `read_script_tags`, `write_script_tags` | Read current state, future Module 2 install of Custom Pixels |
| `read_checkouts` | Detect legacy Additional Scripts content |
| `read_orders` | Revenue baseline for the upcoming "estimated revenue at risk" feature |
| `read_analytics` | Future Module 3 Validator polls daily attribution |

## Project layout

```
ww-pixel-audit/
├── app/
│   ├── routes/
│   │   ├── app._index.tsx       ← main scan + report page
│   │   ├── app.history.tsx      ← past scan list
│   │   ├── app.methodology.tsx  ← how the scan works
│   │   ├── app.settings.tsx     ← alert email + plan info
│   │   └── ...auth/webhooks
│   ├── services/
│   │   ├── scanner.server.ts        ← the audit logic
│   │   ├── shop-config.server.ts    ← per-shop settings
│   │   └── embedded-redirect.server.ts  ← preserves shop/host on redirects
│   ├── db.server.ts
│   └── shopify.server.ts
├── prisma/
│   └── schema.prisma            ← Session + ShopConfig + ScanRun + DetectedTracker
└── shopify.app.toml             ← client_id intentionally blank, see HANDOFF.md
```

## Switching SQLite ↔ Postgres

Per the Win-Win project memory: use SQLite for local dev on Omar's Mac. Before pushing to GitHub for Shane's fly.io deploy, swap the Prisma datasource:

```diff
 datasource db {
-  provider = "sqlite"
-  url      = "file:dev.sqlite"
+  provider = "postgresql"
+  url      = env("DATABASE_URL")
 }
```

Then run `npx prisma migrate dev --name init`, commit, push.
