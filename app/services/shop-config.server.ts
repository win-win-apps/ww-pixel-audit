// Minimal shop config helpers for WW Pixel Audit V1.
// One row per shop, holds plan + alertEmail + last scan timestamp.

import prisma from "../db.server";

export async function getOrCreateShopConfig(shop: string) {
  const existing = await prisma.shopConfig.findUnique({ where: { shop } });
  if (existing) return existing;
  return prisma.shopConfig.create({
    data: { shop },
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
