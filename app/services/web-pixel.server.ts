// Wraps the webPixelCreate / webPixelUpdate / webPixelDelete mutations.
// Settings shape MUST match shopify.extension.toml of ww-pixel-relay.

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";

export interface PixelSettings {
  metaPixelId?: string;
  googleAdsId?: string;
  googleAdsLabel?: string;
  tiktokPixelId?: string;
  klaviyoCompanyId?: string;
  pinterestTagId?: string;
}

const SETTING_KEYS: (keyof PixelSettings)[] = [
  "metaPixelId",
  "googleAdsId",
  "googleAdsLabel",
  "tiktokPixelId",
  "klaviyoCompanyId",
  "pinterestTagId",
];

function clean(s: PixelSettings): Record<string, string> {
  // Web pixel settings schema requires every defined field to be present in the
  // input. We always send all 6 keys, defaulting to empty strings. The runtime
  // (extensions/ww-pixel-relay/src/index.js) skips initialization for any field
  // whose value is falsy, so empty strings are equivalent to "platform off".
  const out: Record<string, string> = {};
  for (const k of SETTING_KEYS) {
    const v = s[k];
    out[k] = typeof v === "string" && v.trim() ? v.trim() : "";
  }
  return out;
}

export async function readPixelSettings(shop: string): Promise<PixelSettings> {
  const cfg = await prisma.shopConfig.findUnique({ where: { shop } });
  if (!cfg?.pixelSettingsJson) return {};
  try {
    return JSON.parse(cfg.pixelSettingsJson) as PixelSettings;
  } catch {
    return {};
  }
}

export async function upsertWebPixel(
  admin: AdminApiContext,
  shop: string,
  partial: PixelSettings,
): Promise<{ ok: true; webPixelId: string; settings: PixelSettings } | { ok: false; error: string }> {
  // Merge with whatever's already saved so callers can update one field at a time.
  const existing = await readPixelSettings(shop);
  const merged: PixelSettings = { ...existing, ...partial };
  const cfg = await prisma.shopConfig.findUnique({ where: { shop } });
  const cleanSettings = clean(merged);

  // If we already have a webPixelId saved, update; otherwise create.
  let mutation = "create";
  let response: any;

  if (cfg?.webPixelId) {
    mutation = "update";
    const res = await admin.graphql(
      `#graphql
        mutation WebPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
          webPixelUpdate(id: $id, webPixel: $webPixel) {
            webPixel { id settings }
            userErrors { field message code }
          }
        }
      `,
      { variables: { id: cfg.webPixelId, webPixel: { settings: cleanSettings } } },
    );
    response = await res.json();
  } else {
    const res = await admin.graphql(
      `#graphql
        mutation WebPixelCreate($webPixel: WebPixelInput!) {
          webPixelCreate(webPixel: $webPixel) {
            webPixel { id settings }
            userErrors { field message code }
          }
        }
      `,
      { variables: { webPixel: { settings: cleanSettings } } },
    );
    response = await res.json();
  }

  const root = mutation === "update"
    ? response?.data?.webPixelUpdate
    : response?.data?.webPixelCreate;
  const userErrors = root?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      ok: false,
      error: userErrors.map((e: any) => `${(e.field || []).join(".")}: ${e.message}`).join("; "),
    };
  }

  const webPixelId: string | undefined = root?.webPixel?.id;
  if (!webPixelId) {
    return { ok: false, error: "Mutation returned no webPixel id" };
  }

  await prisma.shopConfig.upsert({
    where: { shop },
    create: { shop, webPixelId, pixelSettingsJson: JSON.stringify(merged) },
    update: { webPixelId, pixelSettingsJson: JSON.stringify(merged) },
  });

  return { ok: true, webPixelId, settings: merged };
}

export async function deleteWebPixel(
  admin: AdminApiContext,
  shop: string,
): Promise<boolean> {
  const cfg = await prisma.shopConfig.findUnique({ where: { shop } });
  if (!cfg?.webPixelId) return true;
  try {
    await admin.graphql(
      `#graphql
        mutation WebPixelDelete($id: ID!) {
          webPixelDelete(id: $id) {
            deletedWebPixelId
            userErrors { field message code }
          }
        }
      `,
      { variables: { id: cfg.webPixelId } },
    );
    await prisma.shopConfig.update({
      where: { shop },
      data: { webPixelId: null, pixelSettingsJson: null },
    });
    return true;
  } catch {
    return false;
  }
}

// Map a tracker platform name (from scanner.server.ts) to the field name in our settings schema.
export const PLATFORM_TO_SETTING: Record<string, keyof PixelSettings | null> = {
  "Meta Pixel":          "metaPixelId",
  "Google Ads":          "googleAdsId",
  "Google Tag Manager":  null, // GTM is a container; we replace its underlying tags directly
  "Google Analytics 4":  null, // The Google channel app handles GA4
  "TikTok Pixel":        "tiktokPixelId",
  "Klaviyo Onsite":      "klaviyoCompanyId",
  "Pinterest Tag":       "pinterestTagId",
  "Snap Pixel":          null,
  "Bing UET":            null,
  "Reddit Pixel":        null,
};
