import { authenticate } from "../shopify.server";
import db from "../db.server";
import { handleComplianceWebhook } from "../webhooks.server";

export const action = async ({ request }) => {
  return handleComplianceWebhook({
    request,
    authenticate: authenticate.webhook,
    db,
  });
};