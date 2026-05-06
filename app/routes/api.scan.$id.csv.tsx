// CSV download of a scan's Migration Readiness Report.
// Useful for sharing with developers or agencies.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { statusToLabel, sourceToLabel, type TrackerStatus, type TrackerSource } from "../lib/tracker-labels";

function csvEscape(value: string | null | undefined): string {
  const v = value == null ? "" : String(value);
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const id = parseInt(String(params.id), 10);
  if (!Number.isFinite(id)) return new Response("Bad scan id", { status: 400 });

  const run = await prisma.scanRun.findFirst({
    where: { id, shop: session.shop },
    include: {
      trackers: { orderBy: [{ status: "asc" }, { platform: "asc" }] },
    },
  });
  if (!run) return new Response("Scan not found", { status: 404 });

  const lines: string[] = [];
  lines.push("# WW Pixel Audit — Migration Readiness Report");
  lines.push(`# Scan: ${run.title}`);
  lines.push(`# Started: ${new Date(run.startedAt).toISOString()}`);
  lines.push(`# Total found: ${run.totalFound}`);
  lines.push(`# Will break Aug 26: ${run.brokenCount}`);
  lines.push(`# Need a closer look: ${run.unknownCount}`);
  lines.push(`# Already safe: ${run.safeCount}`);
  if (run.atRiskRevenue != null) {
    lines.push(`# Estimated weekly revenue at risk: ${run.atRiskRevenue} ${run.currency || "USD"} (${run.atRiskPct ?? 0}% of last 7 days)`);
  }
  lines.push("");
  lines.push(["Platform", "Detected ID", "Where it lives", "Source detail", "Status", "Why", "Recommendation"].join(","));

  for (const t of run.trackers) {
    lines.push([
      csvEscape(t.platform),
      csvEscape(t.detectedId),
      csvEscape(sourceToLabel(t.source as TrackerSource)),
      csvEscape(t.sourceDetail),
      csvEscape(statusToLabel(t.status as TrackerStatus)),
      csvEscape(t.reason),
      csvEscape(t.recommendation),
    ].join(","));
  }

  const filename = `ww-pixel-audit-scan-${run.id}.csv`;
  return new Response(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
