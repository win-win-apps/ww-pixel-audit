// Settings — V1 only has the alert email and a placeholder for the upgrade CTA.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  TextField,
  Button,
  Banner,
  FormLayout,
} from "@shopify/polaris";
import { useState } from "react";

import { authenticate } from "../shopify.server";
import { getOrCreateShopConfig, updateShopConfig } from "../services/shop-config.server";
import { redirectUrl } from "../services/embedded-redirect.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const cfg = await getOrCreateShopConfig(session.shop);
  return json({ cfg });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const alertEmail = String(fd.get("alertEmail") || "").trim();
  await updateShopConfig(session.shop, {
    alertEmail: alertEmail.length > 0 ? alertEmail : null,
  });
  return redirect(redirectUrl(request, "/app/settings", { saved: "1" }));
};

export default function SettingsPage() {
  const { cfg } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const isSaving = nav.state !== "idle";

  const [email, setEmail] = useState(cfg.alertEmail || "");
  const [searchParams] = useSearchParams();
  const showSaved = searchParams.get("saved") === "1";

  return (
    <Page title="Settings" backAction={{ content: "Audit", url: "/app" }}>
      <Layout>
        {showSaved && (
          <Layout.Section>
            <Banner tone="success" title="Settings saved." />
          </Layout.Section>
        )}
        <Layout.Section>
          <Card>
            <Form method="post">
              <FormLayout>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">Alert email</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Optional. We will email this address when a scheduled scan finds new tracker problems. V1 leaves scheduled scans off, this is for the upcoming Pro tier.
                  </Text>
                </BlockStack>
                <TextField
                  label="Email"
                  type="email"
                  name="alertEmail"
                  value={email}
                  onChange={setEmail}
                  autoComplete="email"
                  helpText="We never share this address."
                />
                <div>
                  <Button submit variant="primary" loading={isSaving}>Save settings</Button>
                </div>
              </FormLayout>
            </Form>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Plan</Text>
              <Text as="p" variant="bodyMd">
                You're on the Free tier. The Free tier includes unlimited audits and the Migration Readiness Report.
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Pro ($29/mo) and Agency ($79/mo) tiers are launching shortly. Pro adds the Migration Wizard, which installs the right Custom Pixel for each broken tracker. Agency adds the Validator and a multi-store dashboard.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
