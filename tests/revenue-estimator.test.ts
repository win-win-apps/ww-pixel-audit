// Unit tests for the revenue-at-risk estimator.
// Mocks the Admin GraphQL endpoint and asserts the estimator buckets revenue
// to the right channel and labels broken channels as at risk.

import { describe, it, expect } from "vitest";
import { estimateRevenueAtRisk } from "../app/services/revenue-estimator.server";
import type { DetectedTrackerRow } from "../app/services/scanner.server";

function makeOrdersAdmin(orders: Array<{ source: string; amount: number; cur?: string }>) {
  return {
    graphql: async (_q: string, _opts?: any) => {
      const edges = orders.map((o, i) => ({
        cursor: String(i),
        node: {
          id: `gid://shopify/Order/${i}`,
          sourceName: o.source,
          currentTotalPriceSet: {
            shopMoney: { amount: String(o.amount), currencyCode: o.cur || "USD" },
          },
        },
      }));
      return {
        json: async () => ({
          data: { orders: { edges, pageInfo: { hasNextPage: false, endCursor: null } } },
        }),
        ok: true,
      } as any;
    },
  } as any;
}

describe("estimateRevenueAtRisk", () => {
  it("attributes facebook orders to broken Meta Pixel as at-risk", async () => {
    const admin = makeOrdersAdmin([
      { source: "facebook", amount: 100 },
      { source: "google", amount: 50 },
      { source: "direct", amount: 25 },
    ]);
    const trackers: DetectedTrackerRow[] = [
      { platform: "Meta Pixel", source: "script_tag", status: "broken_aug_26", reason: "x" },
    ];
    const r = await estimateRevenueAtRisk(admin, trackers);
    expect(r).not.toBeNull();
    expect(r!.weeklyRevenue).toBe(175);
    expect(r!.atRiskRevenue).toBe(100); // only facebook
    expect(r!.atRiskPct).toBe(57); // 100/175
  });

  it("returns 0% when no broken trackers exist", async () => {
    const admin = makeOrdersAdmin([
      { source: "facebook", amount: 100 },
      { source: "google", amount: 50 },
    ]);
    const trackers: DetectedTrackerRow[] = [
      { platform: "Meta Pixel", source: "custom_pixel", status: "safe", reason: "x" },
    ];
    const r = await estimateRevenueAtRisk(admin, trackers);
    expect(r!.atRiskRevenue).toBe(0);
    expect(r!.atRiskPct).toBe(0);
  });

  it("counts each source once even if multiple platforms map to it", async () => {
    const admin = makeOrdersAdmin([{ source: "google", amount: 200 }]);
    const trackers: DetectedTrackerRow[] = [
      { platform: "Google Ads",         source: "script_tag", status: "broken_aug_26", reason: "x" },
      { platform: "Google Tag Manager", source: "theme_code", status: "broken_aug_26", reason: "x" },
    ];
    const r = await estimateRevenueAtRisk(admin, trackers);
    expect(r!.atRiskRevenue).toBe(200); // not 400, sources dedupe
  });

  it("handles zero-revenue weeks gracefully", async () => {
    const admin = makeOrdersAdmin([]);
    const trackers: DetectedTrackerRow[] = [
      { platform: "Meta Pixel", source: "script_tag", status: "broken_aug_26", reason: "x" },
    ];
    const r = await estimateRevenueAtRisk(admin, trackers);
    expect(r!.weeklyRevenue).toBe(0);
    expect(r!.atRiskRevenue).toBe(0);
    expect(r!.atRiskPct).toBe(0);
  });
});
