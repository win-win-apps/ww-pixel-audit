// Unit tests for the WW Pixel Audit scanner classification logic.
// We mock the AdminApiContext.graphql function and assert the scanner produces the right rows.

import { describe, it, expect } from "vitest";
import { runScan } from "../app/services/scanner.server";

// build a mock that returns canned responses keyed by the operation name in the query
function makeAdmin(responses: Record<string, any>) {
  return {
    graphql: async (query: string, _opts?: any) => {
      // crude but deterministic: pick the response whose key appears in the query
      let payload: any = { data: {} };
      for (const [needle, body] of Object.entries(responses)) {
        if (query.includes(needle)) {
          payload = body;
          break;
        }
      }
      return {
        json: async () => payload,
        ok: true,
      } as any;
    },
  } as any;
}

describe("runScan classification", () => {
  it("flags Meta Pixel script tags as broken_aug_26", async () => {
    const admin = makeAdmin({
      "ScanScriptTags": {
        data: {
          scriptTags: {
            edges: [
              {
                cursor: "1",
                node: { id: "gid://shopify/ScriptTag/1", src: "https://connect.facebook.net/en_US/fbevents.js", displayScope: "ONLINE_STORE" },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
      "MainTheme": {
        data: { themes: { nodes: [{ id: "gid://shopify/Theme/100", name: "Dawn" }] } },
      },
      "ThemeFile": {
        data: { theme: { files: { nodes: [] } } },
      },
      "WebPixels": { data: {} },
      "AppInstalls": { data: { appInstallations: { edges: [] } } },
    });

    const result = await runScan(admin);
    expect(result.brokenCount).toBeGreaterThanOrEqual(1);
    const meta = result.trackers.find(t => t.platform === "Meta Pixel" && t.source === "script_tag");
    expect(meta).toBeDefined();
    expect(meta?.status).toBe("broken_aug_26");
    expect(meta?.reason).toMatch(/script tag/i);
  });

  it("flags hardcoded gtag in theme code as broken_aug_26 and extracts the GA4 id", async () => {
    const admin = makeAdmin({
      "ScanScriptTags": {
        data: { scriptTags: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } },
      },
      "MainTheme": {
        data: { themes: { nodes: [{ id: "gid://shopify/Theme/100", name: "Dawn" }] } },
      },
      "ThemeFile": {
        data: {
          theme: {
            files: {
              nodes: [
                {
                  filename: "layout/theme.liquid",
                  body: { content: `<script>gtag('config', 'G-ABC1234567'); fbq('init','12345678901234');</script>` },
                },
              ],
            },
          },
        },
      },
      "WebPixels": { data: {} },
      "AppInstalls": { data: { appInstallations: { edges: [] } } },
    });

    const result = await runScan(admin);
    const ga4 = result.trackers.find(t => t.platform === "Google Analytics 4");
    expect(ga4).toBeDefined();
    expect(ga4?.status).toBe("broken_aug_26");
    expect(ga4?.detectedId).toBe("G-ABC1234567");

    const meta = result.trackers.find(t => t.platform === "Meta Pixel" && t.source === "theme_code");
    expect(meta).toBeDefined();
    expect(meta?.detectedId).toBe("12345678901234");
  });

  it("marks Custom Pixel and sales channel as safe", async () => {
    const admin = makeAdmin({
      "ScanScriptTags": {
        data: { scriptTags: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } },
      },
      "MainTheme": {
        data: { themes: { nodes: [{ id: "gid://shopify/Theme/100", name: "Dawn" }] } },
      },
      "ThemeFile": {
        data: { theme: { files: { nodes: [] } } },
      },
      "WebPixels": {
        data: { webPixel: { id: "gid://shopify/WebPixel/1", settings: "{}" } },
      },
      "AppInstalls": {
        data: {
          appInstallations: {
            edges: [
              { node: { id: "1", app: { id: "1", title: "Google & YouTube", handle: "google" } } },
              { node: { id: "2", app: { id: "2", title: "Facebook & Instagram", handle: "facebook" } } },
            ],
          },
        },
      },
    });

    const result = await runScan(admin);
    expect(result.safeCount).toBeGreaterThanOrEqual(3); // custom pixel + google + facebook
    expect(result.brokenCount).toBe(0);

    const customPixel = result.trackers.find(t => t.source === "custom_pixel");
    expect(customPixel?.status).toBe("safe");

    const googleChannel = result.trackers.find(t => t.source === "sales_channel" && t.platform === "Google Ads");
    expect(googleChannel?.status).toBe("safe");
  });

  it("marks unrecognized custom script tags as unknown, not broken", async () => {
    const admin = makeAdmin({
      "ScanScriptTags": {
        data: {
          scriptTags: {
            edges: [
              { cursor: "1", node: { id: "1", src: "https://example.com/some-affiliate-tracker.js", displayScope: "ONLINE_STORE" } },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
      "MainTheme": {
        data: { themes: { nodes: [{ id: "gid://shopify/Theme/100", name: "Dawn" }] } },
      },
      "ThemeFile": {
        data: { theme: { files: { nodes: [] } } },
      },
      "WebPixels": { data: {} },
      "AppInstalls": { data: { appInstallations: { edges: [] } } },
    });

    const result = await runScan(admin);
    expect(result.unknownCount).toBe(1);
    expect(result.brokenCount).toBe(0);
    const unknown = result.trackers.find(t => t.platform === "Custom JS");
    expect(unknown?.status).toBe("unknown");
  });

  it("dedupes the same platform/source/detail across passes", async () => {
    const admin = makeAdmin({
      "ScanScriptTags": {
        data: {
          scriptTags: {
            edges: [
              { cursor: "1", node: { id: "1", src: "https://connect.facebook.net/en_US/fbevents.js", displayScope: "ONLINE_STORE" } },
              { cursor: "2", node: { id: "2", src: "https://connect.facebook.net/en_US/fbevents.js", displayScope: "ONLINE_STORE" } },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
      "MainTheme": {
        data: { themes: { nodes: [{ id: "gid://shopify/Theme/100", name: "Dawn" }] } },
      },
      "ThemeFile": {
        data: { theme: { files: { nodes: [] } } },
      },
      "WebPixels": { data: {} },
      "AppInstalls": { data: { appInstallations: { edges: [] } } },
    });

    const result = await runScan(admin);
    // even though we returned two identical script tags, dedupe should collapse them
    const metas = result.trackers.filter(t => t.platform === "Meta Pixel" && t.source === "script_tag");
    expect(metas.length).toBe(1);
  });
});
