// /app/fix — Pro Migration Wizard.
// For each broken tracker, capture the platform's pixel ID / company ID and
// install via webPixelCreate. Forwards events from Customer Events sandbox.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  TextField,
  Button,
  Badge,
  InlineStack,
  Banner,
  Divider,
  EmptyState,
} from "@shopify/polaris";
import { useState } from "react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { readEntitlements, hasPro } from "../services/entitlements.server";
import { upsertWebPixel, readPixelSettings, PLATFORM_TO_SETTING, type PixelSettings } from "../services/web-pixel.server";
import { redirectUrl } from "../services/embedded-redirect.server";

interface PlatformRow {
  platform: string;
  detectedId: string | null;
  settingKey: keyof PixelSettings | null;
  status: string;
  installed: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const ent = await readEntitlements(admin, shop);

  if (!hasPro(ent.plan)) {
    return redirect(redirectUrl(request, "/app/upgrade", { reason: "fix" }));
  }

  // most recent OK scan
  const lastScan = await prisma.scanRun.findFirst({
    where: { shop, status: "ok" },
    orderBy: { startedAt: "desc" },
    include: { trackers: true },
  });

  const settings = await readPixelSettings(shop);

  const rows: PlatformRow[] = [];
  if (lastScan) {
    const seen = new Set<string>();
    for (const t of lastScan.trackers) {
      if (t.status !== "broken_aug_26") continue;
      if (seen.has(t.platform)) continue;
      seen.add(t.platform);
      const settingKey = PLATFORM_TO_SETTING[t.platform] ?? null;
      const installed = settingKey ? Boolean(settings[settingKey]) : false;
      rows.push({
        platform: t.platform,
        detectedId: t.detectedId,
        settingKey,
        status: t.status,
        installed,
      });
    }
  }

  return json({
    shop,
    rows,
    settings,
    hasScan: Boolean(lastScan),
    plan: ent.plan,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const ent = await readEntitlements(admin, session.shop);
  if (!hasPro(ent.plan)) {
    return redirect(redirectUrl(request, "/app/upgrade", { reason: "fix" }));
  }

  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  if (intent !== "install") {
    return json({ ok: false, error: "Unknown action" }, { status: 400 });
  }

  // Read all settings fields from the form, only include the ones present.
  const partial: PixelSettings = {};
  for (const k of ["metaPixelId", "googleAdsId", "googleAdsLabel", "tiktokPixelId", "klaviyoCompanyId", "pinterestTagId"] as (keyof PixelSettings)[]) {
    const v = fd.get(k);
    if (typeof v === "string") partial[k] = v.trim();
  }

  const result = await upsertWebPixel(admin, session.shop, partial);
  if (!result.ok) {
    return json({ ok: false, error: result.error });
  }
  return redirect(redirectUrl(request, "/app/fix", { installed: "1" }));
};

export default function FixPage() {
  const { shop, rows, settings, hasScan } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ ok?: boolean; error?: string }>();
  const nav = useNavigation();
  const submitting = nav.state !== "idle";

  if (!hasScan) {
    return (
      <Page title="Migration Wizard" backAction={{ content: "Audit", url: "/app" }}>
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState heading="Run a scan first" image="">
                <p>Go back to the Audit page and run a scan. We'll bring you here automatically once we know what's broken.</p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page title="Migration Wizard" backAction={{ content: "Audit", url: "/app" }} subtitle="Install the fix in one click">
      <Layout>
        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical" title="Install failed">{actionData.error}</Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <Banner tone="info">
            Each row below is a tracker we found that won't survive August 26. Enter the pixel ID, hit Install, and we'll register it as a Custom Pixel that runs in the upgraded checkout sandbox.
          </Banner>
        </Layout.Section>

        {rows.length === 0 ? (
          <Layout.Section>
            <Card>
              <EmptyState heading="No broken trackers detected" image="">
                <p>The last scan came back clean. Re-run the scan from the Audit page if you've changed anything since.</p>
              </EmptyState>
            </Card>
          </Layout.Section>
        ) : (
          rows.map((row) => (
            <Layout.Section key={row.platform}>
              <PlatformCard row={row} settings={settings} submitting={submitting} />
            </Layout.Section>
          ))
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">Connected to {shop}</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Web Pixel installs go through Shopify's Customer Events sandbox. They run on every page including the upgraded checkout, thank-you, and order-status pages. Your pixel data flows directly to each platform — we never see it.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function PlatformCard({ row, settings, submitting }: { row: PlatformRow; settings: PixelSettings; submitting: boolean }) {
  const settingKey = row.settingKey;
  const currentValue = settingKey ? settings[settingKey] || "" : "";
  const [value, setValue] = useState(currentValue);
  const [labelValue, setLabelValue] = useState(settings.googleAdsLabel || "");

  if (!settingKey) {
    // Platform we can't auto-fix yet (Snap, Bing, Reddit, etc.) — link to the right channel app.
    return (
      <Card>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">{row.platform}</Text>
            <Badge tone="warning">Manual fix</Badge>
          </InlineStack>
          <Text as="p" variant="bodyMd" tone="subdued">
            Auto-install for {row.platform} is coming soon. For now, the safest path is to install the official channel app for this platform from the Shopify App Store. Once installed it handles tracking automatically.
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const helpText = helpForPlatform(row.platform);

  return (
    <Card>
      <Form method="post">
        <input type="hidden" name="intent" value="install" />
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">{row.platform}</Text>
            {row.installed ? <Badge tone="success">Installed</Badge> : <Badge tone="critical">Will break Aug 26</Badge>}
          </InlineStack>
          {row.detectedId && (
            <Text as="p" variant="bodySm" tone="subdued">We detected ID: {row.detectedId} on your store. Confirm or replace below.</Text>
          )}
          <TextField
            label={labelForKey(settingKey)}
            name={settingKey}
            value={value}
            onChange={setValue}
            autoComplete="off"
            placeholder={placeholderForKey(settingKey)}
            helpText={helpText}
          />
          {row.platform === "Google Ads" && (
            <TextField
              label="Conversion label (purchase event)"
              name="googleAdsLabel"
              value={labelValue}
              onChange={setLabelValue}
              autoComplete="off"
              placeholder="e.g. AbC-D_efGhIjK"
              helpText="Optional. Found in Google Ads > Tools > Conversions > your purchase action."
            />
          )}
          <Divider />
          <InlineStack align="space-between" blockAlign="center">
            <Text as="p" variant="bodySm" tone="subdued">
              {row.installed ? "Saving will update the existing Custom Pixel." : "We'll register this as a new Custom Pixel in your store."}
            </Text>
            <Button submit variant="primary" loading={submitting} disabled={!value.trim()}>
              {row.installed ? "Update" : "Install"}
            </Button>
          </InlineStack>
        </BlockStack>
      </Form>
    </Card>
  );
}

function labelForKey(key: keyof PixelSettings): string {
  switch (key) {
    case "metaPixelId":      return "Meta Pixel ID";
    case "googleAdsId":      return "Google Ads conversion ID";
    case "googleAdsLabel":   return "Google Ads conversion label";
    case "tiktokPixelId":    return "TikTok Pixel ID";
    case "klaviyoCompanyId": return "Klaviyo Company ID (Public API Key)";
    case "pinterestTagId":   return "Pinterest Tag ID";
  }
}

function placeholderForKey(key: keyof PixelSettings): string {
  switch (key) {
    case "metaPixelId":      return "e.g. 1234567890123456";
    case "googleAdsId":      return "e.g. AW-1234567890";
    case "googleAdsLabel":   return "e.g. AbC-D_efGhIjK";
    case "tiktokPixelId":    return "e.g. CXXXXXXXXXXXXXXXX";
    case "klaviyoCompanyId": return "e.g. AbCdEf";
    case "pinterestTagId":   return "e.g. 2612345678901";
  }
}

function helpForPlatform(platform: string): string {
  switch (platform) {
    case "Meta Pixel":          return "Find this in Meta Events Manager > Data Sources > your pixel.";
    case "Google Ads":          return "Find this in Google Ads > Tools > Conversions. Format AW-XXXXXXXXX.";
    case "Google Tag Manager":  return "GTM is a container, not a pixel itself. Replace with a Custom Pixel for each tag inside it.";
    case "Google Analytics 4":  return "Use the official Google & YouTube channel app instead of installing GA4 directly.";
    case "TikTok Pixel":        return "Find this in TikTok Ads Manager > Assets > Events.";
    case "Klaviyo Onsite":      return "Public API key from Klaviyo > Account > Settings > API Keys.";
    case "Pinterest Tag":       return "Find this in Pinterest Ads > Conversions.";
    default:                    return "";
  }
}
