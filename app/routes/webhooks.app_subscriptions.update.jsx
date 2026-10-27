import { authenticate } from "../shopify.server";
import db from "../db.server";

const parseDate = (value) => {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const action = async ({ request }) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  const status = String(payload?.status || "").toUpperCase();
  const periodEnd = parseDate(
    payload?.current_period_end || payload?.currentPeriodEnd,
  );

  console.log(`Received ${topic} webhook for ${shop}`);

  const existingShop = await db.shop.findUnique({
    where: { shop },
  });

  if (status === "ACTIVE") {
    await db.shop.upsert({
      where: { shop },
      update: {
        trialUsedAt: existingShop?.trialUsedAt || new Date(),
        standardAccessUntil:
          periodEnd || existingShop?.standardAccessUntil || null,
        cancelAtPeriodEnd: false,
      },
      create: {
        shop,
        trialUsedAt: new Date(),
        standardAccessUntil: periodEnd,
      },
    });

    return new Response();
  }

  const paidAccessUntil =
    periodEnd && periodEnd > new Date()
      ? periodEnd
      : existingShop?.cancelAtPeriodEnd &&
          existingShop.standardAccessUntil > new Date()
        ? existingShop.standardAccessUntil
        : null;

  await db.shop.upsert({
    where: { shop },
    update: {
      standardAccessUntil: paidAccessUntil,
      cancelAtPeriodEnd: Boolean(paidAccessUntil),
    },
    create: {
      shop,
      standardAccessUntil: paidAccessUntil,
      cancelAtPeriodEnd: Boolean(paidAccessUntil),
    },
  });

  return new Response();
};