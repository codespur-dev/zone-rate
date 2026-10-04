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

const COUNTRIES = COUNTRY_CODES
  .filter((code) => !SHOPIFY_UNSUPPORTED_COUNTRY_CODES.has(code))
  .map((code) => ({
    code,
    name: regionNames.of(code) || code,
  }))
  .sort((first, second) => first.name.localeCompare(second.name));

const buildShopifyZoneInput = (zone, rateRows, currencyCode) => {
  const countries = JSON.parse(zone.countries)
  .filter((code) => !SHOPIFY_UNSUPPORTED_COUNTRY_CODES.has(code))
  .map((code) => ({
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

  const existingZones = await db.shippingZone.findMany({
  where: {
    shop: session.shop,
  },
  select: {
    countries: true,
  },
});

const alreadyAssignedCountries = new Set(
  existingZones.flatMap((existingZone) => {
    try {
      return JSON.parse(existingZone.countries);
    } catch {
      return [];
    }
  }),
);

const duplicateCountries = selectedCountries.filter(
  (countryCode) =>
    alreadyAssignedCountries.has(countryCode),
);

if (duplicateCountries.length > 0) {
  return {
    success: false,
    intent: "create",
    message: `These countries are already assigned to another zone: ${duplicateCountries.join(
      ", ",
    )}`,
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

  const usedCountryCodes = new Set(
  zones.flatMap((zone) => zone.countryCodes || []),
);

const availableCountryCodes = COUNTRIES.filter(
  (country) => !usedCountryCodes.has(country.code),
).map((country) => country.code);

const allAvailableSelected =
  availableCountryCodes.length > 0 &&
  availableCountryCodes.every((code) =>
    selectedCountries.includes(code),
  );

const selectAllRemainingCountries = () => {
  setSelectedCountries(availableCountryCodes);
};

const clearSelectedCountries = () => {
  setSelectedCountries([]);
};

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
  if (usedCountryCodes.has(countryCode)) {
    return;
  }

  setSelectedCountries((currentCountries) => {
    if (currentCountries.includes(countryCode)) {
      return currentCountries.filter(
        (code) => code !== countryCode,
      );
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

        <div className="zone-form-grid">
          <s-text-field
            label="Zone Name"
            name="zoneName"
            value={zoneName}
            placeholder="Example: USA & Canada"
            required
            onChange={(event) => setZoneName(event.currentTarget.value)}
          />

          <s-select
            label="Rate Type"
            value={rateType}
            onChange={(event) => setRateType(event.currentTarget.value)}
          >
            <s-option value="packageWeight">Package Weight</s-option>
            <s-option value="flat">Flat Rate</s-option>
          </s-select>
        </div>

        <s-box padding="base" borderWidth="base" borderRadius="base">
  <div className="country-section-header">
  <div>
    <h3 className="country-section-title">
      Select Countries
    </h3>

    <p className="country-section-summary">
      <strong>{availableCountryCodes.length}</strong> available
      <span>•</span>
      <strong>{usedCountryCodes.size}</strong> already assigned
      <span>•</span>
      <strong>{selectedCountries.length}</strong> selected
    </p>
  </div>

  <button
    type="button"
    className={
      allAvailableSelected
        ? "country-action-button clear"
        : "country-action-button"
    }
    onClick={
      allAvailableSelected
        ? clearSelectedCountries
        : selectAllRemainingCountries
    }
    disabled={availableCountryCodes.length === 0}
  >
    {allAvailableSelected
      ? "Clear selection"
      : "Select all remaining"}
  </button>
</div>

  <s-text-field
    label="Search Countries"
    name="countrySearch"
    value={countrySearch}
    placeholder="Search by country name or code"
    onChange={(event) =>
      setCountrySearch(event.currentTarget.value)
    }
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
      {filteredCountries.map((country) => {
        const isAlreadyUsed = usedCountryCodes.has(
          country.code,
        );

        return (
          <div
            key={country.code}
            style={{
              opacity: isAlreadyUsed ? 0.5 : 1,
              cursor: isAlreadyUsed
                ? "not-allowed"
                : "pointer",
            }}
          >
            <s-checkbox
              label={`${country.name} (${country.code})${
                isAlreadyUsed
                  ? " — Already assigned"
                  : ""
              }`}
              checked={
                isAlreadyUsed ||
                selectedCountries.includes(country.code)
              }
              disabled={isAlreadyUsed}
              onChange={() =>
                toggleCountry(country.code)
              }
            />
          </div>
        );
      })}
    </s-stack>
  </div>

  <s-paragraph>
    Selected countries: {selectedCountries.length}
  </s-paragraph>

  {availableCountryCodes.length === 0 && (
    <s-banner tone="info">
      All available countries have already been assigned
      to shipping zones.
    </s-banner>
  )}
</s-box>

        {rateType === "packageWeight" && (
          <div className="zone-form-grid">
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
          </div>
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
          <div className="table-scroll">
            <table className="data-table zone-table">
              <thead>
                <tr>
                  <th>Zone Name</th>
                  <th>Countries</th>
                  <th>Rate Type</th>
                  <th>Rate Details</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((zone) => (
                  <tr key={zone.id}>
                    <td>
                      <strong>{zone.name}</strong>
                    </td>
                    <td
                      className="country-cell"
                      title={zone.countryCodes.join(", ")}
                    >
                      {zone.countryCodes.join(", ")}
                    </td>
                    <td>
                      {zone.rateType === "packageWeight"
                        ? "Package Weight"
                        : "Flat Rate"}
                    </td>
                    <td>
                      {zone.rateType === "packageWeight"
                        ? zone.rateSetup?.name || "Setup not available"
                        : `${zone.flatRateName || "Flat rate"} — ${zone.flatRatePrice}`}
                    </td>
                    <td>
                      <span
                        className={`status-badge ${zone.status === "ACTIVE" ? "active" : "draft"}`}
                      >
                        {zone.status}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions">
                        {zone.status !== "ACTIVE" && (
                          <s-button
                            variant="primary"
                            onClick={() => uploadZone(zone.id)}
                            disabled={isSubmitting}
                          >
                            Upload
                          </s-button>
                        )}
                        <s-button
                          tone="critical"
                          variant="tertiary"
                          onClick={() => deleteZone(zone.id)}
                          disabled={zone.status === "ACTIVE" || isSubmitting}
                        >
                          Delete
                        </s-button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      <style>{`
        .zone-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px 20px;
          margin: 18px 0;
        }
        .table-scroll { overflow-x: auto; width: 100%; }
        .data-table {
          width: 100%;
          min-width: 900px;
          border-collapse: separate;
          border-spacing: 0;
          border: 1px solid #e1e3e5;
          border-radius: 10px;
          overflow: hidden;
          background: #fff;
        }
        .data-table th {
          padding: 13px 14px;
          text-align: left;
          font-size: 13px;
          font-weight: 650;
          background: #f6f6f7;
          border-bottom: 1px solid #e1e3e5;
          white-space: nowrap;
        }
        .data-table td {
          padding: 13px 14px;
          border-bottom: 1px solid #ebebeb;
          vertical-align: middle;
          white-space: nowrap;
        }
        .data-table tbody tr:last-child td { border-bottom: 0; }
        .data-table tbody tr:hover { background: #fafafa; }
        .country-cell {
          max-width: 260px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .table-actions { display: flex; align-items: center; gap: 8px; }
        .status-badge {
          display: inline-flex;
          padding: 4px 9px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 650;
        }
        .status-badge.active { color: #0c5132; background: #e3f1df; }
        .status-badge.draft { color: #614b00; background: #fff1c8; }
        @media (max-width: 700px) {
          .zone-form-grid { grid-template-columns: 1fr; gap: 14px; }
        }
        .country-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 18px;
        }

        .country-section-title {
          margin: 0 0 5px;
          color: #202223;
          font-size: 16px;
          font-weight: 650;
          line-height: 1.3;
        }

        .country-section-summary {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 7px;
          margin: 0;
          color: #6d7175;
          font-size: 13px;
          line-height: 1.4;
        }

        .country-section-summary strong {
          color: #303030;
          font-weight: 600;
        }

        .country-section-summary span {
          color: #b5b5b5;
        }

        .country-action-button {
          flex-shrink: 0;
          min-height: 36px;
          padding: 7px 14px;
          border: 1px solid #8c9196;
          border-radius: 8px;
          background: #ffffff;
          color: #202223;
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          line-height: 20px;
          cursor: pointer;
          box-shadow:
            0 1px 0 rgba(0, 0, 0, 0.05),
            inset 0 -1px 0 rgba(0, 0, 0, 0.08);
          transition:
            background 0.15s ease,
            border-color 0.15s ease,
            box-shadow 0.15s ease;
        }

        .country-action-button:hover {
          border-color: #616a75;
          background: #f6f6f7;
          box-shadow: 0 1px 1px rgba(0, 0, 0, 0.08);
        }

        .country-action-button:active {
          background: #ebebeb;
          box-shadow: none;
        }

        .country-action-button.clear {
          border-color: #d72c0d;
          color: #b42318;
          background: #fff8f7;
        }

        .country-action-button.clear:hover {
          background: #fff1ef;
        }

        .country-action-button:disabled {
          border-color: #d2d5d8;
          background: #f6f6f7;
          color: #8c9196;
          cursor: not-allowed;
          box-shadow: none;
        }

        @media (max-width: 600px) {
          .country-section-header {
            align-items: flex-start;
            flex-direction: column;
            gap: 12px;
          }

          .country-action-button {
            width: 100%;
          }
        }
      `}</style>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
