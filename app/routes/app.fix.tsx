// /app/fix — Pro Migration Wizard.
// For each broken tracker, capture the platform's pixel ID / company ID and
// install via webPixelCreate. Forwards events from Customer Events sandbox.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
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
} from "@shopify/polaris";
import { useState } from "react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { readEntitlements, hasPro } from "../services/entitlements.server";
import { upsertWebPixel, readPixelSettings, PLATFORM_TO_SETTING, type PixelSettings } from "../services/web-pixel.server";
import { runScan } from "../services/scanner.server";
import { estimateRevenueAtRisk } from "../services/revenue-estimator.server";
import { markScanCompleted } from "../services/shop-config.server";
import { redirectUrl } from "../services/embedded-redirect.server";
import { validatePixelField, getFieldExample, type PixelField } from "../lib/pixel-format";
import { PlatformIcon } from "../components/PlatformIcon";

interface PlatformRow {
  platform: string;
  settingKey: keyof PixelSettings;
  detectedId: string | null;            // pre-fill from a broken scan row, if any
  detectedAsBroken: boolean;            // we found the merchant's old install on the store
  installed: boolean;                   // we already registered a Custom Pixel for this platform
}

// All five platforms our Web Pixel runtime supports. Always show one card per platform
// so the merchant can install or update any of them whether or not the scan flagged
// something. (If the scan didn't find an old install we still want them to be able to
// add the Custom Pixel — that's the point of the wizard.)
const SUPPORTED_PLATFORMS: { name: string; settingKey: keyof PixelSettings }[] = [
  { name: "Meta Pixel",     settingKey: "metaPixelId" },
  { name: "Google Ads",     settingKey: "googleAdsId" },
  { name: "TikTok Pixel",   settingKey: "tiktokPixelId" },
  { name: "Klaviyo Onsite", settingKey: "klaviyoCompanyId" },
  { name: "Pinterest Tag",  settingKey: "pinterestTagId" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const ent = await readEntitlements(admin, shop);

  if (!hasPro(ent.plan)) {
    return redirect(redirectUrl(request, "/app/upgrade", { reason: "fix" }));
  }

  const lastScan = await prisma.scanRun.findFirst({
    where: { shop, status: "ok" },
    orderBy: { startedAt: "desc" },
    include: { trackers: true },
  });

  const settings = await readPixelSettings(shop);

  // Build a one-row-per-platform list. For each supported platform, look up the
  // freshest broken-status detection in the last scan (if any) to pre-fill the ID.
  const detectedById = new Map<keyof PixelSettings, { detectedId: string | null }>();
  if (lastScan) {
    for (const t of lastScan.trackers) {
      if (t.status !== "broken_aug_26") continue;
      const key = PLATFORM_TO_SETTING[t.platform];
      if (!key) continue;
      // First broken detection wins (scanner returns most-specific first)
      if (!detectedById.has(key)) {
        detectedById.set(key, { detectedId: t.detectedId });
      }
    }
  }

  const rows: PlatformRow[] = SUPPORTED_PLATFORMS.map(({ name, settingKey }) => {
    const detected = detectedById.get(settingKey);
    return {
      platform: name,
      settingKey,
      detectedId: detected?.detectedId ?? null,
      detectedAsBroken: Boolean(detected),
      installed: Boolean(settings[settingKey]),
    };
  });

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

  // Belt-and-suspenders: validate non-empty fields server-side before we hit
  // Shopify with a bad ID. Client validates first but a malicious post could
  // bypass, so we re-check here.
  const fmtErrors: string[] = [];
  for (const [key, value] of Object.entries(partial)) {
    if (!value || value === "disabled") continue; // empty / sentinel = skip
    const result = validatePixelField(key as PixelField, value);
    if (!result.ok) fmtErrors.push(`${key}: ${result.error}`);
  }
  if (fmtErrors.length > 0) {
    return json({ ok: false, error: fmtErrors.join("; ") });
  }

  const result = await upsertWebPixel(admin, session.shop, partial);
  if (!result.ok) {
    return json({ ok: false, error: result.error });
  }

  // Auto re-scan to confirm the fix is live. We trigger the same runScan flow
  // the dashboard uses, so the next page load reads the freshest results and
  // the previously-broken platform shows up under "safe" via the Custom Pixel
  // path. If the scan throws we still consider the install a success — the
  // Custom Pixel is registered.
  try {
    const startedAt = new Date();
    const run = await prisma.scanRun.create({
      data: {
        shop: session.shop,
        title: `Auto re-scan ${startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
        description: "Triggered automatically after a Migration Wizard install.",
        status: "running",
      },
    });
    const scanResult = await runScan(admin);
    const revenue = await estimateRevenueAtRisk(admin, scanResult.trackers);
    await prisma.scanRun.update({
      where: { id: run.id },
      data: {
        status: "ok",
        finishedAt: new Date(),
        totalFound: scanResult.totalFound,
        brokenCount: scanResult.brokenCount,
        unknownCount: scanResult.unknownCount,
        safeCount: scanResult.safeCount,
        weeklyRevenue: revenue?.weeklyRevenue ?? null,
        atRiskRevenue: revenue?.atRiskRevenue ?? null,
        atRiskPct: revenue?.atRiskPct ?? null,
        currency: revenue?.currency ?? null,
        trackers: {
          create: scanResult.trackers.map((t) => ({
            platform: t.platform,
            detectedId: t.detectedId ?? null,
            source: t.source,
            sourceDetail: t.sourceDetail ?? null,
            status: t.status,
            reason: t.reason,
            recommendation: t.recommendation ?? null,
          })),
        },
      },
    });
    await markScanCompleted(session.shop);
  } catch (err) {
    console.warn("Auto re-scan after install failed (non-fatal):", (err as Error).message);
  }

  return redirect(redirectUrl(request, "/app/fix", { installed: "1" }));
};

export default function FixPage() {
  const { shop, rows, settings, hasScan } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ ok?: boolean; error?: string }>();
  const nav = useNavigation();
  const submitting = nav.state !== "idle";
  const [searchParams] = useSearchParams();
  const justInstalled = searchParams.get("installed") === "1";

  const detectedCount = rows.filter((r) => r.detectedAsBroken).length;
  const installedCount = rows.filter((r) => r.installed).length;

  return (
    <Page title="Migration Wizard" backAction={{ content: "Audit", url: "/app" }} subtitle="Install the fix in one click">
      <Layout>
        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical" title="Install failed">{actionData.error}</Banner>
          </Layout.Section>
        )}
        {justInstalled && !actionData?.error && (
          <Layout.Section>
            <Banner tone="success" title="Pixel installed and re-scan complete">
              The Custom Pixel is registered with Shopify and a fresh scan ran automatically. The platform you just configured should now show up under "Already safe" on the Audit page.
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <Banner tone="info">
            <p>
              Pick any platform below. Paste the pixel ID, click Install, and we register it as a Custom Pixel that runs in the upgraded checkout sandbox.
            </p>
            {!hasScan && (
              <p>
                You haven't run an audit yet. Go to the Audit page and click <strong>Run my first scan</strong> first if you want us to pre-fill detected pixel IDs.
              </p>
            )}
            {hasScan && detectedCount === 0 && installedCount === 0 && (
              <p>
                Heads up: the last scan didn't flag any broken trackers on this store. You can still install Custom Pixels here for any platform you want to add.
              </p>
            )}
          </Banner>
        </Layout.Section>

        {rows.map((row) => (
          <Layout.Section key={row.platform}>
            <PlatformCard row={row} settings={settings} submitting={submitting} />
          </Layout.Section>
        ))}

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
  // Initial value: previously-saved setting (if installed) wins, then the scanner's
  // detected ID (if detected as broken), then empty.
  const initialValue = settings[settingKey] || row.detectedId || "";
  const [value, setValue] = useState(initialValue);
  const [labelValue, setLabelValue] = useState(settings.googleAdsLabel || "");

  // Live format validation. Empty value -> no error displayed (we only nag once
  // they've started typing). For Google Ads, the conversion label field is
  // optional, so we only validate it if non-empty.
  const valueValidation = value.trim()
    ? validatePixelField(settingKey as PixelField, value)
    : null;
  const labelValidation = row.platform === "Google Ads" && labelValue.trim()
    ? validatePixelField("googleAdsLabel", labelValue)
    : null;

  const formIsValid =
    !!value.trim() &&
    (valueValidation?.ok !== false) &&
    (labelValidation?.ok !== false);

  const helpText = helpForPlatform(row.platform);

  // Decide the corner badge. Three states, one badge each:
  //   1. Installed — we've already registered a Custom Pixel for this platform
  //   2. Detected as broken — the audit found this platform's old install on the
  //      store but we haven't yet installed a Custom Pixel
  //   3. Available — nothing detected, nothing installed; the merchant can still
  //      add a Custom Pixel for this platform if they want
  let badge: { tone: "success" | "critical" | "info"; label: string };
  if (row.installed) {
    badge = { tone: "success", label: "Installed" };
  } else if (row.detectedAsBroken) {
    badge = { tone: "critical", label: "Will break Aug 26" };
  } else {
    badge = { tone: "info", label: "Available" };
  }

  // Footer caption mirrors the badge state
  let footer: string;
  if (row.installed) {
    footer = "Saving will update the existing Custom Pixel.";
  } else if (row.detectedAsBroken) {
    footer = "We'll register this as a new Custom Pixel in your store.";
  } else {
    footer = "Add this platform to your store as a Custom Pixel.";
  }

  return (
    <Card>
      <Form method="post">
        <input type="hidden" name="intent" value="install" />
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <PlatformIcon platform={row.platform} size={24} />
              <Text as="h2" variant="headingMd">{row.platform}</Text>
            </InlineStack>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </InlineStack>
          {row.detectedAsBroken && row.detectedId && (
            <Text as="p" variant="bodySm" tone="subdued">
              We detected ID <strong>{row.detectedId}</strong> on your store. Confirm or replace it below.
            </Text>
          )}
          <TextField
            label={labelForKey(settingKey)}
            name={settingKey}
            value={value}
            onChange={setValue}
            autoComplete="off"
            placeholder={getFieldExample(settingKey as PixelField)}
            helpText={helpText}
            error={valueValidation && !valueValidation.ok ? valueValidation.error : undefined}
          />
          {row.platform === "Google Ads" && (
            <TextField
              label="Conversion label (purchase event)"
              name="googleAdsLabel"
              value={labelValue}
              onChange={setLabelValue}
              autoComplete="off"
              placeholder={getFieldExample("googleAdsLabel")}
              helpText="Optional. Found in Google Ads > Tools > Conversions > your purchase action."
              error={labelValidation && !labelValidation.ok ? labelValidation.error : undefined}
            />
          )}
          <Divider />
          <InlineStack align="space-between" blockAlign="center">
            <Text as="p" variant="bodySm" tone="subdued">{footer}</Text>
            <Button submit variant="primary" loading={submitting} disabled={!formIsValid}>
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
