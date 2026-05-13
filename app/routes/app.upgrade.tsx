// /app/upgrade — thin server-side top-frame redirect to Shopify's managed
// pricing page. No UI to render: every "Billing", "Upgrade to Pro", and
// "Manage subscription" link points here, and we hand off straight to
// Shopify's hosted plan selection page.
//
// Why no in-app plan cards:
//   - Shopify already renders the canonical plan list at
//     /store/{shop}/charges/{appHandle}/pricing_plans, with proration,
//     "Current plan" indicator, and a Cancel button when subscribed.
//   - Rendering our own copy of the same list creates a confusing
//     two-page flow (our cards -> Shopify's cards) and risks letting a
//     Pro merchant click "Choose Pro" again. Shopify's hosted page
//     refuses double-subscriptions natively — by sending merchants
//     straight there, we inherit that guarantee.
//
// The Shopify redirect helper sets the App Bridge top-frame header so the
// host frame navigates instead of the iframe. This is the official
// managed-pricing redirect pattern.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const shopName = session.shop.replace(/\.myshopify\.com$/, "");
  const url = `https://admin.shopify.com/store/${shopName}/charges/ww-pixel-audit/pricing_plans`;
  return redirect(url, { target: "_top" });
};
