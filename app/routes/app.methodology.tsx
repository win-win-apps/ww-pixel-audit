// /app/methodology — explains how the audit + fix actually work, with
// graphics generated via scripts/generate-methodology-graphics.mjs and
// served from /methodology/*.png by Remix's static handler.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Badge,
  InlineStack,
  Box,
  Divider,
  Banner,
  Button,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

export default function MethodologyPage() {
  return (
    <Page title="How this works" backAction={{ content: "Audit", url: "/app" }}>
      <Layout>
        {/* Hero */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Badge tone="critical">Aug 26, 2026</Badge>
                <Text as="span" variant="bodySm" tone="subdued">Hard deadline</Text>
              </InlineStack>
              <Text as="h2" variant="heading2xl">
                A pixel that works today might not work in November.
              </Text>
              <Text as="p" variant="bodyLg" tone="subdued">
                Shopify is retiring legacy checkout. Anything pasted into Additional Scripts, the Thank You page, or the Order Status page stops firing on August 26, 2026. Pixel Audit finds those pixels in your store, tells you which ones are at risk, and (with Pro) installs the fix as a Custom Pixel in one click.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Why merchants miss it */}
        <Layout.Section>
          <Banner tone="warning" title="Why merchants miss it for weeks">
            <p>
              Storefronts still load. Dashboards still show traffic. The thing that breaks is your
              ad platform's ability to attribute conversions, which only shows up when ROAS drops
              two to three weeks later. By then ad spend has been allocated against numbers that
              quietly went wrong.
            </p>
          </Banner>
        </Layout.Section>

        {/* Visual 1: where pixels hide */}
        <Layout.Section>
          <Card padding="0">
            <img
              src="/methodology/where-pixels-hide.png"
              alt="Four-quadrant grid showing the four places we scan: script tags, theme code, Custom Pixels, and sales channels"
              style={{ width: "100%", display: "block", borderRadius: "12px" }}
            />
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">What that actually means</Text>
              <Box paddingBlockStart="200">
                <BlockStack gap="200">
                  <SourceRow
                    title="Script tags"
                    detail="We read every script tag installed via the Shopify Admin API and match its source URL against known pixel hosts. Most pre-2024 Meta and Google installs live here."
                    breakStatus="Will break"
                  />
                  <SourceRow
                    title="Theme code"
                    detail="We open your theme's layout files plus 23 known tracking-snippet paths and look for direct calls to fbq, gtag, ttq, _learnq, pintrk, snaptr, uetq, and rdt. If those come back empty, we widen the scan: every .liquid file in snippets, sections, and layout whose filename hints at tracking gets read too."
                    breakStatus="Will break"
                  />
                  <SourceRow
                    title="Custom Pixels"
                    detail="We check the Web Pixel API to see whether a Custom Pixel is registered. Custom Pixels run inside Shopify's Customer Events sandbox and are the safe path forward."
                    breakStatus="Safe"
                  />
                  <SourceRow
                    title="Sales channels"
                    detail="If you have the official Google &amp; YouTube, Facebook &amp; Instagram, TikTok, or Pinterest channel apps installed, we treat their respective platforms as already handled."
                    breakStatus="Safe"
                  />
                </BlockStack>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Visual 2: status legend */}
        <Layout.Section>
          <Card padding="0">
            <img
              src="/methodology/status-legend.png"
              alt="Three status badges side by side: Will break Aug 26, Needs a closer look, Already safe — each with a one-line explanation"
              style={{ width: "100%", display: "block", borderRadius: "12px" }}
            />
          </Card>
        </Layout.Section>

        {/* Visual 3: lifecycle */}
        <Layout.Section>
          <Card padding="0">
            <img
              src="/methodology/migration-lifecycle.png"
              alt="Five-step flow from running the scan, seeing the report, clicking Fix it (Pro), installing the Custom Pixel, and the auto re-scan confirming the fix is live"
              style={{ width: "100%", display: "block", borderRadius: "12px" }}
            />
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">What Pro actually does on click 4</Text>
              <Text as="p" variant="bodyMd">
                You paste a Meta Pixel ID (or Google Ads conversion ID, or TikTok Pixel ID, etc). We call Shopify's
                {" "}<code>webPixelCreate</code> mutation with the settings, and Shopify provisions a Web Pixel in your store's
                Customer Events sandbox. The pixel runtime is small, lives in our app extension, and does two things:
                loads the platform's standard tracking script (the same fbq / gtag / ttq snippet you would have pasted yourself),
                and forwards Customer Events (page_viewed, product_viewed, product_added_to_cart, checkout_completed) to it.
                That code path runs on the upgraded checkout, the upgraded thank-you page, and the upgraded order-status page,
                so it survives the August 26 deadline.
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                After the install we automatically re-run the audit so you can see the platform you just fixed move to "Already safe."
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Free vs Pro recap */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">Free vs Pro</Text>
              <InlineStack gap="400" wrap={true} align="start" blockAlign="stretch">
                <PlanRecap
                  title="Free"
                  price="$0"
                  cadence="forever"
                  bullets={[
                    "Unlimited audits",
                    "Migration Readiness Report",
                    "Scan history",
                    "CSV export",
                  ]}
                />
                <PlanRecap
                  title="Pro"
                  price="$29"
                  cadence="per month"
                  bullets={[
                    "Migration Wizard",
                    "One-click Custom Pixel install",
                    "Auto re-scan after each install",
                  ]}
                  cta={{ label: "See Pro", url: "/app/upgrade" }}
                />
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Box paddingBlock="200">
            <Text as="p" variant="bodySm" tone="subdued" alignment="center">
              No free trial. No setup fees. No required consulting calls.
            </Text>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function SourceRow({
  title,
  detail,
  breakStatus,
}: {
  title: string;
  detail: string;
  breakStatus: "Will break" | "Safe";
}) {
  return (
    <Box>
      <InlineStack gap="200" blockAlign="start" wrap={false}>
        <Box minWidth="120px">
          <BlockStack gap="100">
            <Text as="span" variant="bodyMd" fontWeight="semibold">{title}</Text>
            <Badge tone={breakStatus === "Safe" ? "success" : "critical"}>{breakStatus}</Badge>
          </BlockStack>
        </Box>
        <Text as="span" variant="bodyMd" tone="subdued">{detail}</Text>
      </InlineStack>
      <Box paddingBlockStart="200"><Divider /></Box>
    </Box>
  );
}

function PlanRecap({
  title,
  price,
  cadence,
  bullets,
  cta,
}: {
  title: string;
  price: string;
  cadence: string;
  bullets: string[];
  cta?: { label: string; url: string };
}) {
  return (
    <div style={{ flex: "1 1 280px", minWidth: 260 }}>
      <Box padding="400" background="bg-surface-secondary" borderRadius="200">
        <BlockStack gap="200">
          <Text as="h4" variant="headingSm">{title}</Text>
          <InlineStack gap="100" blockAlign="baseline">
            <Text as="span" variant="headingXl">{price}</Text>
            <Text as="span" variant="bodySm" tone="subdued">{cadence}</Text>
          </InlineStack>
          <BlockStack gap="100">
            {bullets.map((b, i) => (
              <Text as="p" variant="bodySm" key={i}>· {b}</Text>
            ))}
          </BlockStack>
          {cta && (
            <Box paddingBlockStart="200">
              <Button url={cta.url} variant="primary">{cta.label}</Button>
            </Box>
          )}
        </BlockStack>
      </Box>
    </div>
  );
}
