// /app/upgrade/return — Shopify redirects here after the merchant approves the
// recurring charge. We re-fetch entitlements (which mirrors plan to ShopConfig)
// and bounce back to the dashboard with a success toast.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { readEntitlements } from "../services/entitlements.server";
import { redirectUrl } from "../services/embedded-redirect.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const ent = await readEntitlements(admin, session.shop);
  // hand the merchant back to the dashboard, with a banner toggle in the URL.
  const target = ent.plan === "free"
    ? redirectUrl(request, "/app/upgrade", { failed: "1" })
    : redirectUrl(request, "/app", { upgraded: ent.plan });
  return redirect(target);
};
