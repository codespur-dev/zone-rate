import { authenticate } from "../shopify.server";
import db from "../db.server";

async function removeShopifyShippingConfiguration({ admin, shop }) {
  if (!admin) return;

  const [shopRecord, activeZones] = await Promise.all([
    db.shop.findUnique({ where: { shop } }),
    db.shippingZone.findMany({
      where: {
        shop,
        status: "ACTIVE",
        shopifyProfileId: { not: null },
        shopifyZoneId: { not: null },
      },
      select: {
        shopifyProfileId: true,
        shopifyZoneId: true,
      },
    }),
  ]);

  if (shopRecord?.appProfileId) {
    await admin.graphql(
      `#graphql
        mutation RemoveAppDeliveryProfile($id: ID!) {
          deliveryProfileRemove(id: $id) {
            job { id done }
            userErrors { field message }
          }
        }
      `,
      {
        variables: {
          id: shopRecord.appProfileId,
        },
      },
    );
  }

  const generalProfileZones = new Map();

  for (const zone of activeZones) {
    if (
      !zone.shopifyProfileId ||
      !zone.shopifyZoneId ||
      zone.shopifyProfileId === shopRecord?.appProfileId
    ) {
      continue;
    }

    const zoneIds = generalProfileZones.get(zone.shopifyProfileId) || [];
    zoneIds.push(zone.shopifyZoneId);
    generalProfileZones.set(zone.shopifyProfileId, zoneIds);
  }

  for (const [profileId, zoneIds] of generalProfileZones) {
    await admin.graphql(
      `#graphql
        mutation RemoveAppZonesFromProfile($id: ID!, $profile: DeliveryProfileInput!) {
          deliveryProfileUpdate(id: $id, profile: $profile) {
            profile { id }
            userErrors { field message }
          }
        }
      `,
      {
        variables: {
          id: profileId,
          profile: {
            zonesToDelete: zoneIds,
          },
        },
      },
    );
  }
}

export const action = async ({ request }) => {
  const { admin, shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    await removeShopifyShippingConfiguration({ admin, shop });
  } catch (error) {
    console.error(`Shopify shipping cleanup failed for ${shop}`, error);
  }

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
    db.shop.upsert({
      where: { shop },
      update: {
        appProfileId: null,
        appLocationGroupId: null,
      },
      create: {
        shop,
      },
    }),
  ]);

  return new Response();
};