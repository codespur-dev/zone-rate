import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const planId = url.searchParams.get("planId");
  const chargeId = url.searchParams.get("charge_id");
  const host = url.searchParams.get("host");

  const createPlansRedirect = (billingStatus) => {
    const plansUrl = new URL("/app/plans", url.origin);

    plansUrl.searchParams.set("billing", billingStatus);
    plansUrl.searchParams.set("shop", session.shop);
    plansUrl.searchParams.set("embedded", "1");

    if (host) {
      plansUrl.searchParams.set("host", host);
    }

    return plansUrl.toString();
  };

  if (planId !== "standard" || !chargeId) {
    return redirect(createPlansRedirect("invalid"));
  }

  const subscriptionId = `gid://shopify/AppSubscription/${chargeId}`;

  const response = await admin.graphql(
    `#graphql
      query VerifyAppSubscription($id: ID!) {
        node(id: $id) {
          ... on AppSubscription {
            id
            name
            status
            test
          }
        }
      }
    `,
    {
      variables: {
        id: subscriptionId,
      },
    },
  );

  const result = await response.json();
  const subscription = result?.data?.node;

  if (!subscription || subscription.status !== "ACTIVE") {
    return redirect(createPlansRedirect("declined"));
  }

  await db.shop.upsert({
    where: {
      shop: session.shop,
    },
    update: {
      planId: "standard",
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
    },
    create: {
      shop: session.shop,
      planId: "standard",
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
    },
  });

  return redirect(createPlansRedirect("success"));
};