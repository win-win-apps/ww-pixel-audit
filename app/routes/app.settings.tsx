// Settings page. Currently informational only — no toggles, no email field.
// (We removed the alertEmail input because there is no email-sending
// infrastructure behind it; surfacing the field would have implied
// functionality we don't ship.)

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
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { readEntitlements } from "../services/entitlements.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const ent = await readEntitlements(admin, session.shop);
  return json({ shop: session.shop, plan: ent.plan });
};

export default function SettingsPage() {
  const { shop, plan } = useLoaderData<typeof loader>();
  const isPro = plan === "pro" || plan === "agency";

  return (
    <Page title="Settings" backAction={{ content: "Audit", url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Connected store</Text>
              <Text as="p" variant="bodyMd">{shop}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Plan</Text>
              <Text as="p" variant="bodyMd">
                You're on the {isPro ? "Pro" : "Free"} tier. {isPro
                  ? "Pro unlocks the Migration Wizard that installs a Custom Pixel for every broken tracker."
                  : "Free includes unlimited audits, the Migration Readiness Report, scan history, and CSV export."}
              </Text>
              <div>
                <Button url="/app/upgrade" variant={isPro ? "secondary" : "primary"}>
                  {isPro ? "Manage plan" : "See Pro"}
                </Button>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Uninstall</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Uninstall from Shopify admin → Apps. We delete your scan history, the Web Pixel we installed, and your shop config automatically via the GDPR webhooks.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
