// Scan history — list of past scan runs.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  DataTable,
  Badge,
  EmptyState,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const runs = await prisma.scanRun.findMany({
    where: { shop: session.shop },
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  return json({ runs });
};

export default function HistoryPage() {
  const { runs } = useLoaderData<typeof loader>();

  if (!runs.length) {
    return (
      <Page title="Scan history" backAction={{ content: "Audit", url: "/app" }}>
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState heading="No scans yet" image="">
                <p>Run your first scan from the Audit page to see it here.</p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const rows = runs.map((r: any) => [
    new Date(r.startedAt).toLocaleString(),
    (
      <Badge tone={r.status === "ok" ? "success" : r.status === "failed" ? "critical" : "info"} key={`s-${r.id}`}>
        {r.status}
      </Badge>
    ),
    String(r.totalFound),
    String(r.brokenCount),
    String(r.unknownCount),
    String(r.safeCount),
  ]);

  return (
    <Page title="Scan history" backAction={{ content: "Audit", url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Past scans</Text>
              <DataTable
                columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "numeric"]}
                headings={["When", "Status", "Total found", "Will break", "Need a look", "Safe"]}
                rows={rows}
              />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
