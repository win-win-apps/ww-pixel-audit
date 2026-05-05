import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// GDPR: redact customer data. No customer data stored here, so this is a no-op.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`webhook ${topic} for ${shop} — no PII stored`);
  return new Response();
};
