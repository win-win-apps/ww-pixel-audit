// Minimal shop config helpers for WW Pixel Audit V1.
// One row per shop, holds plan + alertEmail + last scan timestamp.

import prisma from "../db.server";

// Upsert is atomic: avoids the race where two concurrent loaders both see no row,
// both try to insert, and the second hits a unique-constraint error on `shop`.
export async function getOrCreateShopConfig(shop: string) {
  return prisma.shopConfig.upsert({
    where: { shop },
    create: { shop },
    update: {}, // no-op when row already exists
  });
}

export async function updateShopConfig(
  shop: string,
  data: Partial<{ plan: string; alertEmail: string | null; onboardedAt: Date | null }>,
) {
  return prisma.shopConfig.update({
    where: { shop },
    data,
  });
}

export async function markScanCompleted(shop: string) {
  return prisma.shopConfig.update({
    where: { shop },
    data: { lastScanAt: new Date() },
  });
}
