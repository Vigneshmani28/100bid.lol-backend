import { describe, expect, it } from "vitest";
import { formatCentsAsUsd, isValidCentsAmount, centsToDollars, dollarsToCents } from "../src/lib/money";

describe("dollarsToCents", () => {
  it("converts whole dollars", () => {
    expect(dollarsToCents(1)).toBe(100);
    expect(dollarsToCents(2500)).toBe(250000);
  });

  it("rounds fractional cents instead of truncating", () => {
    expect(dollarsToCents(1.996)).toBe(200); // 199.6 cents -> rounds up
    expect(dollarsToCents(1.994)).toBe(199); // 199.4 cents -> rounds down
    expect(dollarsToCents(0.001)).toBe(0);
  });

  it("throws on non-finite input", () => {
    expect(() => dollarsToCents(Number.NaN)).toThrow();
    expect(() => dollarsToCents(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("centsToDollars", () => {
  it("converts cents back to dollars", () => {
    expect(centsToDollars(100)).toBe(1);
    expect(centsToDollars(10050)).toBe(100.5);
  });
});

describe("formatCentsAsUsd", () => {
  it("formats whole-dollar amounts without decimals", () => {
    expect(formatCentsAsUsd(10000)).toBe("$100");
  });

  it("formats fractional amounts with two decimals", () => {
    expect(formatCentsAsUsd(10050)).toBe("$100.50");
  });

  it("uses US digit grouping for large amounts", () => {
    expect(formatCentsAsUsd(1000000)).toBe("$10,000");
  });
});

describe("isValidCentsAmount", () => {
  it("accepts positive integers", () => {
    expect(isValidCentsAmount(100)).toBe(true);
    expect(isValidCentsAmount(1)).toBe(true);
  });

  it("rejects zero, negatives, floats, and non-numbers", () => {
    expect(isValidCentsAmount(0)).toBe(false);
    expect(isValidCentsAmount(-100)).toBe(false);
    expect(isValidCentsAmount(10.5)).toBe(false);
    expect(isValidCentsAmount("100")).toBe(false);
    expect(isValidCentsAmount(null)).toBe(false);
    expect(isValidCentsAmount(undefined)).toBe(false);
  });
});
