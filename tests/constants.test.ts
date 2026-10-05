import { describe, expect, it } from "vitest";
import {
  MINIMUM_BID_INCREMENT_CENTS,
  MINIMUM_BID_CENTS,
  TOTAL_SLOTS,
} from "../src/config/constants";

describe("product constants", () => {
  it("has exactly 100 advertising spots, per spec", () => {
    expect(TOTAL_SLOTS).toBe(100);
  });

  it("has a minimum bid and increment of exactly $1", () => {
    expect(MINIMUM_BID_CENTS).toBe(100);
    expect(MINIMUM_BID_INCREMENT_CENTS).toBe(100);
  });
});
