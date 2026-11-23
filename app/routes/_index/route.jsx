import { redirect } from "react-router";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Zone Rates</h1>
        <p className={styles.text}>
          Create country-based shipping zones and weight-based rates directly
          inside Shopify.
        </p>
        <p className={styles.text}>
          Install or open Zone Rates from Shopify Admin to continue.
        </p>
        <ul className={styles.list}>
        <li>
          <strong>Flexible zones.</strong> Group countries into the shipping
          regions your store needs.
        </li>
        <li>
          <strong>Weight-based rates.</strong> Generate complete rate tables
          from a few simple values.
        </li>
        <li>
          <strong>Shopify integration.</strong> Upload saved zones and rates
          to a delivery profile.
        </li>
      </ul>
      </div>
    </div>
  );
}
