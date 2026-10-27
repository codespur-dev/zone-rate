import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} compliance webhook for ${shop}`);

  if (topic === "SHOP_REDACT") {
    await db.$transaction([
      db.shippingZone.deleteMany({
        where: { shop },
      }),
      db.rateSetup.deleteMany({
        where: { shop },
      }),
      db.session.deleteMany({
        where: { shop },
      }),
      db.shop.deleteMany({
        where: { shop },
      }),
    ]);
  }

  // App customer records store nahi karti,
  // isliye customer requests par DB change required nahi.
  return new Response();
};