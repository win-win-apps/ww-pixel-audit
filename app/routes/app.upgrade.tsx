// /app/upgrade — pricing cards. "Upgrade" buttons call appSubscriptionCreate
// and redirect the merchant to Shopify's confirmation URL.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
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
import { createSubscription } from "../services/billing.server";
import { PLANS, type PlanKey, type Plan } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const ent = await readEntitlements(admin, session.shop);
  return json({ shop: session.shop, plan: ent.plan });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const fd = await request.formData();
  const planKey = String(fd.get("plan") || "") as PlanKey;
  if (planKey !== "pro" && planKey !== "agency") {
    return json({ error: "Unknown plan" }, { status: 400 });
  }

  // Use the live App URL from env so the return URL is absolute.
  // This is required by appSubscriptionCreate.
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  if (!appUrl) {
    return json({ error: "App URL not configured. Restart shopify app dev." }, { status: 500 });
  }

  // dev stores → test charges. We detect by .myshopify.com hostname patterns
  // OR by the presence of a non-prod env var. For win-win-ccae-dev we always test.
  const isDev = session.shop.endsWith(".myshopify.com") && /dev|test/i.test(session.shop);

  const result = await createSubscription(admin, planKey, {
    shop: session.shop,
    appHandle: "ww-pixel-audit",
    appUrl,
    isDev,
  });

  if (!result.confirmationUrl) {
    return json({
      error: result.userErrors.map((e: any) => `${(e.field || []).join(".")}: ${e.message}`).join("; ") || "Could not start subscription",
    }, { status: 500 });
  }

  // Shopify wants us to top-level navigate to its confirmation URL, escaping the iframe.
  return redirect(result.confirmationUrl);
};

export default function UpgradePage() {
  const { plan } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const submitting = nav.state !== "idle";

  return (
    <Page
      title="Choose your plan"
      backAction={{ content: "Audit", url: "/app" }}
      subtitle={planSubtitle(plan)}
    >
      <Layout>
        <Layout.Section>
          <Banner tone="info">
            All plans include the free Auditor and Migration Readiness Report. Pro and Agency unlock the Migration Wizard that installs the fix for you in one click.
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <InlineStack gap="400" align="start" wrap={true} blockAlign="stretch">
            <PlanCard
              title="Free"
              price="$0"
              cadence="forever"
              current={plan === "free"}
              ctaLabel="You're on Free"
              disabled
              features={[
                "Unlimited audits",
                "Migration Readiness Report",
                "Scan history",
                "CSV export",
              ]}
            />
            <PlanCard
              title="Pro"
              price={`$${PLANS.pro.amount}`}
              cadence="per month"
              recommended
              current={plan === "pro"}
              ctaLabel={plan === "pro" ? "Current plan" : `Start 7-day free trial`}
              disabled={plan === "pro" || submitting}
              planKey="pro"
              features={[
                "Everything in Free",
                "Migration Wizard",
                "One-click Custom Pixel install for Meta, Google Ads, TikTok, Klaviyo, Pinterest",
                "Auto re-scan after install confirms the fix",
                "7-day free trial",
              ]}
            />
            <PlanCard
              title="Agency"
              price={`$${PLANS.agency.amount}`}
              cadence="per month"
              current={plan === "agency"}
              ctaLabel={plan === "agency" ? "Current plan" : "Start 7-day free trial"}
              disabled={plan === "agency" || submitting}
              planKey="agency"
              features={[
                "Everything in Pro",
                "Validator (compares ad-platform reports vs Shopify orders daily)",
                "Multi-store dashboard",
                "First 5 stores included",
                "$5/mo per additional store",
              ]}
            />
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">Billing</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Charges are managed by Shopify and appear on your normal Shopify invoice. On dev stores, charges are marked as test and never collected.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function planSubtitle(plan: Plan): string {
  if (plan === "agency") return "You're on Agency.";
  if (plan === "pro") return "You're on Pro.";
  return "Free forever, upgrade for the one-click fix.";
}

function PlanCard({
  title,
  price,
  cadence,
  features,
  recommended,
  current,
  ctaLabel,
  disabled,
  planKey,
}: {
  title: string;
  price: string;
  cadence: string;
  features: string[];
  recommended?: boolean;
  current?: boolean;
  ctaLabel: string;
  disabled?: boolean;
  planKey?: PlanKey;
}) {
  return (
    <div style={{ flex: "1 1 280px", minWidth: 280, maxWidth: 360 }}>
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">{title}</Text>
            {current && <Badge tone="success">Current</Badge>}
            {!current && recommended && <Badge tone="info">Recommended</Badge>}
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
          {planKey ? (
            <Form method="post">
              <input type="hidden" name="plan" value={planKey} />
              <Button submit variant="primary" fullWidth disabled={disabled}>
                {ctaLabel}
              </Button>
            </Form>
          ) : (
            <Button fullWidth disabled>
              {ctaLabel}
            </Button>
          )}
        </BlockStack>
      </Card>
    </div>
  );
}
