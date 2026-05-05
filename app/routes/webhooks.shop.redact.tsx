import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GDPR: shop uninstalled 48h ago, remove all their data.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`webhook ${topic} for ${shop} — purging shop data`);
  await prisma.$transaction([
    // detected trackers cascade through scan run, but the run is filtered by shop
    prisma.scanRun.deleteMany({ where: { shop } }),
    prisma.shopConfig.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);
  return new Response();
};
