// WW Pixel Audit core scanner.
//
// Inputs: an authenticated Shopify Admin GraphQL/REST client.
// Outputs: an array of "DetectedTracker" rows that we persist to the ScanRun.
//
// The scan inspects four sources per the V1 spec in HANDOFF.md:
//   1. Script tags via Admin GraphQL (legacy, will not run inside the new checkout)
//   2. Online Store theme code for hardcoded gtag/fbq/_klOnsite/ttq snippets
//   3. Web Pixels (Customer Events) — these are the safe path post-Aug-26
//   4. Sales channels installed (Google, Facebook, TikTok, Pinterest)
//
// Classification rules (deliberately conservative):
//   - script tag pointing at known pixel CDN  -> broken_aug_26 (legacy injection wont work in extensible checkout)
//   - hardcoded snippet in theme               -> broken_aug_26 (won't fire in checkout/thank-you/order-status)
//   - Web Pixel registered for the platform    -> safe
//   - Sales channel app installed for platform -> safe (channel app handles checkout pixel natively)
//   - anything we cant classify                -> unknown (with a hint on how to investigate)

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { TrackerStatus, TrackerSource } from "../lib/tracker-labels";

export type { TrackerStatus, TrackerSource };

export interface DetectedTrackerRow {
  platform: string;
  detectedId?: string | null;
  source: TrackerSource;
  sourceDetail?: string | null;
  status: TrackerStatus;
  reason: string;
  recommendation?: string | null;
}

interface ScanResult {
  trackers: DetectedTrackerRow[];
  totalFound: number;
  brokenCount: number;
  unknownCount: number;
  safeCount: number;
}

// platform fingerprints for theme code grep
const THEME_FINGERPRINTS: Array<{ platform: string; pattern: RegExp; idPattern?: RegExp }> = [
  { platform: "Meta Pixel",     pattern: /fbq\s*\(\s*['"]init['"]/,           idPattern: /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{6,})['"]/ },
  { platform: "Meta Pixel",     pattern: /facebook\.com\/tr\?id=\d+/,         idPattern: /facebook\.com\/tr\?id=(\d{6,})/ },
  { platform: "Google Analytics 4", pattern: /gtag\s*\(\s*['"]config['"]\s*,\s*['"]G-/, idPattern: /gtag\s*\(\s*['"]config['"]\s*,\s*['"](G-[A-Z0-9]+)['"]/ },
  { platform: "Google Ads",     pattern: /gtag\s*\(\s*['"]config['"]\s*,\s*['"]AW-/, idPattern: /gtag\s*\(\s*['"]config['"]\s*,\s*['"](AW-[A-Z0-9]+)['"]/ },
  { platform: "Google Tag Manager", pattern: /googletagmanager\.com\/gtm\.js\?id=GTM-/, idPattern: /googletagmanager\.com\/gtm\.js\?id=(GTM-[A-Z0-9]+)/ },
  { platform: "TikTok Pixel",   pattern: /ttq\.(load|page)/,                  idPattern: /ttq\.load\s*\(\s*['"]([A-Z0-9]+)['"]/ },
  { platform: "Klaviyo Onsite", pattern: /_learnq|klaviyo\.js\?company_id|window\.klaviyo/i, idPattern: /klaviyo\.js\?company_id=([A-Za-z0-9]+)/ },
  { platform: "Pinterest Tag",  pattern: /pintrk\s*\(\s*['"]load['"]/,        idPattern: /pintrk\s*\(\s*['"]load['"]\s*,\s*['"](\d{6,})['"]/ },
  { platform: "Snap Pixel",     pattern: /snaptr\s*\(\s*['"]init['"]/,        idPattern: /snaptr\s*\(\s*['"]init['"]\s*,\s*['"]([a-f0-9-]+)['"]/ },
  { platform: "Bing UET",       pattern: /uetq|bat\.bing\.com\/bat\.js/,      idPattern: /window\.uetq.*['"]([0-9]+)['"]/ },
  { platform: "Reddit Pixel",   pattern: /rdt\s*\(\s*['"]init['"]/,           idPattern: /rdt\s*\(\s*['"]init['"]\s*,\s*['"]([a-z0-9_]+)['"]/i },
];

// SCRIPT_TAG_FINGERPRINTS: known pixel hosts that suggest a platform
const SCRIPT_TAG_FINGERPRINTS: Array<{ platform: string; hostMatch: RegExp }> = [
  { platform: "Meta Pixel",         hostMatch: /connect\.facebook\.net|facebook\.com\/tr/ },
  { platform: "Google Analytics 4", hostMatch: /google-analytics\.com|googletagmanager\.com\/gtag/ },
  { platform: "Google Tag Manager", hostMatch: /googletagmanager\.com\/gtm/ },
  { platform: "TikTok Pixel",       hostMatch: /analytics\.tiktok\.com/ },
  { platform: "Klaviyo Onsite",     hostMatch: /static-tracking\.klaviyo\.com|klaviyo\.com\/onsite/ },
  { platform: "Pinterest Tag",      hostMatch: /s\.pinimg\.com\/ct\.js/ },
  { platform: "Snap Pixel",         hostMatch: /sc-static\.net\/scevent/ },
  { platform: "Bing UET",           hostMatch: /bat\.bing\.com\/bat\.js/ },
  { platform: "Reddit Pixel",       hostMatch: /redditstatic\.com.*conversion/ },
];

// theme files to scan (most stores keep tracking in these)
const THEME_FILES_TO_CHECK = [
  "layout/theme.liquid",
  "snippets/google-tag-manager.liquid",
  "snippets/google-analytics.liquid",
  "snippets/facebook-pixel.liquid",
  "snippets/tracking.liquid",
  "snippets/analytics.liquid",
  "snippets/head-tracking.liquid",
  "snippets/header-tracking.liquid",
];

// known sales channels we treat as "safe"
const SAFE_SALES_CHANNELS: Record<string, string> = {
  "google":   "Google Ads",
  "facebook": "Meta Pixel",
  "tiktok":   "TikTok Pixel",
  "pinterest": "Pinterest Tag",
};

export async function runScan(admin: AdminApiContext): Promise<ScanResult> {
  const trackers: DetectedTrackerRow[] = [];

  // 1. script tags
  trackers.push(...await scanScriptTags(admin));

  // 2. theme code
  trackers.push(...await scanThemeCode(admin));

  // 3. web pixels (Customer Events)
  trackers.push(...await scanWebPixels(admin));

  // 4. sales channels
  trackers.push(...await scanSalesChannels(admin));

  // dedupe: same platform + same source + same detail = one row
  const seen = new Set<string>();
  const deduped: DetectedTrackerRow[] = [];
  for (const t of trackers) {
    const key = `${t.platform}|${t.source}|${t.sourceDetail || ""}|${t.detectedId || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(t);
  }

  let safe = 0, broken = 0, unknown = 0;
  for (const t of deduped) {
    if (t.status === "safe") safe++;
    else if (t.status === "broken_aug_26") broken++;
    else unknown++;
  }

  return {
    trackers: deduped,
    totalFound: deduped.length,
    brokenCount: broken,
    unknownCount: unknown,
    safeCount: safe,
  };
}

async function scanScriptTags(admin: AdminApiContext): Promise<DetectedTrackerRow[]> {
  const results: DetectedTrackerRow[] = [];
  try {
    const res = await admin.graphql(
      `#graphql
        query ScanScriptTags($cursor: String) {
          scriptTags(first: 50, after: $cursor) {
            edges {
              cursor
              node { id src displayScope }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `,
      { variables: { cursor: null } },
    );
    const body = await res.json() as any;
    const edges = body?.data?.scriptTags?.edges ?? [];
    for (const edge of edges) {
      const src = String(edge?.node?.src || "");
      const id = String(edge?.node?.id || "");
      let matched = false;
      for (const fp of SCRIPT_TAG_FINGERPRINTS) {
        if (fp.hostMatch.test(src)) {
          matched = true;
          results.push({
            platform: fp.platform,
            detectedId: extractIdFromUrl(src),
            source: "script_tag",
            sourceDetail: src,
            status: "broken_aug_26",
            reason: `${fp.platform} loaded via script tag, which does not fire on the upgraded checkout, thank-you, or order-status pages.`,
            recommendation: `Move ${fp.platform} into a Custom Pixel (Shopify admin Customer Events) before August 26, 2026.`,
          });
          break;
        }
      }
      if (!matched) {
        results.push({
          platform: "Custom JS",
          detectedId: null,
          source: "script_tag",
          sourceDetail: src,
          status: "unknown",
          reason: "Custom script tag was not recognized as a known tracking pixel.",
          recommendation: "Open this script source in a new tab and check what it does. If it tracks conversions, move it to a Custom Pixel.",
        });
      }
    }
  } catch (err) {
    // not fatal; log via reason on a synthetic row so the merchant still sees something
    results.push({
      platform: "Script Tags",
      source: "script_tag",
      status: "unknown",
      reason: `Could not read script tags: ${(err as Error).message}`,
      recommendation: "Re-run the scan or contact support if this persists.",
    });
  }
  return results;
}

function extractIdFromUrl(src: string): string | null {
  // try to find a pixel id in the script src for the most common platforms
  const patterns: RegExp[] = [
    /facebook\.com\/tr\?id=(\d+)/,
    /id=(G-[A-Z0-9]+)/,
    /id=(AW-[A-Z0-9]+)/,
    /id=(GTM-[A-Z0-9]+)/,
    /tiktok\.com.*sdkid=([A-Z0-9]+)/,
    /klaviyo\.com.*company_id=([A-Za-z0-9]+)/,
  ];
  for (const p of patterns) {
    const m = src.match(p);
    if (m) return m[1];
  }
  return null;
}

async function scanThemeCode(admin: AdminApiContext): Promise<DetectedTrackerRow[]> {
  const results: DetectedTrackerRow[] = [];
  try {
    // get the published theme id
    const themesRes = await admin.graphql(
      `#graphql
        query MainTheme {
          themes(first: 1, roles: [MAIN]) {
            nodes { id name }
          }
        }
      `,
    );
    const themesBody = await themesRes.json() as any;
    const themeId: string | undefined = themesBody?.data?.themes?.nodes?.[0]?.id;
    if (!themeId) return results;

    // fetch the contents of each candidate theme file
    for (const filePath of THEME_FILES_TO_CHECK) {
      const fileRes = await admin.graphql(
        `#graphql
          query ThemeFile($id: ID!, $filename: String!) {
            theme(id: $id) {
              files(first: 1, filenames: [$filename]) {
                nodes {
                  filename
                  body { ... on OnlineStoreThemeFileBodyText { content } }
                }
              }
            }
          }
        `,
        { variables: { id: themeId, filename: filePath } },
      );
      const fileBody = await fileRes.json() as any;
      const node = fileBody?.data?.theme?.files?.nodes?.[0];
      const content: string = node?.body?.content || "";
      if (!content) continue;

      for (const fp of THEME_FINGERPRINTS) {
        if (fp.pattern.test(content)) {
          let detectedId: string | null = null;
          if (fp.idPattern) {
            const m = content.match(fp.idPattern);
            if (m) detectedId = m[1];
          }
          results.push({
            platform: fp.platform,
            detectedId,
            source: "theme_code",
            sourceDetail: filePath,
            status: "broken_aug_26",
            reason: `${fp.platform} snippet found in ${filePath}. Code in your theme cannot fire on the upgraded checkout, thank-you, or order-status pages.`,
            recommendation: `Move ${fp.platform} into a Custom Pixel via Shopify admin > Customer events. The official Shopify ${fp.platform.includes("Meta") ? "Facebook & Instagram" : fp.platform.includes("Google") ? "Google & YouTube" : ""} channel app handles this automatically.`.trim(),
          });
        }
      }
    }
  } catch (err) {
    results.push({
      platform: "Theme code",
      source: "theme_code",
      status: "unknown",
      reason: `Could not read theme files: ${(err as Error).message}`,
      recommendation: "This usually means the read_themes scope is missing. Reinstall the app to re-grant.",
    });
  }
  return results;
}

async function scanWebPixels(admin: AdminApiContext): Promise<DetectedTrackerRow[]> {
  const results: DetectedTrackerRow[] = [];
  try {
    const res = await admin.graphql(
      `#graphql
        query WebPixels {
          webPixel { id settings }
        }
      `,
    );
    const body = await res.json() as any;
    const node = body?.data?.webPixel;
    if (!node) return results;

    // The webPixel root returns the pixel registered by THIS app (us). For the merchant,
    // existing custom pixels live under Customer Events configuration. We treat any
    // registered pixel as evidence the merchant is partway through migration.
    results.push({
      platform: "Custom Pixel",
      detectedId: node.id || null,
      source: "custom_pixel",
      sourceDetail: typeof node.settings === "string" ? node.settings.slice(0, 120) : null,
      status: "safe",
      reason: "A Custom Pixel is registered. Custom Pixels run inside the upgraded checkout sandbox.",
      recommendation: "Verify the pixel is firing your conversion events. Use the Validator (Pro) for daily reconciliation.",
    });
  } catch {
    // No web pixel registered, that's fine
  }
  return results;
}

async function scanSalesChannels(admin: AdminApiContext): Promise<DetectedTrackerRow[]> {
  const results: DetectedTrackerRow[] = [];
  try {
    const res = await admin.graphql(
      `#graphql
        query AppInstalls {
          appInstallations(first: 100) {
            edges {
              node {
                id
                app { id title handle }
              }
            }
          }
        }
      `,
    );
    const body = await res.json() as any;
    const edges = body?.data?.appInstallations?.edges ?? [];
    for (const edge of edges) {
      const handle = String(edge?.node?.app?.handle || "").toLowerCase();
      const title  = String(edge?.node?.app?.title  || "");
      for (const [needle, platform] of Object.entries(SAFE_SALES_CHANNELS)) {
        if (handle.includes(needle) || title.toLowerCase().includes(needle)) {
          results.push({
            platform,
            detectedId: null,
            source: "sales_channel",
            sourceDetail: title,
            status: "safe",
            reason: `${title} sales channel is installed. The official channel handles ${platform} tracking inside the upgraded checkout.`,
            recommendation: `Confirm the channel is connected to the right ${platform} account.`,
          });
          break;
        }
      }
    }
  } catch {
    // do not surface this to the merchant, it's a "nice to have" signal
  }
  return results;
}

// re-export shared label helpers, but the actual implementation lives in lib/tracker-labels.ts
// so that client routes can import them without violating Remix's .server boundary.
export { statusToBadgeTone, statusToLabel, sourceToLabel } from "../lib/tracker-labels";
