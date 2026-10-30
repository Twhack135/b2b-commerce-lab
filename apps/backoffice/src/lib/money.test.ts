import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCalendarDate, todayIsoDate } from "./dates.ts";
import { amountError, formatAmount, formatApiAmount, normalizeAmount } from "./money.ts";

describe("amountError", () => {
  for (const valid of ["4200.50", "4200,50", "0.01", "9999999999.99", "42", "42.5", " 199.00 ", "007.10"]) {
    it(`accepts "${valid}"`, () => {
      assert.equal(amountError(valid), undefined);
    });
  }

  for (const [input, message] of [
    ["", "Amount is required."],
    ["   ", "Amount is required."],
    ["abc", "Enter an amount, for example 4200.50."],
    ["-5", "Enter an amount, for example 4200.50."],
    ["1e3", "Enter an amount, for example 4200.50."],
    ["4,200.50", "Enter an amount, for example 4200.50."],
    ["1.", "Enter an amount, for example 4200.50."],
    ["1.999", "Use at most two decimal places."],
    ["10000000000", "Amount must not exceed 9,999,999,999.99."],
    ["0", "Amount must be greater than 0."],
    ["0.00", "Amount must be greater than 0."],
  ] as const) {
    it(`rejects "${input}"`, () => {
      assert.equal(amountError(input), message);
    });
  }
});

describe("normalizeAmount", () => {
  for (const [input, expected] of [
    ["4200.5", "4200.50"],
    ["4200,50", "4200.50"],
    ["42", "42.00"],
    ["007.10", "7.10"],
    ["0.1", "0.10"],
    ["9999999999.99", "9999999999.99"],
  ] as const) {
    it(`turns "${input}" into "${expected}"`, () => {
      assert.equal(normalizeAmount(input), expected);
    });
  }

  it("keeps amounts that a floating-point number would change", () => {
    // As a number, 9999999999.99 + 0.01 or 0.1 * 3 would not be exact
    assert.equal(normalizeAmount("9999999999.99"), "9999999999.99");
    assert.equal(normalizeAmount("1234567890.12"), "1234567890.12");
  });
});

describe("formatAmount", () => {
  for (const [input, expected] of [
    ["0.10", "0.10"],
    ["199.00", "199.00"],
    ["4200.50", "4,200.50"],
    ["999989999999000.01", "999,989,999,999,000.01"],
    ["-1234.50", "-1,234.50"],
    ["not a number", "not a number"],
  ] as const) {
    it(`formats "${input}" as "${expected}"`, () => {
      assert.equal(formatAmount(input), expected);
    });
  }
});

describe("dates", () => {
  for (const valid of ["2026-01-01", "2028-02-29", "1900-01-01", "9999-12-31"]) {
    it(`accepts ${valid}`, () => {
      assert.equal(isCalendarDate(valid), true);
    });
  }

  for (const invalid of ["2026-02-30", "2026-02-29", "2026-13-01", "1899-12-31", "0050-01-01", "01.03.2026", "2026-3-1", ""]) {
    it(`rejects "${invalid}"`, () => {
      assert.equal(isCalendarDate(invalid), false);
    });
  }

  it("uses the local calendar day for today", () => {
    assert.equal(todayIsoDate(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
    assert.equal(todayIsoDate(new Date(2026, 11, 31, 0, 0)), "2026-12-31");
  });
});

describe("amounts in currencies with other decimal places", () => {
  // As configured in the ERP: EUR and PLN have 2 decimal places, JPY has 0
  const PLN = 2;
  const JPY = 0;

  it("keeps the two-decimal behaviour for EUR and PLN", () => {
    assert.equal(amountError("1.999", PLN), amountError("1.999"));
    assert.equal(normalizeAmount("189,5", PLN), "189.50");
    assert.equal(formatAmount("4400.00", PLN), "4,400.00");
  });

  for (const valid of ["700000", "1", " 4400 ", "9999999999"]) {
    it(`accepts the JPY amount "${valid}"`, () => {
      assert.equal(amountError(valid, JPY), undefined);
    });
  }

  for (const [input, message] of [
    ["4400.5", "Enter a whole amount: this currency has no decimal places."],
    ["4400,50", "Enter a whole amount: this currency has no decimal places."],
    ["0.01", "Enter a whole amount: this currency has no decimal places."],
    ["abc", "Enter an amount, for example 4200."],
    ["10000000000", "Amount must not exceed 9,999,999,999."],
    ["0", "Amount must be greater than 0."],
  ] as const) {
    it(`rejects the JPY amount "${input}"`, () => {
      assert.equal(amountError(input, JPY), message);
    });
  }

  it("normalizes JPY amounts without a decimal point", () => {
    assert.equal(normalizeAmount("0700000", JPY), "700000");
  });

  it("formats JPY amounts without decimal places", () => {
    assert.equal(formatAmount("700000", JPY), "700,000");
    assert.equal(formatAmount("-1500", JPY), "-1,500");
    // An amount with decimals is never shown as a plausible JPY amount
    assert.equal(formatAmount("700000.00", JPY), "700000.00");
    assert.equal(formatAmount("700000", PLN), "700000");
  });
});

describe("formatApiAmount", () => {
  it("formats with the decimal places of the currency", () => {
    assert.equal(formatApiAmount("4400.00", 2), "4,400.00");
    assert.equal(formatApiAmount("4400.00", 2), formatApiAmount("4400.00"));
    assert.equal(formatApiAmount("700000", 0), "700,000");
    assert.equal(formatApiAmount("10695.00", 2), "10,695.00");
  });

  it("uses the decimal places as sent while the currency is not known", () => {
    assert.equal(formatApiAmount("700000"), "700,000");
    assert.equal(formatApiAmount("189.50"), "189.50");
  });

  it("never shows a mismatching amount as a plausible one", () => {
    assert.equal(formatApiAmount("700000.50", 0), "700000.50");
  });
});
