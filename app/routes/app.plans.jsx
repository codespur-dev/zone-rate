import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export default function PlansPage() {
  return (
    <s-page heading="Plans">
      <s-section heading="Choose your plan">
        <s-paragraph>
          Select a plan according to the number of shipping zones you need.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};