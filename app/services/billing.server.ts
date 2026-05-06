// Billing helpers. Wraps appSubscriptionCreate + appSubscriptionCancel.
// Returns the merchant-facing confirmation URL where they approve charges.
// Use `test: true` on dev stores so you don't accidentally bill yourself.

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { PLANS, type PlanKey } from "../lib/plans";

export { PLANS };
export type { PlanKey };

interface CreateOpts {
  shop: string;
  appHandle: string; // "ww-pixel-audit"
  appUrl: string;    // e.g. "https://engine-her-thinks-shepherd.trycloudflare.com"
  isDev: boolean;    // true for dev stores -> uses test: true so no real charge
}

export async function createSubscription(
  admin: AdminApiContext,
  plan: PlanKey,
  { shop, appHandle, appUrl, isDev }: CreateOpts,
): Promise<{ confirmationUrl: string | null; subscriptionId: string | null; userErrors: any[] }> {
  const def = PLANS[plan];
  // After approval, Shopify sends the merchant back to this absolute URL.
  // We embed the plan key so the return route can confirm the right one.
  const returnUrl = `${appUrl.replace(/\/$/, "")}/app/upgrade/return?plan=${plan}&shop=${encodeURIComponent(shop)}`;

  const res = await admin.graphql(
    `#graphql
      mutation CreateSub(
        $name: String!,
        $returnUrl: URL!,
        $trialDays: Int,
        $test: Boolean,
        $lineItems: [AppSubscriptionLineItemInput!]!
      ) {
        appSubscriptionCreate(
          name: $name,
          returnUrl: $returnUrl,
          trialDays: $trialDays,
          test: $test,
          lineItems: $lineItems
        ) {
          confirmationUrl
          appSubscription { id name status }
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        name: def.name,
        returnUrl,
        trialDays: def.trialDays,
        test: isDev,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: def.amount, currencyCode: def.currency },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
      },
    },
  );

  const body = await res.json() as any;
  const root = body?.data?.appSubscriptionCreate;
  return {
    confirmationUrl: root?.confirmationUrl ?? null,
    subscriptionId: root?.appSubscription?.id ?? null,
    userErrors: root?.userErrors ?? [],
  };
}

export async function cancelSubscription(
  admin: AdminApiContext,
  subscriptionId: string,
): Promise<boolean> {
  try {
    const res = await admin.graphql(
      `#graphql
        mutation CancelSub($id: ID!) {
          appSubscriptionCancel(id: $id) {
            appSubscription { id status }
            userErrors { field message }
          }
        }
      `,
      { variables: { id: subscriptionId } },
    );
    const body = await res.json() as any;
    const errs = body?.data?.appSubscriptionCancel?.userErrors;
    return !errs || errs.length === 0;
  } catch {
    return false;
  }
}
