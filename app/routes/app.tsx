import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { getOrCreateShopConfig } from "../services/shop-config.server";
import { readEntitlements } from "../services/entitlements.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

// Routes that are allowed to render even when the merchant has no active
// subscription. The upgrade route itself is the redirect target so the
// merchant can actually go pick a plan, and upgrade/return is where Shopify
// drops them after they pick. Excluding these prevents an infinite loop.
const NO_PLAN_ALLOWLIST = new Set([
  "/app/upgrade",
  "/app/upgrade/return",
]);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  await getOrCreateShopConfig(session.shop);

  // Plan gate: every page in the app requires the merchant to have an active
  // subscription (Free or Pro — Free is a real managed-pricing plan, not "no
  // plan"). If they haven't picked one yet, top-frame redirect to Shopify's
  // hosted plan selection page. The /app/upgrade routes are excluded so the
  // redirect target itself stays reachable.
  const url = new URL(request.url);
  if (!NO_PLAN_ALLOWLIST.has(url.pathname)) {
    const ent = await readEntitlements(admin, session.shop);
    if (!ent.subscriptionId) {
      const shopName = session.shop.replace(/\.myshopify\.com$/, "");
      const pricingUrl = `https://admin.shopify.com/store/${shopName}/charges/ww-pixel-audit/pricing_plans`;
      return redirect(pricingUrl, { target: "_top" });
    }
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Audit</Link>
        <Link to="/app/fix">Fix it (Pro)</Link>
        <Link to="/app/upgrade">Billing</Link>
        <Link to="/app/history">Scan history</Link>
        <Link to="/app/methodology">How this works</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
