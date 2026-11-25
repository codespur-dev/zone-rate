import { authenticate } from "../shopify.server";
import db from "../db.server";
import { handleAppUninstalledWebhook } from "../webhooks.server";

export const action = async ({ request }) => {
  return handleAppUninstalledWebhook({
    request,
    authenticate: authenticate.webhook,
    db,
  });
};