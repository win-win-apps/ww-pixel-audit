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
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateShopConfig, markScanCompleted } from "../services/shop-config.server";
import { runScan } from "../services/scanner.server";
import { statusToBadgeTone, statusToLabel, sourceToLabel, type TrackerStatus, type TrackerSource } from "../lib/tracker-labels";
import { redirectUrl } from "../services/embedded-redirect.server";

const DEADLINE_LABEL = "August 26, 2026";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  await getOrCreateShopConfig(shop);

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

  return json({ shop, lastScan });
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
    await prisma.scanRun.update({
      where: { id: run.id },
      data: {
        status: "ok",
        finishedAt: new Date(),
        totalFound: result.totalFound,
        brokenCount: result.brokenCount,
        unknownCount: result.unknownCount,
        safeCount: result.safeCount,
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
  const { shop, lastScan } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const isScanning = nav.state !== "idle" && nav.formData?.get("intent") === "scan";

  return (
    <Page title="WW Pixel Audit" subtitle={`Connected: ${shop}`}>
      <Layout>
        {/* Top status panel */}
        <Layout.Section>
          <StatusPanel
            lastScan={lastScan}
            isScanning={Boolean(isScanning)}
          />
        </Layout.Section>

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
            <ReportTable trackers={lastScan.trackers as any} />
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
}: {
  lastScan: any;
  isScanning: boolean;
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

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h2" variant="headingLg">Migration readiness</Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              We scan your script tags, theme code, Custom Pixels, and sales channels.
            </Text>
          </BlockStack>
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
        </InlineStack>
        <Divider />
        <Banner tone={tone}>
          <Text as="p" variant="headingMd">{headline}</Text>
        </Banner>
        {lastScan && (
          <InlineStack gap="400" wrap={false}>
            <CountTile label="Will break Aug 26" value={broken} tone="critical" />
            <CountTile label="Need a closer look" value={unknown} tone="warning" />
            <CountTile label="Already safe" value={safe} tone="success" />
            <CountTile label="Total found" value={total} tone="info" />
          </InlineStack>
        )}
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

function ReportTable({ trackers }: { trackers: Array<{
  id: number;
  platform: string;
  detectedId: string | null;
  source: TrackerSource;
  sourceDetail: string | null;
  status: TrackerStatus;
  reason: string;
  recommendation: string | null;
}>}) {
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
    (<Badge tone={statusToBadgeTone(t.status)} key={`b-${t.id}`}>{statusToLabel(t.status)}</Badge>),
    (
      <BlockStack gap="100" key={`r-${t.id}`}>
        <Text as="span" variant="bodyMd">{t.reason}</Text>
        {t.recommendation && (
          <Text as="span" variant="bodySm" tone="subdued">→ {t.recommendation}</Text>
        )}
      </BlockStack>
    ),
  ]);

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">Detected trackers</Text>
        <DataTable
          columnContentTypes={["text", "text", "text", "text"]}
          headings={["Platform", "Where it lives", "Status", "What we recommend"]}
          rows={rows}
          verticalAlign="top"
        />
      </BlockStack>
    </Card>
  );
}
