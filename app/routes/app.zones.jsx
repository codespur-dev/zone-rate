import { useEffect, useState } from "react";

import { useFetcher, useLoaderData } from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";

import db from "../db.server";

const COUNTRY_CODES = `

AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ

BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ

CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ

DE DJ DK DM DO DZ

EC EE EG EH ER ES ET

FI FJ FK FM FO FR

GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY

HK HM HN HR HT HU

ID IE IL IM IN IO IQ IR IS IT

JE JM JO JP

KE KG KH KI KM KN KP KR KW KY KZ

LA LB LC LI LK LR LS LT LU LV LY

MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ

NA NC NE NF NG NI NL NO NP NR NU NZ

OM

PA PE PF PG PH PK PL PM PN PR PS PT PW PY

QA

RE RO RS RU RW

SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ

TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ

UA UG UM US UY UZ

VA VC VE VG VI VN VU

WF WS

YE YT

ZA ZM ZW

`

  .trim()

  .split(/\s+/);

const SHOPIFY_UNSUPPORTED_COUNTRY_CODES = new Set([
  "AQ",

  "AS",

  "FM",

  "GU",

  "MH",

  "MP",

  "PR",

  "PW",

  "VI",
]);

const regionNames = new Intl.DisplayNames(["en"], {
  type: "region",
});

const COUNTRIES = COUNTRY_CODES.map((code) => ({
  code,

  name: regionNames.of(code) || code,
}))

  .sort((first, second) => first.name.localeCompare(second.name));

const buildShopifyZoneInput = (zone, rateRows, currencyCode) => {
  const countries = JSON.parse(zone.countries).map((code) => ({
    code,

    includeAllProvinces: true,
  }));

  let methodDefinitionsToCreate = [];

  if (zone.rateType === "flat") {
    methodDefinitionsToCreate = [
      {
        name: zone.flatRateName,

        rateDefinition: {
          price: {
            amount: zone.flatRatePrice,

            currencyCode,
          },
        },
      },
    ];
  } else {
    methodDefinitionsToCreate = rateRows.map((row) => ({
      name: zone.rateSetup.name,

      rateDefinition: {
        price: {
          amount: row.rate,

          currencyCode,
        },
      },

      weightConditionsToCreate: [
        {
          operator: "GREATER_THAN_OR_EQUAL_TO",

          criteria: {
            value: row.minimumWeight,

            unit: "KILOGRAMS",
          },
        },

        {
          operator: "LESS_THAN_OR_EQUAL_TO",

          criteria: {
            value: row.maximumWeight,

            unit: "KILOGRAMS",
          },
        },
      ],
    }));
  }

  return {
    name: zone.name,

    countries,

    methodDefinitionsToCreate,
  };
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const rateSetups = await db.rateSetup.findMany({
    where: {
      shop: session.shop,
    },

    orderBy: {
      createdAt: "desc",
    },

    select: {
      id: true,

      name: true,

      initialWeight: true,

      maxWeight: true,

      _count: {
        select: {
          rates: true,
        },
      },
    },
  });

  const savedZones = await db.shippingZone.findMany({
    where: {
      shop: session.shop,
    },

    orderBy: {
      createdAt: "desc",
    },

    include: {
      rateSetup: {
        select: {
          id: true,

          name: true,
        },
      },
    },
  });

  const zones = savedZones.map((zone) => {
    let countryCodes = [];

    try {
      countryCodes = JSON.parse(zone.countries);
    } catch {
      countryCodes = [];
    }

    return {
      ...zone,

      countryCodes,
    };
  });

  return {
    rateSetups,

    zones,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();

  const intent = String(formData.get("intent") || "");

  if (intent === "upload") {
    const zoneId = Number(formData.get("zoneId"));
    const shippingProfileMode =
      String(formData.get("shippingProfileMode") || "GENERAL") === "CUSTOM"
        ? "CUSTOM"
        : "GENERAL";

    const zone = await db.shippingZone.findFirst({
      where: { id: zoneId, shop: session.shop },

      include: {
        rateSetup: {
          include: {
            rates: {
              orderBy: { minimumWeight: "asc" },
            },
          },
        },
      },
    });

    if (!zone) {
      return {
        success: false,
        intent: "upload",
        message: "Shipping zone was not found.",
      };
    }

    if (zone.status === "ACTIVE" || zone.shopifyZoneId) {
      return {
        success: false,
        intent: "upload",
        message: "This zone is already uploaded to Shopify.",
      };
    }

    if (zone.rateType === "packageWeight" && !zone.rateSetup) {
      return {
        success: false,
        intent: "upload",
        message: "The selected weight setup no longer exists.",
      };
    }

    const shopResponse = await admin.graphql(
      `#graphql

        query ShippingUploadRequirements {

          shop {

            currencyCode

          }

          locations(first: 100, query: "active:true") {

            nodes {

              id

              name

            }

          }

        }

      `,
    );

    const shopJson = await shopResponse.json();

    if (shopJson.errors?.length) {
      return {
        success: false,

        intent: "upload",

        message: shopJson.errors.map((error) => error.message).join(" "),
      };
    }

    const currencyCode = shopJson.data.shop.currencyCode;

    const locationIds = shopJson.data.locations.nodes.map(
      (location) => location.id,
    );

    if (locationIds.length === 0) {
      return {
        success: false,
        intent: "upload",
        message: "No active Shopify location was found.",
      };
    }

    const shopifyZoneInput = buildShopifyZoneInput(
      zone,

      zone.rateSetup?.rates || [],

      currencyCode,
    );

    if (shopifyZoneInput.countries.length === 0) {
      return {
        success: false,

        intent: "upload",

        message:
          "None of the selected countries can be used in a Shopify shipping zone.",
      };
    }

    if (shippingProfileMode === "GENERAL") {
      const profilesResponse = await admin.graphql(
        `#graphql
          query GeneralDeliveryProfile {
            deliveryProfiles(first: 20) {
              nodes {
                id
                default
                profileLocationGroups {
                  locationGroup { id }
                }
              }
            }
          }
        `,
      );
      const profilesJson = await profilesResponse.json();
      const generalProfile = profilesJson.data?.deliveryProfiles?.nodes?.find(
        (profile) => profile.default,
      );
      const generalGroup = generalProfile?.profileLocationGroups?.[0];

      if (profilesJson.errors?.length || !generalProfile || !generalGroup) {
        return {
          success: false,
          intent: "upload",
          message:
            profilesJson.errors?.map((error) => error.message).join(" ") ||
            "Shopify General profile or its location group was not found.",
        };
      }

      const updateResponse = await admin.graphql(
        `#graphql
          mutation AddZoneToGeneralProfile($id: ID!, $profile: DeliveryProfileInput!) {
            deliveryProfileUpdate(id: $id, profile: $profile) {
              profile {
                id
                profileLocationGroups {
                  locationGroup { id }
                  locationGroupZones(first: 100) {
                    edges { node { zone { id name } } }
                  }
                }
              }
              userErrors { field message }
            }
          }
        `,
        {
          variables: {
            id: generalProfile.id,
            profile: {
              locationGroupsToUpdate: [
                {
                  id: generalGroup.locationGroup.id,
                  zonesToCreate: [shopifyZoneInput],
                },
              ],
            },
          },
        },
      );
      const updateJson = await updateResponse.json();
      const payload = updateJson.data?.deliveryProfileUpdate;
      const apiErrors = [
        ...(updateJson.errors || []).map((error) => error.message),
        ...(payload?.userErrors || []).map((error) => error.message),
      ];

      if (apiErrors.length > 0 || !payload?.profile) {
        return {
          success: false,
          intent: "upload",
          message:
            apiErrors.join(" ") ||
            "Shopify could not update the General profile.",
        };
      }

      const updatedGroup = payload.profile.profileLocationGroups.find(
        (group) => group.locationGroup.id === generalGroup.locationGroup.id,
      );
      const shopifyZoneId = updatedGroup?.locationGroupZones.edges.find(
        (edge) => edge.node.zone.name === zone.name,
      )?.node.zone.id;

      if (!shopifyZoneId) {
        return {
          success: false,
          intent: "upload",
          message:
            "Shopify updated the General profile, but the zone ID was not returned.",
        };
      }

      await db.shippingZone.update({
        where: { id: zone.id },
        data: {
          status: "ACTIVE",
          shopifyProfileId: generalProfile.id,
          shopifyLocationGroupId: generalGroup.locationGroup.id,
          shopifyZoneId,
        },
      });

      return {
        success: true,
        intent: "upload",
        message: "Shipping zone uploaded to the General profile successfully.",
      };
    }

    const existingUploadedZone = await db.shippingZone.findFirst({
      where: {
        shop: session.shop,

        status: "ACTIVE",

        shopifyProfileId: { not: null },

        shopifyLocationGroupId: { not: null },
      },
    });

    let profileId;

    let locationGroupId;

    let shopifyZoneId;

    if (!existingUploadedZone) {
      const createResponse = await admin.graphql(
        `#graphql

          mutation CreateZoneRatesProfile($profile: DeliveryProfileInput!) {

            deliveryProfileCreate(profile: $profile) {

              profile {

                id

                profileLocationGroups {

                  locationGroup { id }

                  locationGroupZones(first: 100) {

                    edges {

                      node {

                        zone { id name }

                      }

                    }

                  }

                }

              }

              userErrors { field message }

            }

          }

        `,

        {
          variables: {
            profile: {
              name: "Zone Rates App Profile",

              coversAllItems: true,

              locationGroupsToCreate: [
                {
                  locationsToAdd: locationIds,

                  zonesToCreate: [shopifyZoneInput],
                },
              ],
            },
          },
        },
      );

      const createJson = await createResponse.json();

      const payload = createJson.data?.deliveryProfileCreate;

      const apiErrors = [
        ...(createJson.errors || []).map((error) => error.message),

        ...(payload?.userErrors || []).map((error) => error.message),
      ];

      if (apiErrors.length > 0 || !payload?.profile) {
        return {
          success: false,
          intent: "upload",
          message:
            apiErrors.join(" ") ||
            "Shopify could not create the delivery profile.",
        };
      }

      profileId = payload.profile.id;

      const profileGroup = payload.profile.profileLocationGroups[0];

      locationGroupId = profileGroup.locationGroup.id;

      shopifyZoneId = profileGroup.locationGroupZones.edges.find(
        (edge) => edge.node.zone.name === zone.name,
      )?.node.zone.id;
    } else {
      profileId = existingUploadedZone.shopifyProfileId;

      locationGroupId = existingUploadedZone.shopifyLocationGroupId;

      const updateResponse = await admin.graphql(
        `#graphql

          mutation AddZoneToRatesProfile($id: ID!, $profile: DeliveryProfileInput!) {

            deliveryProfileUpdate(id: $id, profile: $profile) {

              profile {

                id

                profileLocationGroups {

                  locationGroup { id }

                  locationGroupZones(first: 100) {

                    edges {

                      node {

                        zone { id name }

                      }

                    }

                  }

                }

              }

              userErrors { field message }

            }

          }

        `,

        {
          variables: {
            id: profileId,

            profile: {
              locationGroupsToUpdate: [
                {
                  id: locationGroupId,

                  zonesToCreate: [shopifyZoneInput],
                },
              ],
            },
          },
        },
      );

      const updateJson = await updateResponse.json();

      const payload = updateJson.data?.deliveryProfileUpdate;

      const apiErrors = [
        ...(updateJson.errors || []).map((error) => error.message),

        ...(payload?.userErrors || []).map((error) => error.message),
      ];

      if (apiErrors.length > 0 || !payload?.profile) {
        return {
          success: false,
          intent: "upload",
          message: apiErrors.join(" ") || "Shopify could not add this zone.",
        };
      }

      const profileGroup = payload.profile.profileLocationGroups.find(
        (group) => group.locationGroup.id === locationGroupId,
      );

      shopifyZoneId = profileGroup?.locationGroupZones.edges.find(
        (edge) => edge.node.zone.name === zone.name,
      )?.node.zone.id;
    }

    if (!shopifyZoneId) {
      return {
        success: false,
        intent: "upload",
        message:
          "Shopify created the profile, but the new zone ID was not returned.",
      };
    }

    await db.shippingZone.update({
      where: { id: zone.id },

      data: {
        status: "ACTIVE",

        shopifyProfileId: profileId,

        shopifyLocationGroupId: locationGroupId,

        shopifyZoneId,
      },
    });

    return {
      success: true,

      intent: "upload",

      message: "Shipping zone uploaded to Shopify successfully.",
    };
  }

  if (intent === "delete") {
    const zoneId = Number(formData.get("zoneId"));

    if (!zoneId) {
      return {
        success: false,

        intent: "delete",

        message: "Invalid shipping zone.",
      };
    }

    const zone = await db.shippingZone.findFirst({
      where: { id: zoneId, shop: session.shop },
    });

    if (zone?.status === "ACTIVE") {
      return {
        success: false,

        intent: "delete",

        message: "Active Shopify zones cannot be deleted from the app yet.",
      };
    }

    await db.shippingZone.deleteMany({
      where: {
        id: zoneId,

        shop: session.shop,
      },
    });

    return {
      success: true,

      intent: "delete",

      message: "Shipping zone deleted successfully.",
    };
  }

  if (intent !== "create") {
    return {
      success: false,

      message: "Invalid request.",
    };
  }

  const zoneName = String(formData.get("zoneName") || "").trim();

  const rateType = String(formData.get("rateType") || "");

  const selectedSetupId = String(formData.get("selectedSetupId") || "");

  const flatRateName = String(formData.get("flatRateName") || "").trim();

  const flatRatePriceValue = String(formData.get("flatRatePrice") || "");

  let selectedCountries = [];

  try {
    selectedCountries = JSON.parse(
      String(formData.get("selectedCountries") || "[]"),
    );
  } catch {
    return {
      success: false,

      message: "Selected countries data is invalid.",
    };
  }

  if (!zoneName) {
    return {
      success: false,

      message: "Please enter a zone name.",
    };
  }

  if (selectedCountries.length === 0) {
    return {
      success: false,

      message: "Please select at least one country.",
    };
  }

  if (!["packageWeight", "flat"].includes(rateType)) {
    return {
      success: false,

      message: "Please select a valid rate type.",
    };
  }

  let rateSetupId = null;

  let flatRatePrice = null;

  if (rateType === "packageWeight") {
    rateSetupId = Number(selectedSetupId);

    if (!rateSetupId) {
      return {
        success: false,

        message: "Please select a saved weight setup.",
      };
    }

    const rateSetup = await db.rateSetup.findFirst({
      where: {
        id: rateSetupId,

        shop: session.shop,
      },
    });

    if (!rateSetup) {
      return {
        success: false,

        message: "Selected weight setup was not found.",
      };
    }
  }

  if (rateType === "flat") {
    if (!flatRateName) {
      return {
        success: false,

        message: "Please enter a flat rate name.",
      };
    }

    if (flatRatePriceValue === "") {
      return {
        success: false,

        message: "Please enter a flat rate price.",
      };
    }

    flatRatePrice = Number(flatRatePriceValue);

    if (!Number.isFinite(flatRatePrice) || flatRatePrice < 0) {
      return {
        success: false,

        message: "Flat rate price cannot be negative.",
      };
    }
  }

  try {
    const savedZone = await db.shippingZone.create({
      data: {
        shop: session.shop,

        name: zoneName,

        countries: JSON.stringify(selectedCountries),

        rateType,

        rateSetupId: rateType === "packageWeight" ? rateSetupId : null,

        flatRateName: rateType === "flat" ? flatRateName : null,

        flatRatePrice: rateType === "flat" ? flatRatePrice : null,
      },
    });

    return {
      success: true,

      intent: "create",

      message: "Shipping zone saved successfully.",

      zoneId: savedZone.id,
    };
  } catch (error) {
    if (error.code === "P2002") {
      return {
        success: false,

        message: "A shipping zone with this name already exists.",
      };
    }

    throw error;
  }
};

export default function ZonesPage() {
  const { rateSetups, zones } = useLoaderData();

  const fetcher = useFetcher();

  const [zoneName, setZoneName] = useState("");

  const [countrySearch, setCountrySearch] = useState("");

  const [selectedCountries, setSelectedCountries] = useState([]);

  const [rateType, setRateType] = useState("packageWeight");

  const [selectedSetupId, setSelectedSetupId] = useState("");

  const [flatRateName, setFlatRateName] = useState("");

  const [flatRatePrice, setFlatRatePrice] = useState("");

  const [errorMessage, setErrorMessage] = useState("");
  const [shippingProfileMode, setShippingProfileMode] = useState("GENERAL");

  useEffect(() => {
    const savedMode = window.localStorage.getItem("shippingProfileMode");
    if (savedMode === "GENERAL" || savedMode === "CUSTOM") {
      setShippingProfileMode(savedMode);
    }
  }, []);

  const isSubmitting = fetcher.state === "submitting";

  const filteredCountries = COUNTRIES.filter((country) => {
    const searchValue = countrySearch.trim().toLowerCase();

    if (!searchValue) {
      return true;
    }

    return (
      country.name.toLowerCase().includes(searchValue) ||
      country.code.toLowerCase().includes(searchValue)
    );
  });

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data?.intent === "create") {
      setZoneName("");

      setCountrySearch("");

      setSelectedCountries([]);

      setRateType("packageWeight");

      setSelectedSetupId("");

      setFlatRateName("");

      setFlatRatePrice("");

      setErrorMessage("");
    }
  }, [fetcher.data]);

  const toggleCountry = (countryCode) => {
    setSelectedCountries((currentCountries) => {
      if (currentCountries.includes(countryCode)) {
        return currentCountries.filter((code) => code !== countryCode);
      }

      return [...currentCountries, countryCode];
    });
  };

  const saveZone = () => {
    setErrorMessage("");

    if (zoneName.trim() === "") {
      setErrorMessage("Please enter a zone name.");

      return;
    }

    if (selectedCountries.length === 0) {
      setErrorMessage("Please select at least one country.");

      return;
    }

    if (rateType === "packageWeight" && selectedSetupId === "") {
      setErrorMessage("Please select a saved weight setup.");

      return;
    }

    if (rateType === "flat" && flatRateName.trim() === "") {
      setErrorMessage("Please enter a flat rate name.");

      return;
    }

    if (rateType === "flat" && flatRatePrice === "") {
      setErrorMessage("Please enter a flat rate price.");

      return;
    }

    fetcher.submit(
      {
        intent: "create",

        zoneName,

        selectedCountries: JSON.stringify(selectedCountries),

        rateType,

        selectedSetupId,

        flatRateName,

        flatRatePrice,
      },

      {
        method: "POST",
      },
    );
  };

  const deleteZone = (zoneId) => {
    const shouldDelete = window.confirm(
      "Are you sure you want to delete this shipping zone?",
    );

    if (!shouldDelete) {
      return;
    }

    fetcher.submit(
      {
        intent: "delete",

        zoneId: String(zoneId),
      },

      {
        method: "POST",
      },
    );
  };

  const uploadZone = (zoneId) => {
    fetcher.submit(
      {
        intent: "upload",

        zoneId: String(zoneId),

        shippingProfileMode,
      },

      {
        method: "POST",
      },
    );
  };

  return (
    <s-page heading="Zones & Shipping Options">
      <s-section heading="Create shipping zone">
        <s-paragraph>
          Select countries and assign either a package-weight configuration or a
          flat shipping rate.
        </s-paragraph>

        {errorMessage && <s-banner tone="critical">{errorMessage}</s-banner>}

        {fetcher.data?.message && (
          <s-banner tone={fetcher.data.success ? "success" : "critical"}>
            {fetcher.data.message}
          </s-banner>
        )}

        <s-text-field
          label="Zone Name"
          name="zoneName"
          value={zoneName}
          placeholder="Example: USA & Canada"
          required
          onChange={(event) => setZoneName(event.currentTarget.value)}
        />

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Select Countries</s-heading>

          <s-text-field
            label="Search Countries"
            name="countrySearch"
            value={countrySearch}
            placeholder="Search by country name or code"
            onChange={(event) => setCountrySearch(event.currentTarget.value)}
          />

          <div
            style={{
              marginTop: "12px",

              maxHeight: "320px",

              overflowY: "auto",

              border: "1px solid #e1e1e1",

              borderRadius: "8px",

              padding: "12px",
            }}
          >
            <s-stack direction="block" gap="small">
              {filteredCountries.map((country) => (
                <s-checkbox
                  key={country.code}
                  label={`${country.name} (${country.code})`}
                  checked={selectedCountries.includes(country.code)}
                  onChange={() => toggleCountry(country.code)}
                />
              ))}
            </s-stack>
          </div>

          <s-paragraph>
            Selected countries:{" "}
            {selectedCountries.length > 0
              ? selectedCountries.join(", ")
              : "None"}
          </s-paragraph>
        </s-box>

        <s-select
          label="Rate Type"
          value={rateType}
          onChange={(event) => setRateType(event.currentTarget.value)}
        >
          <s-option value="packageWeight">Package Weight</s-option>

          <s-option value="flat">Flat Rate</s-option>
        </s-select>

        {rateType === "packageWeight" && (
          <>
            {rateSetups.length === 0 ? (
              <s-banner tone="warning">
                Create and save a weight setup on the Rate Setup page first.
              </s-banner>
            ) : (
              <s-select
                label="Saved Weight Setup"
                value={selectedSetupId}
                onChange={(event) =>
                  setSelectedSetupId(event.currentTarget.value)
                }
              >
                <s-option value="">Select a rate setup</s-option>

                {rateSetups.map((setup) => (
                  <s-option key={setup.id} value={String(setup.id)}>
                    {setup.name} — {setup._count.rates} rates
                  </s-option>
                ))}
              </s-select>
            )}
          </>
        )}

        {rateType === "flat" && (
          <>
            <s-text-field
              label="Rate Name"
              name="flatRateName"
              value={flatRateName}
              placeholder="Example: Standard Shipping"
              required
              onChange={(event) => setFlatRateName(event.currentTarget.value)}
            />

            <s-number-field
              label="Price"
              name="flatRatePrice"
              value={flatRatePrice}
              min="0"
              step="0.01"
              required
              onChange={(event) => setFlatRatePrice(event.currentTarget.value)}
            />
          </>
        )}

        <s-button
          variant="primary"
          onClick={saveZone}
          disabled={
            isSubmitting ||
            (rateType === "packageWeight" && rateSetups.length === 0)
          }
          {...(isSubmitting ? { loading: true } : {})}
        >
          Save Zone
        </s-button>
      </s-section>

      <s-section heading="Saved Shipping Zones">
        {zones.length === 0 ? (
          <s-paragraph>No shipping zones have been saved yet.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {zones.map((zone) => (
              <s-box
                key={zone.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-heading>{zone.name}</s-heading>

                <s-paragraph>
                  Countries: {zone.countryCodes.join(", ")}
                </s-paragraph>

                <s-paragraph>
                  Rate type:{" "}
                  {zone.rateType === "packageWeight"
                    ? "Package Weight"
                    : "Flat Rate"}
                </s-paragraph>

                {zone.rateType === "packageWeight" && (
                  <s-paragraph>
                    Weight setup:{" "}
                    {zone.rateSetup?.name || "Setup not available"}
                  </s-paragraph>
                )}

                {zone.rateType === "flat" && (
                  <>
                    <s-paragraph>Rate name: {zone.flatRateName}</s-paragraph>

                    <s-paragraph>Price: {zone.flatRatePrice}</s-paragraph>
                  </>
                )}

                <s-paragraph>Status: {zone.status}</s-paragraph>

                {zone.status !== "ACTIVE" && (
                  <s-button
                    variant="primary"
                    onClick={() => uploadZone(zone.id)}
                    disabled={isSubmitting}
                    {...(isSubmitting ? { loading: true } : {})}
                  >
                    Upload to Shopify
                  </s-button>
                )}

                <s-button
                  tone="critical"
                  variant="tertiary"
                  onClick={() => deleteZone(zone.id)}
                  disabled={zone.status === "ACTIVE" || isSubmitting}
                >
                  Delete Zone
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
