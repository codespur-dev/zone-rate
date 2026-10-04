import { useEffect } from "react";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const SUPPORT_EMAIL = "support@codespur.com";
const STANDARD_PRICE = 7.5;
const TEST_MODE = true;

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    tagline: "For stores getting started",
    buttonText: "Start Free",
    features: [
      "Create 1 shipping zone",
      "Use General or Custom profile",
      "Weight-based and flat shipping rates",
      "Country selection and zone management",
      "Email support",
    ],
  },
  {
    id: "standard",
    name: "Standard",
    price: STANDARD_PRICE,
    tagline: "For stores managing multiple shipping regions",
    buttonText: "Choose Standard",
    popular: true,
    features: [
      "Create unlimited shipping zones",
      "Use both General and Custom profiles",
      "Weight-based and flat shipping rates",
      "Country selection and zone management",
      "Email support",
    ],
  },
  {
    id: "premium",
    name: "Premium",
    price: null,
    tagline: "For businesses with custom shipping requirements",
    buttonText: "Contact Us",
    features: [
      "Everything included in Standard",
      "Custom shipping rules and rate logic",
      "Store-specific customization",
      "Additional integration assistance",
      "Requirement review and guided implementation",
      "Email support",
    ],
  },
];

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

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
          }
        }
      }
    `,
  );

  const result = await response.json();

  const activeSubscriptions =
    result?.data?.currentAppInstallation?.activeSubscriptions ?? [];

  const standardSubscription = activeSubscriptions.find(
    (subscription) =>
      subscription.status === "ACTIVE" &&
      subscription.name === "Standard Plan",
  );

  let currentPlanId = "free";

  if (standardSubscription) {
    await db.shop.upsert({
      where: {
        shop: session.shop,
      },
      update: {
        planId: "standard",
        subscriptionId: standardSubscription.id,
        subscriptionStatus: standardSubscription.status,
      },
      create: {
        shop: session.shop,
        planId: "standard",
        subscriptionId: standardSubscription.id,
        subscriptionStatus: standardSubscription.status,
      },
    });

    currentPlanId = "standard";
  } else {
    const shop = await db.shop.findUnique({
      where: {
        shop: session.shop,
      },
    });

    currentPlanId = shop?.planId ?? "free";
  }

  return {
    plans: PLANS,
    currentPlanId,
    supportEmail: SUPPORT_EMAIL,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const planId = formData.get("planId");

  if (planId === "free") {
  const zoneCount = await db.shippingZone.count({
    where: {
      shop: session.shop,
    },
  });

  if (zoneCount > 1) {
    return {
      error:
        "To downgrade to the Free plan, please delete additional zones and keep only one zone.",
    };
  }

  const subscriptionsResponse = await admin.graphql(
    `#graphql
      query CurrentAppSubscriptions {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
          }
        }
      }
    `,
  );

  const subscriptionsResult = await subscriptionsResponse.json();

  const activeSubscriptions =
    subscriptionsResult?.data?.currentAppInstallation
      ?.activeSubscriptions ?? [];

  const standardSubscription = activeSubscriptions.find(
    (subscription) =>
      subscription.status === "ACTIVE" &&
      subscription.name === "Standard Plan",
  );

  if (standardSubscription) {
    const cancelResponse = await admin.graphql(
      `#graphql
        mutation CancelAppSubscription($id: ID!) {
          appSubscriptionCancel(id: $id, prorate: false) {
            appSubscription {
              id
              status
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          id: standardSubscription.id,
        },
      },
    );

    const cancelResult = await cancelResponse.json();
    const cancellation = cancelResult?.data?.appSubscriptionCancel;

    if (cancellation?.userErrors?.length) {
      return {
        error: cancellation.userErrors[0].message,
      };
    }

    if (!cancellation?.appSubscription) {
      return {
        error: "Standard subscription could not be cancelled.",
      };
    }
  }

  await db.shop.upsert({
    where: {
      shop: session.shop,
    },
    update: {
      planId: "free",
      subscriptionId: null,
      subscriptionStatus: "ACTIVE",
    },
    create: {
      shop: session.shop,
      planId: "free",
      subscriptionId: null,
      subscriptionStatus: "ACTIVE",
    },
  });

  return {
    success: true,
    selectedPlan: "free",
  };
}

  if (planId === "standard") {
    const appUrl = process.env.SHOPIFY_APP_URL;
    const requestUrl = new URL(request.url);
    const host = requestUrl.searchParams.get("host");

    const confirmUrl = new URL("/app/plans/confirm", appUrl);

    confirmUrl.searchParams.set("planId", "standard");
    confirmUrl.searchParams.set("shop", session.shop);

    if (host) {
      confirmUrl.searchParams.set("host", host);
    }

    if (!appUrl) {
      return {
        error: "SHOPIFY_APP_URL is not configured.",
      };
    }

    const response = await admin.graphql(
      `#graphql
        mutation AppSubscriptionCreate(
          $name: String!
          $lineItems: [AppSubscriptionLineItemInput!]!
          $returnUrl: URL!
          $test: Boolean!
        ) {
          appSubscriptionCreate(
            name: $name
            lineItems: $lineItems
            returnUrl: $returnUrl
            test: $test
          ) {
            confirmationUrl
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          name: "Standard Plan",
          // returnUrl: `${appUrl}/app/plans/confirm?planId=standard`,
          returnUrl: confirmUrl.toString(),
          test: TEST_MODE,
          lineItems: [
            {
              plan: {
                appRecurringPricingDetails: {
                  price: {
                    amount: STANDARD_PRICE,
                    currencyCode: "USD",
                  },
                  interval: "EVERY_30_DAYS",
                },
              },
            },
          ],
        },
      },
    );

    const result = await response.json();
    const subscription = result?.data?.appSubscriptionCreate;

    if (subscription?.userErrors?.length) {
      return {
        error: subscription.userErrors[0].message,
      };
    }

    if (!subscription?.confirmationUrl) {
      return {
        error: "Shopify billing confirmation URL was not created.",
      };
    }

    return {
      confirmationUrl: subscription.confirmationUrl,
    };
  }

  return {
    error: "Invalid plan selected.",
  };
};

export default function PlansPage() {
  const { plans, currentPlanId, supportEmail } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();

  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (!actionData?.confirmationUrl) return;

    if (window.top === window.self) {
      window.location.href = actionData.confirmationUrl;
    } else {
      window.top.location.href = actionData.confirmationUrl;
    }
  }, [actionData]);

  const selectPlan = (planId) => {
    submit(
      { planId },
      {
        method: "post",
      },
    );
  };

  const contactPremium = () => {
    const subject = encodeURIComponent(
      "Premium Plan – Custom Shipping Requirements",
    );

    const body = encodeURIComponent(
      `Hi CodeSpur Support,

I am interested in the Premium plan and would like to discuss my custom shipping requirements.

Store:
Requirements:

Thank you.`,
    );

    window.location.href =
      `mailto:${supportEmail}?subject=${subject}&body=${body}`;
  };

  return (
    <s-page heading="Plans">
      <s-section heading="Choose the right plan for your store">
        <s-paragraph>
          Start free, manage unlimited shipping zones with Standard, or contact
          us when your store requires a customized shipping solution.
        </s-paragraph>

        {actionData?.success && (
          <div className="plans-message">
            <s-banner tone="success" heading="Free plan activated">
              <s-paragraph>
                Your Free plan is active. You can now create one shipping zone.
              </s-paragraph>
            </s-banner>
          </div>
        )}

        {actionData?.error && (
          <div className="plans-message">
            <s-banner tone="critical" heading="Unable to select plan">
              <s-paragraph>{actionData.error}</s-paragraph>
            </s-banner>
          </div>
        )}

        <div className="plans-grid">
          {plans.map((plan) => {
            const isCurrent = currentPlanId === plan.id;
            const isPremium = plan.id === "premium";

            return (
              <div
                key={plan.id}
                className={`plan-card ${
                  plan.popular ? "plan-card--popular" : ""
                }`}
              >
                {plan.popular && (
                  <span className="plan-badge">Most Popular</span>
                )}

                {isCurrent && (
                  <span className="current-plan-badge">Current Plan</span>
                )}

                <div className="plan-header">
                  <h2>{plan.name}</h2>
                  <p>{plan.tagline}</p>
                </div>

                <div className="plan-price">
                  {plan.price === null ? (
                    <>
                      <strong>Custom</strong>
                      <span>Call for pricing</span>
                    </>
                  ) : plan.price === 0 ? (
                    <>
                      <strong>Free</strong>
                      <span>No monthly charge</span>
                    </>
                  ) : (
                    <>
                      <strong>${plan.price.toFixed(2)}</strong>
                      <span>USD / month</span>
                    </>
                  )}
                </div>

                {isPremium && (
                  <p className="premium-description">
                    Choose Premium when your shipping setup requires custom
                    rules, additional integrations, or assistance designed
                    specifically around your store’s workflow.
                  </p>
                )}

                <div className="plan-divider" />

                <ul className="plan-features">
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <span className="check-icon">✓</span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  className={`plan-button ${
                    plan.popular ? "plan-button--primary" : ""
                  }`}
                  disabled={isCurrent || isSubmitting}
                  onClick={() =>
                    isPremium ? contactPremium() : selectPlan(plan.id)
                  }
                >
                  {isCurrent
                    ? "Current Plan"
                    : isSubmitting
                      ? "Please wait..."
                      : currentPlanId === "standard" && plan.id === "free"
                      ? "Downgrade to Free"
                      : plan.buttonText}
                </button>
              </div>
            );
          })}
        </div>

        <div className="support-note">
          Need help choosing a plan? Email{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        </div>
      </s-section>

      <style>{`
        .plans-message {
          margin-top: 20px;
        }

        .plans-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 20px;
          margin-top: 28px;
          padding-top: 12px;
        }

        .plan-card {
          position: relative;
          display: flex;
          flex-direction: column;
          min-height: 560px;
          padding: 28px;
          border: 1px solid #dedede;
          border-radius: 14px;
          background: #ffffff;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }

        .plan-card--popular {
          border: 2px solid #303030;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
        }

        .plan-badge,
        .current-plan-badge {
          position: absolute;
          top: -14px;
          padding: 5px 12px;
          border-radius: 20px;
          color: #ffffff;
          font-size: 12px;
          font-weight: 650;
        }

        .plan-badge {
          left: 22px;
          background: #303030;
        }

        .current-plan-badge {
          right: 22px;
          background: #008060;
        }

        .plan-header h2 {
          margin: 0 0 8px;
          font-size: 24px;
          line-height: 1.2;
          color: #202223;
        }

        .plan-header p {
          min-height: 42px;
          margin: 0;
          color: #616161;
          font-size: 14px;
          line-height: 21px;
        }

        .plan-price {
          min-height: 72px;
          margin-top: 24px;
        }

        .plan-price strong {
          display: block;
          color: #202223;
          font-size: 32px;
          line-height: 40px;
        }

        .plan-price span {
          color: #6d7175;
          font-size: 13px;
        }

        .premium-description {
          margin: 12px 0 0;
          color: #616161;
          font-size: 13px;
          line-height: 19px;
        }

        .plan-divider {
          height: 1px;
          margin: 22px 0;
          background: #e4e5e7;
        }

        .plan-features {
          flex: 1;
          margin: 0 0 26px;
          padding: 0;
          list-style: none;
        }

        .plan-features li {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 14px;
          color: #303030;
          font-size: 14px;
          line-height: 20px;
        }

        .check-icon {
          color: #008060;
          font-weight: 700;
        }

        .plan-button {
          width: 100%;
          min-height: 42px;
          padding: 9px 16px;
          border: 1px solid #8a8a8a;
          border-radius: 8px;
          background: #ffffff;
          color: #303030;
          font-size: 14px;
          font-weight: 650;
          cursor: pointer;
        }

        .plan-button:hover:not(:disabled) {
          background: #f3f3f3;
          border-color: #616161;
        }

        .plan-button--primary {
          border-color: #303030;
          background: #303030;
          color: #ffffff;
        }

        .plan-button--primary:hover:not(:disabled) {
          background: #1a1a1a;
        }

        .plan-button:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        .support-note {
          margin-top: 24px;
          color: #616161;
          font-size: 14px;
          text-align: center;
        }

        .support-note a {
          color: #005bd3;
          font-weight: 600;
        }

        @media (max-width: 900px) {
          .plans-grid {
            grid-template-columns: 1fr;
          }

          .plan-card {
            min-height: auto;
          }

          .plan-header p {
            min-height: auto;
          }
        }
      `}</style>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};