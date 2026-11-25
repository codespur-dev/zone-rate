import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  authenticateWebhook,
  handleAppUninstalledWebhook,
  handleComplianceWebhook,
} from "../app/webhooks.server.js";

const SECRET = "webhook-test-secret";
const SHOP = "review-shop.myshopify.com";

function createWebhookRequest(topic, body, signatureOverride) {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const signature =
    signatureOverride ||
    createHmac("sha256", SECRET).update(rawBody).digest("base64");

  return new Request("https://app.example/webhooks", {
    method: "POST",
    headers: {
      "x-shopify-hmac-sha256": signature,
      "x-shopify-shop-domain": SHOP,
      "x-shopify-topic": topic,
      "x-shopify-api-version": "2026-07",
      "x-shopify-webhook-id": "webhook-test-id",
    },
    body: rawBody,
  });
}

async function failWithExpiredRefresh(request) {
  await request.text();
  throw new Response(null, {
    status: 500,
    statusText: "Internal Server Error",
  });
}

function createDatabaseMock() {
  const calls = [];
  const operation = (model, method) => (input) => {
    calls.push({ model, method, input });
    return Promise.resolve({ count: 0 });
  };

  return {
    calls,
    shippingZone: { deleteMany: operation("shippingZone", "deleteMany") },
    rateSetup: { deleteMany: operation("rateSetup", "deleteMany") },
    session: { deleteMany: operation("session", "deleteMany") },
    shop: {
      deleteMany: operation("shop", "deleteMany"),
      upsert: operation("shop", "upsert"),
    },
    $transaction: (operations) => Promise.all(operations),
  };
}

test("valid HMAC falls back to a sessionless webhook context", async () => {
  const request = createWebhookRequest("app/uninstalled", { id: 1 });
  const context = await authenticateWebhook(
    request,
    failWithExpiredRefresh,
    SECRET,
  );

  assert.equal(context.shop, SHOP);
  assert.equal(context.topic, "APP_UNINSTALLED");
  assert.deepEqual(context.payload, { id: 1 });
  assert.equal(context.session, undefined);
  assert.equal(context.admin, undefined);
});

test("invalid HMAC returns 401 without running uninstall cleanup", async () => {
  const db = createDatabaseMock();
  const request = createWebhookRequest(
    "app/uninstalled",
    "not-json",
    "invalid-signature",
  );

  await assert.rejects(
    () =>
      handleAppUninstalledWebhook({
        request,
        authenticate: failWithExpiredRefresh,
        db,
        secret: SECRET,
      }),
    (error) => error instanceof Response && error.status === 401,
  );
  assert.equal(db.calls.length, 0);
});

test("repeated app/uninstalled deliveries perform idempotent local cleanup", async () => {
  const db = createDatabaseMock();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await handleAppUninstalledWebhook({
      request: createWebhookRequest("app/uninstalled", { id: 1 }),
      authenticate: failWithExpiredRefresh,
      db,
      secret: SECRET,
    });
    assert.equal(response.status, 200);
  }

  assert.equal(
    db.calls.filter(({ method }) => method === "deleteMany").length,
    6,
  );
  const shopUpdates = db.calls.filter(
    ({ model, method }) => model === "shop" && method === "upsert",
  );
  assert.equal(shopUpdates.length, 2);
  assert.equal(shopUpdates[0].input.update.cancelAtPeriodEnd, true);
  assert.equal(shopUpdates[0].input.create.cancelAtPeriodEnd, true);
});

test("repeated shop/redact deliveries erase stored data and return 200", async () => {
  const db = createDatabaseMock();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await handleComplianceWebhook({
      request: createWebhookRequest("shop/redact", { id: 1 }),
      authenticate: failWithExpiredRefresh,
      db,
      secret: SECRET,
    });
    assert.equal(response.status, 200);
  }

  assert.deepEqual(
    db.calls.map(({ model, method }) => `${model}.${method}`),
    [
      "shippingZone.deleteMany",
      "rateSetup.deleteMany",
      "session.deleteMany",
      "shop.deleteMany",
      "shippingZone.deleteMany",
      "rateSetup.deleteMany",
      "session.deleteMany",
      "shop.deleteMany",
    ],
  );
});

test("customer compliance requests return 200 when no customer data is stored", async () => {
  const db = createDatabaseMock();

  for (const topic of ["customers/data_request", "customers/redact"]) {
    const response = await handleComplianceWebhook({
      request: createWebhookRequest(topic, { id: 1 }),
      authenticate: failWithExpiredRefresh,
      db,
      secret: SECRET,
    });
    assert.equal(response.status, 200);
  }

  assert.equal(db.calls.length, 0);
});
