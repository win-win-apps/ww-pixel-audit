// Explains how the audit scan works, in merchant-friendly language.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  List,
  Divider,
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
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Why this audit exists</Text>
              <Text as="p" variant="bodyMd">
                Shopify is retiring legacy checkout. After August 26, 2026 anything you pasted into Additional Scripts, the Thank You page, or the Order Status page will stop firing. That includes Meta Pixel, Google Ads tags, TikTok Pixel, Klaviyo events, and any custom JS you added.
              </Text>
              <Text as="p" variant="bodyMd">
                Because your dashboards still show traffic and your storefront still looks fine, most merchants do not notice for two to three weeks. By the time ROAS drops and ad spend has been allocated against broken numbers, you have lost weeks of attribution.
              </Text>
              <Text as="p" variant="bodyMd">
                This audit does one thing well: it lists every tracker we can detect on your store, says which ones are safe and which ones will break on August 26, and tells you what to do about each one.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Where we look</Text>
              <Divider />
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">1. Script tags</Text>
                <Text as="p" variant="bodyMd">
                  We read every script tag installed via the Shopify Admin API. If the URL points at a known pixel (Meta, Google, TikTok, etc.) we flag it. Script-tag pixels do not run inside the upgraded checkout.
                </Text>
              </BlockStack>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">2. Theme code</Text>
                <Text as="p" variant="bodyMd">
                  We read your published theme's main layout file and common tracking snippets. We look for direct calls to fbq(), gtag(), ttq, _learnq, pintrk, snaptr, uetq, and rdt. Anything we find here cannot fire on the new checkout.
                </Text>
              </BlockStack>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">3. Custom Pixels</Text>
                <Text as="p" variant="bodyMd">
                  We check the Web Pixel API to see whether a Custom Pixel is registered. Custom Pixels run inside Shopify's checkout sandbox and are the safe path forward.
                </Text>
              </BlockStack>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">4. Sales channels</Text>
                <Text as="p" variant="bodyMd">
                  If you have the official Google &amp; YouTube channel, the Facebook &amp; Instagram channel, the TikTok channel, or the Pinterest channel installed, those handle their respective pixels for you. We mark them as safe.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">What the statuses mean</Text>
              <List type="bullet">
                <List.Item>
                  <strong>Will break Aug 26</strong> — this tracker lives somewhere that stops firing on August 26, 2026. Move it before the deadline.
                </List.Item>
                <List.Item>
                  <strong>Need a closer look</strong> — we found a custom script we could not classify. Open the URL and check what it does.
                </List.Item>
                <List.Item>
                  <strong>Already safe</strong> — this tracker is on the upgraded path (Custom Pixel or sales channel) and will keep firing after the deadline.
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">What we don't do (yet)</Text>
              <Text as="p" variant="bodyMd">
                The free tier is audit only. The upcoming Pro tier ($29/mo) installs the right Custom Pixel for you with one click. The Agency tier ($79/mo) reconciles your ad-platform reported conversions against your Shopify orders daily and emails you when something drifts.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
