import db from "../db.server";

import { useEffect, useState } from "react";

import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";

import { useFetcher, useLoaderData } from "react-router";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const rateSetups = await db.rateSetup.findMany({
    where: {
      shop: session.shop,
    },

    orderBy: {
      createdAt: "desc",
    },

    include: {
      _count: {
        select: {
          rates: true,
        },
      },
    },
  });

  return { rateSetups };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();

  const intent = String(formData.get("intent") || "");

  if (intent === "delete") {
    const setupId = Number(formData.get("setupId"));

    if (!setupId) {
      return {
        success: false,

        message: "Invalid rate setup.",
      };
    }

    await db.rateSetup.deleteMany({
      where: {
        id: setupId,

        shop: session.shop,
      },
    });

    return {
      success: true,

      intent: "delete",

      message: "Rate setup deleted successfully.",
    };
  }

  const setupName = String(formData.get("setupName") || "").trim();

  const initialWeight = Number(formData.get("initialWeight"));

  const weightDifference = Number(formData.get("weightDifference"));

  const maxWeight = Number(formData.get("maxWeight"));

  const initialRate = Number(formData.get("initialRate"));

  const rateDifference = Number(formData.get("rateDifference"));

  let calculatedRates = [];

  try {
    calculatedRates = JSON.parse(
      String(formData.get("calculatedRates") || "[]"),
    );
  } catch {
    return {
      success: false,

      message: "Calculated rates data is invalid.",
    };
  }

  if (!setupName) {
    return {
      success: false,

      message: "Please enter a rate setup name.",
    };
  }

  if (calculatedRates.length === 0) {
    return {
      success: false,

      message: "Please calculate rates before saving.",
    };
  }

  try {
    const savedSetup = await db.rateSetup.create({
      data: {
        shop: session.shop,

        name: setupName,

        initialWeight,

        weightDifference,

        maxWeight,

        initialRate,

        rateDifference,

        rates: {
          create: calculatedRates.map((item) => ({
            minimumWeight: Number(item.minimum),

            maximumWeight: Number(item.maximum),

            rate: Number(item.rate),
          })),
        },
      },
    });

    return {
      success: true,

      intent: "create",

      message: "Rate setup saved successfully.",

      setupId: savedSetup.id,
    };
  } catch (error) {
    if (error.code === "P2002") {
      return {
        success: false,

        message: "A rate setup with this name already exists.",
      };
    }

    throw error;
  }
};

export default function Index() {
  const { rateSetups } = useLoaderData();

  const fetcher = useFetcher();

  const [shippingProfileMode, setShippingProfileMode] = useState("GENERAL");

  useEffect(() => {
    const savedMode = window.localStorage.getItem("shippingProfileMode");
    if (savedMode === "GENERAL" || savedMode === "CUSTOM") {
      setShippingProfileMode(savedMode);
    }
  }, []);

  const changeShippingProfileMode = (event) => {
    const nextMode = event.currentTarget.value;
    setShippingProfileMode(nextMode);
    window.localStorage.setItem("shippingProfileMode", nextMode);
  };

  const isSaving = fetcher.state === "submitting";

  const [setupName, setSetupName] = useState("");

  const [initialWeight, setInitialWeight] = useState("");

  const [weightDifference, setWeightDifference] = useState("");

  const [maxWeight, setMaxWeight] = useState("");

  const [initialRate, setInitialRate] = useState("");

  const [rateDifference, setRateDifference] = useState("");

  // Calculation Rates State

  const [calculatedRates, setCalculatedRates] = useState([]);

  // Error Message state

  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data?.intent === "create") {
      setSetupName("");

      setInitialWeight("");

      setWeightDifference("");

      setMaxWeight("");

      setInitialRate("");

      setRateDifference("");

      setCalculatedRates([]);

      setErrorMessage("");
    }
  }, [fetcher.data]);

  const calculateRates = () => {
    // converting inputs in numbers

    const startWeight = Number(initialWeight);

    const startRate = Number(initialRate);

    const weightDiff = Number(weightDifference);

    const weightMax = Number(maxWeight);

    const rateDiff = Number(rateDifference);

    // Validation

    setErrorMessage("");

    setCalculatedRates([]);

    if (
      initialWeight === "" ||
      initialRate === "" ||
      weightDifference === "" ||
      rateDifference === "" ||
      maxWeight === ""
    ) {
      setErrorMessage("Please fill all fields.");

      return;
    }

    if (startWeight < 0) {
      setErrorMessage("Initial weight cannot be negative.");
      return;
    }

    if (weightDiff <= 0) {
      setErrorMessage("Weight difference must be greater than 0.");
      return;
    }

    if (weightMax <= startWeight) {
      setErrorMessage("Weight Up To must be greater than initial weight.");
      return;
    }

    if (startRate < 0 || rateDiff < 0) {
      setErrorMessage("Rates cannot be negative.");
      return;
    }

    // const totalSteps = (weightMax - startWeight) / weightDiff;

    // const nearestWholeStep = Math.round(totalSteps);

    // if (Math.abs(totalSteps - nearestWholeStep) > 0.000001) {

    //   setErrorMessage(

    //     "Weight Up To must match the selected weight difference."

    //   );

    //   return;

    // }

    const roundWeight = (value) => Number(value.toFixed(3));

    const roundRate = (value) => Number(value.toFixed(2));

    const rows = [];

    let currentMinimum = roundWeight(startWeight);

    // let currentMaximum = roundWeight(currentMinimum + weightDiff);

    let currentMaximum = roundWeight(
      Math.min(currentMinimum + weightDiff, weightMax),
    );

    let currentRate = roundRate(startRate);

    rows.push({
      minimum: currentMinimum,

      maximum: currentMaximum,

      rate: currentRate,
    });

    while (currentMaximum < weightMax) {
      const nextMin = roundWeight(currentMaximum + 0.001);

      // const nextMax = roundWeight(currentMaximum + weightDiff);

      const nextMax = roundWeight(
        Math.min(currentMaximum + weightDiff, weightMax),
      );

      const nextRate = roundRate(currentRate + rateDiff);

      rows.push({
        minimum: nextMin,

        maximum: nextMax,

        rate: nextRate,
      });

      currentMinimum = nextMin;

      currentMaximum = nextMax;

      currentRate = nextRate;
    }

    setCalculatedRates(rows);
  };

  const saveRateSetup = () => {
    setErrorMessage("");

    if (setupName.trim() === "") {
      setErrorMessage("Please enter a rate setup name.");

      return;
    }

    if (calculatedRates.length === 0) {
      setErrorMessage("Please calculate rates before saving.");

      return;
    }

    fetcher.submit(
      {
        setupName,

        initialWeight,

        weightDifference,

        maxWeight,

        initialRate,

        rateDifference,

        calculatedRates: JSON.stringify(calculatedRates),
      },

      {
        method: "POST",
      },
    );
  };

  const deleteRateSetup = (setupId) => {
    const shouldDelete = window.confirm(
      "Are you sure you want to delete this rate setup?",
    );

    if (!shouldDelete) {
      return;
    }

    fetcher.submit(
      {
        intent: "delete",

        setupId: String(setupId),
      },

      {
        method: "POST",
      },
    );
  };

  return (
    <s-page heading="Rate Setup">
      <s-section heading="Shipping Profile">
        <s-paragraph>
          Choose where Shopify shipping zones and rates should be uploaded.
        </s-paragraph>

        <s-select
          label="Upload rates to"
          value={shippingProfileMode}
          onChange={changeShippingProfileMode}
        >
          <s-option value="GENERAL">General Shopify Profile</s-option>
          <s-option value="CUSTOM">Custom App Profile</s-option>
        </s-select>
      </s-section>

      <s-section heading="Configure shipping rates">
        <s-paragraph>
          Set the starting weight and rate calculation rules for your zones.
        </s-paragraph>

        {errorMessage && <s-banner tone="critical">{errorMessage}</s-banner>}

        {fetcher.data?.message && (
          <s-banner tone={fetcher.data.success ? "success" : "critical"}>
            {fetcher.data.message}
          </s-banner>
        )}

        <s-text-field
          label="Rate Setup Name"
          name="setupName"
          value={setupName}
          placeholder="Example: USA Weight Rates"
          required
          onChange={(event) => setSetupName(event.currentTarget.value)}
        />

        <s-number-field
          label="Initial Weight (kg)"
          name="initialWeight"
          value={initialWeight}
          min="0"
          step="0.1"
          required
          onChange={(event) => setInitialWeight(event.currentTarget.value)}
        />

        <s-paragraph>
          Current Initial weight: {initialWeight || "Not Set"} kg
        </s-paragraph>

        <s-number-field
          label="Weight Difference (kg)"
          name="weightDifference"
          value={weightDifference}
          min="0"
          step="0.1"
          required
          onChange={(event) => setWeightDifference(event.currentTarget.value)}
        />

        <s-paragraph>
          Current Weight Difference: {weightDifference || "Not Set"} kg
        </s-paragraph>

        <s-number-field
          label="Max Weight (kg)"
          name="maxWeight"
          value={maxWeight}
          min="0"
          step="0.1"
          required
          onChange={(event) => setMaxWeight(event.currentTarget.value)}
        />

        <s-paragraph>Max Weight: {maxWeight || "Not Set"} kg</s-paragraph>

        <s-number-field
          label="Initial Rate"
          name="initialRate"
          value={initialRate}
          min="0"
          step="0.01"
          required
          onChange={(event) => setInitialRate(event.currentTarget.value)}
        />

        <s-paragraph>
          Current Initial Rate: {initialRate || "Not Set"}
        </s-paragraph>

        <s-number-field
          label="Rate Difference"
          name="rateDifference"
          value={rateDifference}
          min="0"
          step="0.01"
          required
          onChange={(event) => setRateDifference(event.currentTarget.value)}
        />

        <s-paragraph>
          Current Rate Difference: {rateDifference || "Not Set"}
        </s-paragraph>

        {errorMessage && <s-banner tone="critical">{errorMessage}</s-banner>}

        <s-stack direction="inline" gap="base">
          <s-button onClick={calculateRates}>Calculate Rates</s-button>

          <s-button
            variant="primary"
            onClick={saveRateSetup}
            disabled={calculatedRates.length === 0}
            {...(isSaving ? { loading: true } : {})}
          >
            Save Rate Setup
          </s-button>
        </s-stack>

        {calculatedRates.length > 0 && (
          <div style={{ marginTop: "20px", overflowX: "auto" }}>
            <h3 style={{ marginBottom: "12px" }}>Calculated Rates</h3>

            <table
              style={{
                width: "100%",

                borderCollapse: "collapse",

                border: "1px solid #d9d9d9",

                borderRadius: "8px",
              }}
            >
              <thead>
                <tr style={{ backgroundColor: "#f3f3f3" }}>
                  <th
                    style={{
                      padding: "12px",

                      textAlign: "left",

                      borderBottom: "1px solid #d9d9d9",
                    }}
                  >
                    Minimum Weight
                  </th>

                  <th
                    style={{
                      padding: "12px",

                      textAlign: "left",

                      borderBottom: "1px solid #d9d9d9",
                    }}
                  >
                    Maximum Weight
                  </th>

                  <th
                    style={{
                      padding: "12px",

                      textAlign: "left",

                      borderBottom: "1px solid #d9d9d9",
                    }}
                  >
                    Rate
                  </th>
                </tr>
              </thead>

              <tbody>
                {calculatedRates.map((item, index) => (
                  <tr key={index}>
                    <td
                      style={{
                        padding: "12px",

                        borderBottom: "1px solid #eeeeee",
                      }}
                    >
                      {item.minimum} kg
                    </td>

                    <td
                      style={{
                        padding: "12px",

                        borderBottom: "1px solid #eeeeee",
                      }}
                    >
                      {item.maximum} kg
                    </td>

                    <td
                      style={{
                        padding: "12px",

                        borderBottom: "1px solid #eeeeee",
                      }}
                    >
                      {item.rate}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      <s-section heading="Saved Rate Setups">
        {rateSetups.length === 0 ? (
          <s-paragraph>No rate setups have been saved yet.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {rateSetups.map((setup) => (
              <s-box
                key={setup.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-heading>{setup.name}</s-heading>

                <s-paragraph>
                  Initial weight: {setup.initialWeight} kg
                </s-paragraph>

                <s-paragraph>
                  Weight difference: {setup.weightDifference} kg
                </s-paragraph>

                <s-paragraph>Maximum weight: {setup.maxWeight} kg</s-paragraph>

                <s-paragraph>Initial rate: {setup.initialRate}</s-paragraph>

                <s-paragraph>
                  Rate difference: {setup.rateDifference}
                </s-paragraph>

                <s-paragraph>Generated rows: {setup._count.rates}</s-paragraph>

                <s-button
                  tone="critical"
                  variant="tertiary"
                  onClick={() => deleteRateSetup(setup.id)}
                >
                  Delete Setup
                </s-button>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
