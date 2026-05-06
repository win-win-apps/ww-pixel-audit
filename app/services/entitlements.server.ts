// Reads the merchant's active app subscription and returns a normalized plan.
// Source of truth: Shopify (currentAppInstallation.activeSubscriptions).
// We mirror the result into ShopConfig.plan as a cache, so non-billing reads
// can be cheap.

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { hasPro, hasAgency, type Plan } from "../lib/plans";

export type { Plan };
export { hasPro, hasAgency };

export interface Entitlements {
  plan: Plan;
  subscriptionId: string | null;
  subscriptionName: string | null;
}

const PRO_NAMES = new Set(["pro", "ww pixel audit pro", "ww-pixel-audit-pro"]);
const AGENCY_NAMES = new Set(["agency", "ww pixel audit agency", "ww-pixel-audit-agency"]);

export async function readEntitlements(
  admin: AdminApiContext,
  shop: string,
): Promise<Entitlements> {
  let plan: Plan = "free";
  let subscriptionId: string | null = null;
  let subscriptionName: string | null = null;

  try {
    const res = await admin.graphql(
      `#graphql
        query CurrentSubscriptions {
          currentAppInstallation {
            activeSubscriptions { id name status }
          }
        }
      `,
    );
    const body = await res.json() as any;
    const subs = body?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    for (const s of subs) {
      if (s.status !== "ACTIVE") continue;
      const lower = String(s.name || "").toLowerCase();
      if (AGENCY_NAMES.has(lower) || lower.includes("agency")) {
        plan = "agency";
        subscriptionId = String(s.id);
        subscriptionName = String(s.name);
        break;
      }
      if (PRO_NAMES.has(lower) || lower.includes("pro")) {
        plan = "pro";
        subscriptionId = String(s.id);
        subscriptionName = String(s.name);
      }
    }

    // Mirror to ShopConfig so the rest of the app can read without GraphQL.
    await prisma.shopConfig.upsert({
      where: { shop },
      create: { shop, plan, subscriptionId },
      update: { plan, subscriptionId },
    });
  } catch (err) {
    console.warn("readEntitlements failed (defaulting to free):", (err as Error).message);
  }

  return { plan, subscriptionId, subscriptionName };
}

// hasPro and hasAgency are re-exported from ../lib/plans.ts above.
