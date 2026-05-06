// Pixel ID format validators. Each platform has a documented format —
// catching typos client-side saves the merchant a round-trip and avoids
// registering a Custom Pixel that won't fire because of a bad ID.
//
// Patterns sourced from each platform's public docs as of 2026-05.

export type PixelField =
  | "metaPixelId"
  | "googleAdsId"
  | "googleAdsLabel"
  | "tiktokPixelId"
  | "klaviyoCompanyId"
  | "pinterestTagId";

interface FormatRule {
  pattern: RegExp;
  example: string;
  hint: string;
}

const RULES: Record<PixelField, FormatRule> = {
  metaPixelId: {
    pattern: /^\d{15,16}$/,
    example: "1234567890123456",
    hint: "Meta Pixel IDs are 15 or 16 digits, numbers only.",
  },
  googleAdsId: {
    pattern: /^AW-\d{9,11}$/,
    example: "AW-1234567890",
    hint: "Google Ads conversion IDs start with AW- followed by 9 to 11 digits.",
  },
  googleAdsLabel: {
    // base64-like, typically 11 chars but ranges 6-30
    pattern: /^[A-Za-z0-9_-]{6,30}$/,
    example: "AbC-D_efGhIjK",
    hint: "Conversion labels are 6 to 30 characters, letters / digits / underscores / hyphens.",
  },
  tiktokPixelId: {
    pattern: /^[A-Z0-9]{19,20}$/,
    example: "CXXXXXXXXXXXXXXXXXXX",
    hint: "TikTok Pixel IDs are 19 or 20 uppercase letters and digits.",
  },
  klaviyoCompanyId: {
    pattern: /^[A-Za-z0-9]{6}$/,
    example: "AbCdEf",
    hint: "Klaviyo Company IDs (Public API Key) are exactly 6 alphanumeric characters.",
  },
  pinterestTagId: {
    pattern: /^\d{13}$/,
    example: "2612345678901",
    hint: "Pinterest Tag IDs are 13 digits.",
  },
};

export function validatePixelField(
  field: PixelField,
  value: string,
): { ok: true } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "Required." };
  const rule = RULES[field];
  if (!rule.pattern.test(trimmed)) {
    return { ok: false, error: rule.hint };
  }
  return { ok: true };
}

export function getFieldExample(field: PixelField): string {
  return RULES[field].example;
}

export function getFieldHint(field: PixelField): string {
  return RULES[field].hint;
}
