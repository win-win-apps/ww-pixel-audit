// Estimates "revenue at risk" for the WW Pixel Audit report.
//
// Logic:
//   1. Fetch orders from the last 7 days via Admin GraphQL (uses read_orders scope).
//   2. Group by source_name (Shopify's UTM-derived order source: "google", "facebook",
//      "tiktok", "klaviyo", "web", "direct", etc).
//   3. For each detected broken tracker, attribute the matching source bucket as
//      "at risk" — when the pixel breaks, that channel's attribution disappears.
//   4. Sum the at-risk revenue and compute the % of weekly revenue.
//
// This is a directional estimate, not an accounting figure. We label it as such
// in the UI ("estimate"). The merchant's actual loss is "wasted ad spend on a
// channel that no longer reports conversions correctly", which is harder to
// quantify but always larger than zero when broken_aug_26 trackers exist.

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { DetectedTrackerRow } from "./scanner.server";

// platform name -> list of source_name substrings that should be attributed to it.
// shopify's source_name field is lowercase, comes from UTM source / channel.
const PLATFORM_TO_SOURCES: Record<string, string[]> = {
  "Meta Pixel":         ["facebook", "fb", "instagram", "ig", "meta"],
  "Google Ads":         ["google", "googleads", "adwords"],
  "Google Analytics 4": ["google", "googleads"], // GA4 itself isn't a source, but its breaking implies google channel reports lose accuracy
  "Google Tag Manager": ["google"],
  "TikTok Pixel":       ["tiktok"],
  "Klaviyo Onsite":     ["klaviyo", "email"],
  "Pinterest Tag":      ["pinterest"],
  "Snap Pixel":         ["snap", "snapchat"],
  "Bing UET":           ["bing", "microsoft"],
  "Reddit Pixel":       ["reddit"],
};

export interface RevenueEstimate {
  weeklyRevenue: number;       // last 7 days total
  atRiskRevenue: number;       // attributed to broken channels
  atRiskPct: number;           // 0..100
  currency: string;            // shop currency
  bySource: Record<string, number>; // source_name -> revenue
}

export async function estimateRevenueAtRisk(
  admin: AdminApiContext,
  detectedTrackers: DetectedTrackerRow[],
): Promise<RevenueEstimate | null> {
  try {
    // Build the date range: last 7 days
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const sinceIso = since.toISOString();

    // Fetch orders since `sinceIso`, ask for source_name and total price
    // Use orders query with `created_at:>=...` filter syntax
    const sourceCounts: Record<string, number> = {};
    let weeklyRevenue = 0;
    let currency = "USD";

    let cursor: string | null = null;
    let pages = 0;

    while (true) {
      const res = await admin.graphql(
        `#graphql
          query OrdersForRevenueEstimate($cursor: String, $q: String!) {
            orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT, reverse: true) {
              edges {
                cursor
                node {
                  id
                  sourceName
                  currentTotalPriceSet { shopMoney { amount currencyCode } }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        `,
        { variables: { cursor, q: `created_at:>=${sinceIso}` } },
      );
      const body = await res.json() as any;
      const edges = body?.data?.orders?.edges ?? [];

      for (const edge of edges) {
        const src = String(edge?.node?.sourceName || "").toLowerCase().trim() || "direct";
        const amountStr = edge?.node?.currentTotalPriceSet?.shopMoney?.amount;
        const amount = typeof amountStr === "string" ? parseFloat(amountStr) : Number(amountStr || 0);
        if (!Number.isFinite(amount)) continue;
        weeklyRevenue += amount;
        sourceCounts[src] = (sourceCounts[src] || 0) + amount;
        const cur = edge?.node?.currentTotalPriceSet?.shopMoney?.currencyCode;
        if (cur) currency = cur;
      }

      const pageInfo = body?.data?.orders?.pageInfo;
      if (!pageInfo?.hasNextPage) break;
      cursor = pageInfo.endCursor;
      pages++;
      if (pages > 10) break; // safety cap, ~1000 orders is plenty for an estimate
    }

    // Map detected broken trackers to sources; sum revenue for any source linked
    // to at least one broken platform.
    const brokenPlatforms = new Set(
      detectedTrackers.filter(t => t.status === "broken_aug_26").map(t => t.platform),
    );
    const atRiskSources = new Set<string>();
    for (const platform of brokenPlatforms) {
      const sources = PLATFORM_TO_SOURCES[platform] || [];
      for (const s of sources) atRiskSources.add(s);
    }

    let atRiskRevenue = 0;
    for (const [src, rev] of Object.entries(sourceCounts)) {
      // attribute if any at-risk source substring matches the order's source_name
      for (const matchPart of atRiskSources) {
        if (src.includes(matchPart)) {
          atRiskRevenue += rev;
          break;
        }
      }
    }

    const atRiskPct = weeklyRevenue > 0
      ? Math.round((atRiskRevenue / weeklyRevenue) * 100)
      : 0;

    return {
      weeklyRevenue: Math.round(weeklyRevenue * 100) / 100,
      atRiskRevenue: Math.round(atRiskRevenue * 100) / 100,
      atRiskPct,
      currency,
      bySource: sourceCounts,
    };
  } catch (err) {
    console.warn("estimateRevenueAtRisk failed (non-fatal):", (err as Error).message);
    return null;
  }
}
