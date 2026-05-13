// /app/upgrade — pricing cards. Uses Shopify managed pricing.
//
// Plans are configured in the Partner Dashboard, not via the Billing API.
// The "Upgrade" button navigates the top frame to Shopify's hosted plan
// selection page at admin.shopify.com/store/{shop}/charges/{handle}/pricing_plans.
// Shopify renders the approval flow, charges the merchant, then redirects
// back to our app's redirect_url (configured per plan in Partners).
//
// We never call appSubscriptionCreate — the docs are explicit:
//   "Once you opt in, you can't create new recurring application charges
//    using the Billing API."
//
// Free trial abuse note: managed pricing tracks free trials over 180 days
// per shop, so reinstall-to-reset doesn't work. Per Omar's call though, we
// are running with NO free trial — pay to unlock Pro immediately.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  Badge,
  InlineStack,
  Divider,
  List,
  Banner,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { readEntitlements } from "../services/entitlements.server";
import { PLANS, type PlanKey, type Plan } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const ent = await readEntitlements(admin, session.shop);
  return json({ shop: session.shop, plan: ent.plan });
};

export default function UpgradePage() {
  const { shop, plan } = useLoaderData<typeof loader>();

  // Build the Shopify-hosted managed pricing URL once.
  const shopName = shop.replace(/\.myshopify\.com$/, "");
  const managedPricingUrl = `https://admin.shopify.com/store/${shopName}/charges/ww-pixel-audit/pricing_plans`;

  const handleUpgrade = () => {
    if (typeof window === "undefined") return;
    try {
      window.top!.location.href = managedPricingUrl;
    } catch {
      window.location.href = managedPricingUrl;
    }
  };

  return (
    <Page
      title="Billing"
      backAction={{ content: "Audit", url: "/app" }}
      subtitle={planSubtitle(plan)}
      primaryAction={
        plan === "pro"
          ? { content: "Manage subscription", onAction: handleUpgrade }
          : undefined
      }
    >
      <Layout>
        <Layout.Section>
          <Banner tone="info">
            Free includes the audit forever. Pro adds the Migration Wizard that installs a Custom Pixel for each broken tracker in one click. Change or cancel any time from Shopify's hosted billing page.
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <InlineStack gap="400" align="start" wrap={true} blockAlign="stretch">
            <PlanCard
              title="Free"
              price="$0"
              cadence="forever"
              isCurrent={plan === "free"}
              isAvailable={false}
              ctaLabelDefault="No payment required"
              onUpgrade={handleUpgrade}
              features={[
                "Unlimited audits",
                "Migration Readiness Report",
                "Scan history",
                "CSV export",
                "Plain-language recommendations",
              ]}
            />
            <PlanCard
              title="Pro"
              price={`$${PLANS.pro.amount}`}
              cadence="per month"
              recommended
              isCurrent={plan === "pro"}
              isAvailable
              ctaLabelDefault="Choose Pro"
              onUpgrade={handleUpgrade}
              features={[
                "Everything in Free",
                "Migration Wizard",
                "One-click Custom Pixel install: Meta, Google Ads, TikTok, Klaviyo, Pinterest",
                "Auto re-scan to confirm each fix is live",
              ]}
            />
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">Billing</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Plans are managed by Shopify. Charges appear on your normal Shopify invoice. No free trial — pay only when you're ready to unlock the Wizard. Cancel any time from the same page.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function planSubtitle(plan: Plan): string {
  if (plan === "pro") return "You're on Pro.";
  return "Free forever, upgrade for the one-click fix.";
}

function PlanCard({
  title,
  price,
  cadence,
  features,
  recommended,
  isCurrent,
  isAvailable,
  ctaLabelDefault,
  onUpgrade,
}: {
  title: string;
  price: string;
  cadence: string;
  features: string[];
  recommended?: boolean;
  isCurrent: boolean;
  isAvailable: boolean;
  ctaLabelDefault: string;
  onUpgrade: () => void;
}) {
  // Decide button state EXACTLY ONCE here, instead of letting the caller pass
  // both a stale label and a stale disabled flag (the source of the
  // ambiguity that made Free look "Current" in the previous version).
  let ctaLabel: string;
  let disabled: boolean;

  if (isCurrent) {
    ctaLabel = "Current plan";
    disabled = true;
  } else if (!isAvailable) {
    ctaLabel = ctaLabelDefault;
    disabled = true;
  } else {
    ctaLabel = ctaLabelDefault;
    disabled = false;
  }

  return (
    <div style={{ flex: "1 1 280px", minWidth: 280, maxWidth: 360 }}>
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">{title}</Text>
            {/* Only ONE badge can ever render: "Current" if this is the merchant's plan, else "Recommended" if the card opted in. */}
            {isCurrent ? (
              <Badge tone="success">Current</Badge>
            ) : recommended ? (
              <Badge tone="info">Recommended</Badge>
            ) : null}
          </InlineStack>
          <InlineStack gap="100" blockAlign="baseline">
            <Text as="p" variant="heading2xl">{price}</Text>
            <Text as="p" variant="bodySm" tone="subdued">{cadence}</Text>
          </InlineStack>
          <Divider />
          <List type="bullet">
            {features.map((f, i) => (
              <List.Item key={i}>{f}</List.Item>
            ))}
          </List>
          <Button
            variant="primary"
            fullWidth
            disabled={disabled}
            onClick={isAvailable && !isCurrent ? onUpgrade : undefined}
          >
            {ctaLabel}
          </Button>
        </BlockStack>
      </Card>
    </div>
  );
}
