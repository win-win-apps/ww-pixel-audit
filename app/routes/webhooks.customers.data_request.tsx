import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// GDPR: merchant's customer requests their data.
// WW Pixel Audit does not store customer PII, so there's nothing to return.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`webhook ${topic} for ${shop} — no PII stored`);
  return new Response();
};
