// Deterministic test data, created through the ERP API of the test
// environment (so every business rule applies). It reproduces the business
// scenarios of the development data without reading or copying it:
//
// - Germany 1000/10/00 (EUR): account CUST-1000 (Müller Heiztechnik GmbH)
//   with the warehouses CUST-1100 (Stuttgart) and CUST-1200 (München),
//   units UNIT-STUTTGART and UNIT-MUENCHEN, materials MAT-001, MAT-002 and
//   MAT-101, list prices (ZP01), Sold-to prices (ZP02, ZP03) and a unit
//   price (ZP02) for München.
//   Stuttgart: 2 x MAT-001 = 8800.00 (ZP03), 10 x MAT-002 = 1895.00 (ZP02)
//   -> 10695.00 EUR
// - Poland 2000/10/00 (PLN): PL-1000 with UNIT-WARSZAWA; only MAT-101 has
//   a list price (45.50 PLN), MAT-001 deliberately none
// - Japan 3000/10/00 (JPY): JP-1000 with UNIT-OSAKA, list price of MAT-001
//   700000 JPY

const GERMANY = { salesOrganization: "1000", distributionChannel: "10", division: "00" };
const POLAND = { salesOrganization: "2000", distributionChannel: "10", division: "00" };
const JAPAN = { salesOrganization: "3000", distributionChannel: "10", division: "00" };

export const SALES_AREAS = { GERMANY, POLAND, JAPAN };

const CUSTOMERS = [
  ["CUST-1000", "Müller Heiztechnik GmbH", "Industriestraße 10", "70173", "Stuttgart", "DE", GERMANY],
  ["CUST-1100", "Müller Heiztechnik – Lager Stuttgart", "Hafenstraße 25", "70327", "Stuttgart", "DE", GERMANY],
  ["CUST-1200", "Müller Heiztechnik – Lager München", "Werkstraße 8", "80339", "München", "DE", GERMANY],
  ["PL-1000", "Warszawa Ogrzewanie Sp. z o.o.", "ul. Prosta 1", "00-838", "Warszawa", "PL", POLAND],
  ["JP-1000", "Osaka Heating KK", "1-1 Umeda", "530-0001", "Osaka", "JP", JAPAN],
];

const MATERIALS = [
  ["MAT-001", "Heat Pump"],
  ["MAT-002", "Thermostat"],
  ["MAT-101", "Filter Cartridge"],
];

const UNITS = [
  ["UNIT-STUTTGART", "Müller – Stuttgart", GERMANY, "CUST-1000", ["CUST-1000", "CUST-1100", "CUST-1200"], "CUST-1100"],
  ["UNIT-MUENCHEN", "Müller – München", GERMANY, "CUST-1000", ["CUST-1100", "CUST-1200"], "CUST-1200"],
  ["UNIT-WARSZAWA", "Warszawa", POLAND, "PL-1000", ["PL-1000"], "PL-1000"],
  ["UNIT-OSAKA", "Osaka", JAPAN, "JP-1000", ["JP-1000"], "JP-1000"],
];

/** Creates the test data; returns the IDs of the price conditions */
export async function createFixtures(api) {
  const call = async (method, path, body, expected) => {
    const response = await api(method, path, body);
    if (response.status !== expected) {
      throw new Error(`Fixture ${method} ${path} answered ${response.status}: ${JSON.stringify(response.body)}`);
    }
    return response.body;
  };

  for (const [materialNumber, description] of MATERIALS) {
    await call("POST", "/materials", { materialNumber, description }, 201);
  }
  for (const [customerNumber, name, street, postalCode, city, country, salesArea] of CUSTOMERS) {
    await call("POST", "/customers", { customerNumber, name, street, postalCode, city, country }, 201);
    await call("POST", `/customers/${customerNumber}/sales-areas`, salesArea, 201);
  }
  // Accounts: the owner is the account itself; members are listed
  await call("PUT", "/customer-accounts/CUST-1000/members", { memberCustomerNumbers: ["CUST-1100", "CUST-1200"] }, 200);
  await call("PUT", "/customer-accounts/PL-1000/members", { memberCustomerNumbers: [] }, 200);
  await call("PUT", "/customer-accounts/JP-1000/members", { memberCustomerNumbers: [] }, 200);
  for (const [unitId, name, salesArea, account, shipTos, defaultShipTo] of UNITS) {
    await call(
      "POST",
      "/b2b-units",
      {
        unitId,
        name,
        ...salesArea,
        accountCustomerNumber: account,
        soldToCustomerNumber: account,
        billToCustomerNumber: account,
        payerCustomerNumber: account,
        shipToCustomerNumbers: shipTos,
        defaultShipToCustomerNumber: defaultShipTo,
      },
      201,
    );
  }

  const condition = async (body) =>
    (await call("POST", "/price-conditions", body, 201)).conditionId;
  const listPrice = (salesArea, materialNumber, amount) =>
    condition({ conditionTypeCode: "ZP01", ...salesArea, materialNumber, scope: "SALES_AREA", amount, validFrom: "1900-01-01" });

  return {
    conditions: {
      listMat001: await listPrice(GERMANY, "MAT-001", "4500.00"),
      listMat002: await listPrice(GERMANY, "MAT-002", "199.00"),
      listMat101: await listPrice(GERMANY, "MAT-101", "11.11"),
      soldToMat002: await condition({ conditionTypeCode: "ZP02", ...GERMANY, materialNumber: "MAT-002", scope: "SOLD_TO", soldToCustomerNumber: "CUST-1000", amount: "189.50", validFrom: "2026-01-01" }),
      muenchenMat002: await condition({ conditionTypeCode: "ZP02", ...GERMANY, materialNumber: "MAT-002", scope: "B2B_UNIT", unitId: "UNIT-MUENCHEN", amount: "179.00", validFrom: "2026-06-15" }),
      specialMat001: await condition({ conditionTypeCode: "ZP03", ...GERMANY, materialNumber: "MAT-001", scope: "SOLD_TO", soldToCustomerNumber: "CUST-1000", amount: "4400.00", validFrom: "2026-10-29" }),
      japanMat001: await listPrice(JAPAN, "MAT-001", "700000"),
      polandMat101: await listPrice(POLAND, "MAT-101", "45.50"),
    },
  };
}
