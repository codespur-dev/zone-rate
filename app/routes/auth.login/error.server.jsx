import { LoginErrorType } from "@shopify/shopify-app-react-router/server";

export function loginErrorMessage(loginErrors) {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Install or open this app from Shopify Admin to continue." };
  } else if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "Install or open this app from Shopify Admin to continue." };
  }

  return {};
}
