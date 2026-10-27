import db from "./db.server";

export const STANDARD_SUBSCRIPTION_NAME = "Standard Plan";
export const FREE_ZONE_LIMIT = 1;

const toValidDate = (value) => {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const hasStandardAccess = (shopRecord, now = new Date()) => {
  const accessUntil = toValidDate(shopRecord?.standardAccessUntil);
  return Boolean(accessUntil && accessUntil > now);
};

export async function getShopUsage(shop) {
  return db.shop.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
}

export async function reconcileShopPlan({ admin, shop }) {
  const shopRecord = await getShopUsage(shop);

  let result;

  try {
    const response = await admin.graphql(
      `#graphql
        query CurrentAppSubscriptions {
          currentAppInstallation {
            activeSubscriptions {
              id
              name
              status
              test
              trialDays
              currentPeriodEnd
            }
          }
        }
      `,
    );

    result = await response.json();
  } catch {
    return {
      planId: hasStandardAccess(shopRecord) ? "standard" : "free",
      shopRecord,
      billingCheckFailed: true,
    };
  }

  if (result.errors?.length) {
    return {
      planId: hasStandardAccess(shopRecord) ? "standard" : "free",
      shopRecord,
      billingCheckFailed: true,
    };
  }

  const activeSubscriptions =
    result?.data?.currentAppInstallation?.activeSubscriptions ?? [];

  const standardSubscription = activeSubscriptions.find(
    (subscription) =>
      subscription.status === "ACTIVE" &&
      subscription.name === STANDARD_SUBSCRIPTION_NAME,
  );

  if (standardSubscription) {
    if (shopRecord.cancelAtPeriodEnd && hasStandardAccess(shopRecord)) {
      return {
        planId: "standard",
        shopRecord,
        standardSubscription,
      };
    }

    const currentPeriodEnd = toValidDate(
      standardSubscription.currentPeriodEnd,
    );

    const updatedShop = await db.shop.update({
      where: { shop },
      data: {
        standardAccessUntil: currentPeriodEnd,
        cancelAtPeriodEnd: false,
      },
    });

    return {
      planId: "standard",
      shopRecord: updatedShop,
      standardSubscription,
    };
  }

  if (hasStandardAccess(shopRecord)) {
    return { planId: "standard", shopRecord };
  }

  const freeRecord =
    shopRecord.standardAccessUntil || shopRecord.cancelAtPeriodEnd
      ? await db.shop.update({
          where: { shop },
          data: {
            standardAccessUntil: null,
            cancelAtPeriodEnd: false,
          },
        })
      : shopRecord;

  return { planId: "free", shopRecord: freeRecord };
}

export async function canCreateZone({ shop, planId }) {
  if (planId === "standard") {
    return { allowed: true, planId };
  }

  const shopUsage = await getShopUsage(shop);

  if (shopUsage.freeUploadUsed) {
    return {
      allowed: false,
      planId: "free",
      reason: "FREE_UPLOAD_USED",
      limit: FREE_ZONE_LIMIT,
    };
  }

  const zoneCount = await db.shippingZone.count({ where: { shop } });

  return {
    allowed: zoneCount < FREE_ZONE_LIMIT,
    planId: "free",
    zoneCount,
    limit: FREE_ZONE_LIMIT,
    reason: zoneCount >= FREE_ZONE_LIMIT ? "FREE_ZONE_LIMIT" : null,
  };
}