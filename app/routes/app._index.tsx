// WW Pixel Audit — main page.
// On load: shows the latest scan summary if any, plus a big "Run a fresh scan" button.
// On scan: kicks off runScan() and renders the Migration Readiness Report.

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  InlineStack,
  Box,
  Badge,
  Button,
  DataTable,
  Banner,
  Divider,
  Tooltip,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateShopConfig, markScanCompleted } from "../services/shop-config.server";
import { runScan } from "../services/scanner.server";
import { estimateRevenueAtRisk } from "../services/revenue-estimator.server";
import { readEntitlements } from "../services/entitlements.server";
import { hasPro, type Plan } from "../lib/plans";
import { statusToBadgeTone, statusToLabel, sourceToLabel, type TrackerStatus, type TrackerSource } from "../lib/tracker-labels";
import { redirectUrl } from "../services/embedded-redirect.server";

const DEADLINE_LABEL = "August 26, 2026";
const DEADLINE_ISO = "2026-08-26T00:00:00Z";

function daysUntilDeadline(now: Date = new Date()): number {
  const deadline = new Date(DEADLINE_ISO).getTime();
  const ms = deadline - now.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function tooltipForStatus(status: TrackerStatus): string {
  if (status === "broken_aug_26") {
    return "This tracker lives somewhere that stops firing on August 26, 2026. Move it to a Custom Pixel or rely on the official sales channel before the deadline.";
  }
  if (status === "safe") {
    return "This tracker is on the upgraded path (Custom Pixel or sales channel) and keeps firing after the deadline.";
  }
  return "We found a custom script we couldn't classify. Check the source URL to see what it does.";
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency || "USD"} ${Math.round(amount)}`;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  await getOrCreateShopConfig(shop);

  // entitlements (also mirrors plan to ShopConfig)
  const ent = await readEntitlements(admin, shop);

  // most recent completed scan
  const lastScan = await prisma.scanRun.findFirst({
    where: { shop, status: "ok" },
    orderBy: { startedAt: "desc" },
    include: {
      trackers: {
        orderBy: [{ status: "asc" }, { platform: "asc" }],
      },
    },
  });

  return json({ shop, lastScan, plan: ent.plan });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  if (intent !== "scan") {
    return json({ ok: false, error: "Unknown action." }, { status: 400 });
  }

  const startedAt = new Date();
  const title = `Scan ${startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;

  const run = await prisma.scanRun.create({
    data: {
      shop,
      title,
      description: "Manual scan triggered from the dashboard.",
      status: "running",
    },
  });

  try {
    const result = await runScan(admin);
    // Estimate revenue at risk in parallel-ish; doesn't block the scan if it fails.
    const revenue = await estimateRevenueAtRisk(admin, result.trackers);

    await prisma.scanRun.update({
      where: { id: run.id },
      data: {
        status: "ok",
        finishedAt: new Date(),
        totalFound: result.totalFound,
        brokenCount: result.brokenCount,
        unknownCount: result.unknownCount,
        safeCount: result.safeCount,
        weeklyRevenue: revenue?.weeklyRevenue ?? null,
        atRiskRevenue: revenue?.atRiskRevenue ?? null,
        atRiskPct:     revenue?.atRiskPct ?? null,
        currency:      revenue?.currency ?? null,
        trackers: {
          create: result.trackers.map((t) => ({
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
    await markScanCompleted(shop);
  } catch (err) {
    await prisma.scanRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: (err as Error).message,
      },
    });
  }

  return redirect(redirectUrl(request, "/app"));
};

export default function AuditDashboard() {
  const { shop, lastScan, plan } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const isScanning = nav.state !== "idle" && nav.formData?.get("intent") === "scan";
  const merchantHasPro = hasPro(plan);
  const brokenCount = lastScan?.brokenCount ?? 0;

  return (
    <Page title="WW Pixel Audit" subtitle={`Connected: ${shop}`}>
      <Layout>
        {/* Top status panel */}
        <Layout.Section>
          <StatusPanel
            lastScan={lastScan}
            isScanning={Boolean(isScanning)}
            plan={plan}
          />
        </Layout.Section>

        {/* Pro upsell — only when there's something to fix and merchant is on free */}
        {!merchantHasPro && brokenCount > 0 && (
          <Layout.Section>
            <Banner
              tone="info"
              title="Pro installs the fix in one click"
              action={{ content: "See plans", url: "/app/upgrade" }}
            >
              <p>
                We can register a Custom Pixel for each of these {brokenCount} broken trackers so they keep firing after August 26. Pro is $29/mo, no trial, cancel any time.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {/* Always-on deadline banner */}
        <Layout.Section>
          <Banner tone="warning">
            <Text as="p" variant="bodyMd">
              Shopify retires Additional Scripts and the legacy Thank You / Order Status pages on {DEADLINE_LABEL}. Anything in those boxes will stop firing on that date.
            </Text>
          </Banner>
        </Layout.Section>

        {/* Report table */}
        {lastScan && lastScan.trackers.length > 0 && (
          <Layout.Section>
            <ReportTable scanId={lastScan.id} trackers={lastScan.trackers as any} hasPro={merchantHasPro} />
          </Layout.Section>
        )}

        {/* Empty state — only shown if no scan has ever been run on this shop */}
        {!lastScan && (
          <Layout.Section>
            <Card>
              <BlockStack gap="200" align="center">
                <Text as="h2" variant="headingMd" alignment="center">No scans yet</Text>
                <Text as="p" variant="bodyMd" alignment="center" tone="subdued">
                  Click "Run my first scan" above to see what tracking pixels are installed on your store and which ones will stop working on {DEADLINE_LABEL}.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}

function StatusPanel({
  lastScan,
  isScanning,
  plan,
}: {
  lastScan: any;
  isScanning: boolean;
  plan: Plan;
}) {
  const broken = lastScan?.brokenCount ?? 0;
  const unknown = lastScan?.unknownCount ?? 0;
  const safe = lastScan?.safeCount ?? 0;
  const total = lastScan?.totalFound ?? 0;

  let headline: string;
  let tone: "success" | "warning" | "critical" | "info";
  if (!lastScan) {
    headline = "Run your first scan to see what's installed and what will break.";
    tone = "info";
  } else if (broken > 0) {
    headline = `${broken} tracker${broken === 1 ? "" : "s"} will stop working on ${DEADLINE_LABEL}.`;
    tone = "critical";
  } else if (unknown > 0) {
    headline = `${unknown} tracker${unknown === 1 ? "" : "s"} need a closer look.`;
    tone = "warning";
  } else if (total > 0) {
    headline = "You're all set. Every tracker we found is on the safe path.";
    tone = "success";
  } else {
    headline = "We did not find any tracking pixels on your store. If you run ads on Meta or Google, double-check that your tracking is set up.";
    tone = "info";
  }

  const days = daysUntilDeadline();
  const countdownTone: "critical" | "warning" | "info" = days <= 30 ? "critical" : days <= 60 ? "warning" : "info";

  const atRiskRevenue = lastScan?.atRiskRevenue ?? null;
  const atRiskPct = lastScan?.atRiskPct ?? null;
  const currency = lastScan?.currency ?? "USD";

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start" wrap={false}>
          <BlockStack gap="100">
            <Text as="h2" variant="headingLg">Migration readiness</Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              We check four places where tracking code can hide on your store.
            </Text>
          </BlockStack>
          <BlockStack gap="200" align="end">
            <InlineStack gap="200" blockAlign="center">
              <Badge tone={countdownTone}>
                {days === 0 ? "Deadline reached" : `${days} day${days === 1 ? "" : "s"} until Aug 26`}
              </Badge>
              <Badge tone={plan === "free" ? undefined : "success"}>
                {plan === "agency" ? "Agency" : plan === "pro" ? "Pro" : "Free"}
              </Badge>
            </InlineStack>
            <Form method="post">
              <input type="hidden" name="intent" value="scan" />
              <Button
                variant="primary"
                size="large"
                loading={isScanning}
                submit
              >
                {lastScan ? "Run a fresh scan" : "Run my first scan"}
              </Button>
            </Form>
          </BlockStack>
        </InlineStack>
        <Divider />
        <Banner tone={tone}>
          <Text as="p" variant="headingMd">{headline}</Text>
        </Banner>
        {lastScan && (
          <InlineStack gap="400" wrap={true}>
            <CountTile label="Will break Aug 26" value={broken} tone="critical" />
            <CountTile label="Need a closer look" value={unknown} tone="warning" />
            <CountTile label="Already safe" value={safe} tone="success" />
            <CountTile label="Total found" value={total} tone="info" />
            {atRiskRevenue !== null && atRiskRevenue > 0 && (
              <RevenueTile
                amount={atRiskRevenue}
                pct={atRiskPct ?? 0}
                currency={currency}
              />
            )}
          </InlineStack>
        )}
        <Text as="p" variant="bodySm" tone="subdued">
          Free forever. No setup fees, no required consulting calls.
        </Text>
        {lastScan && (
          <Text as="p" variant="bodySm" tone="subdued">
            Last scan: {new Date(lastScan.startedAt).toLocaleString()}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

function CountTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "critical" | "info";
}) {
  return (
    <Box
      padding="400"
      background="bg-surface-secondary"
      borderRadius="200"
      minWidth="160px"
    >
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
        <InlineStack gap="200" blockAlign="center">
          <Text as="p" variant="heading2xl">{String(value)}</Text>
          <Badge tone={tone}>
            {tone === "critical" ? "Action needed"
              : tone === "warning" ? "Review"
              : tone === "success" ? "Safe"
              : "—"}
          </Badge>
        </InlineStack>
      </BlockStack>
    </Box>
  );
}

function FixCell({
  platform,
  status,
  hasPro: merchantHasPro,
}: {
  platform: string;
  status: TrackerStatus;
  hasPro: boolean;
}) {
  if (status !== "broken_aug_26") {
    return <Text as="span" variant="bodySm" tone="subdued">—</Text>;
  }
  if (merchantHasPro) {
    return (
      <Button url="/app/fix" variant="primary" size="slim">
        Fix it
      </Button>
    );
  }
  return (
    <Tooltip content="Pro auto-installs a Custom Pixel for this tracker so it survives Aug 26.">
      <Button url="/app/upgrade" variant="primary" size="slim" tone="success">
        Fix with Pro
      </Button>
    </Tooltip>
  );
}

function RevenueTile({
  amount,
  pct,
  currency,
}: {
  amount: number;
  pct: number;
  currency: string;
}) {
  return (
    <Box
      padding="400"
      background="bg-surface-secondary"
      borderRadius="200"
      minWidth="220px"
    >
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          Weekly revenue at risk (estimate)
        </Text>
        <InlineStack gap="200" blockAlign="center">
          <Text as="p" variant="heading2xl">{formatMoney(amount, currency)}</Text>
          <Badge tone="critical">{`${pct}%`}</Badge>
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          Last 7 days from channels whose pixels will break.
        </Text>
      </BlockStack>
    </Box>
  );
}

function ReportTable({ trackers, scanId, hasPro: merchantHasPro }: {
  scanId: number;
  hasPro: boolean;
  trackers: Array<{
    id: number;
    platform: string;
    detectedId: string | null;
    source: TrackerSource;
    sourceDetail: string | null;
    status: TrackerStatus;
    reason: string;
    recommendation: string | null;
  }>;
}) {
  // sort: broken first, then unknown, then safe
  const sortOrder: Record<TrackerStatus, number> = { broken_aug_26: 0, unknown: 1, safe: 2 };
  const sorted = [...trackers].sort((a, b) => {
    const sa = sortOrder[a.status] ?? 99;
    const sb = sortOrder[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    return a.platform.localeCompare(b.platform);
  });

  const rows = sorted.map((t) => [
    (
      <BlockStack gap="100" key={`p-${t.id}`}>
        <Text as="span" variant="bodyMd" fontWeight="semibold">{t.platform}</Text>
        {t.detectedId && (
          <Text as="span" variant="bodySm" tone="subdued">ID: {t.detectedId}</Text>
        )}
      </BlockStack>
    ),
    (
      <BlockStack gap="100" key={`s-${t.id}`}>
        <Text as="span" variant="bodyMd">{sourceToLabel(t.source)}</Text>
        {t.sourceDetail && (
          <Text as="span" variant="bodySm" tone="subdued" truncate>{t.sourceDetail}</Text>
        )}
      </BlockStack>
    ),
    (
      <Tooltip key={`b-${t.id}`} content={tooltipForStatus(t.status)}>
        <Badge tone={statusToBadgeTone(t.status)}>{statusToLabel(t.status)}</Badge>
      </Tooltip>
    ),
    (
      <BlockStack gap="100" key={`r-${t.id}`}>
        <Text as="span" variant="bodyMd">{t.reason}</Text>
        {t.recommendation && (
          <Text as="span" variant="bodySm" tone="subdued">→ {t.recommendation}</Text>
        )}
      </BlockStack>
    ),
    (
      <FixCell
        key={`f-${t.id}`}
        platform={t.platform}
        status={t.status}
        hasPro={merchantHasPro}
      />
    ),
  ]);

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">Detected trackers</Text>
          <Button url={`/api/scan/${scanId}/csv`} target="_top">Download CSV</Button>
        </InlineStack>
        <DataTable
          columnContentTypes={["text", "text", "text", "text", "text"]}
          headings={["Platform", "Where it lives", "Status", "What we recommend", "Action"]}
          rows={rows}
          verticalAlign="top"
        />
      </BlockStack>
    </Card>
  );
}
