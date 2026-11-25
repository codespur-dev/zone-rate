import { createHmac, timingSafeEqual } from "node:crypto";

function unauthorized() {
  return new Response(null, { status: 401, statusText: "Unauthorized" });
}

async function verifySessionlessWebhook(request, secret) {
  const rawBody = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get("x-shopify-hmac-sha256");

  if (!secret || !signature) {
    throw unauthorized();
  }

  const actualDigest = Buffer.from(signature, "base64");
  const expectedDigest = createHmac("sha256", secret).update(rawBody).digest();

  if (
    actualDigest.length !== expectedDigest.length ||
    actualDigest.toString("base64") !== signature ||
    !timingSafeEqual(actualDigest, expectedDigest)
  ) {
    throw unauthorized();
  }

  const shop = request.headers.get("x-shopify-shop-domain");
  const rawTopic = request.headers.get("x-shopify-topic");

  if (!shop || !rawTopic) {
    throw new Response(null, { status: 400, statusText: "Bad Request" });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new Response(null, { status: 400, statusText: "Bad Request" });
  }

  return {
    apiVersion: request.headers.get("x-shopify-api-version") || undefined,
    shop,
    topic: rawTopic.replace(/\//g, "_").toUpperCase(),
    webhookId: request.headers.get("x-shopify-webhook-id") || undefined,
    payload,
    session: undefined,
    admin: undefined,
  };
}

export async function authenticateWebhook(
  request,
  libraryAuthenticate,
  secret = process.env.SHOPIFY_API_SECRET || "",
) {
  const fallbackRequest = request.clone();

  try {
    return await libraryAuthenticate(request);
  } catch (error) {
    if (
      !(error instanceof Response) ||
      error.status !== 500 ||
      error.statusText !== "Internal Server Error"
    ) {
      throw error;
    }

    return verifySessionlessWebhook(fallbackRequest, secret);
  }
}

export async function handleAppUninstalledWebhook({
  request,
  authenticate,
  db,
  secret,
}) {
  const { shop, topic } = await authenticateWebhook(
    request,
    authenticate,
    secret,
  );

  console.log(`Received ${topic} webhook for ${shop}`);

  await db.$transaction([
    db.shippingZone.deleteMany({ where: { shop } }),
    db.rateSetup.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
    db.shop.upsert({
      where: { shop },
      update: {
        appProfileId: null,
        appLocationGroupId: null,
        cancelAtPeriodEnd: true,
      },
      create: { shop, cancelAtPeriodEnd: true },
    }),
  ]);

  return new Response();
}

export async function handleComplianceWebhook({
  request,
  authenticate,
  db,
  secret,
}) {
  const { shop, topic } = await authenticateWebhook(
    request,
    authenticate,
    secret,
  );

  console.log(`Received ${topic} compliance webhook for ${shop}`);

  if (topic === "SHOP_REDACT") {
    await db.$transaction([
      db.shippingZone.deleteMany({ where: { shop } }),
      db.rateSetup.deleteMany({ where: { shop } }),
      db.session.deleteMany({ where: { shop } }),
      db.shop.deleteMany({ where: { shop } }),
    ]);
  }

  return new Response();
}
