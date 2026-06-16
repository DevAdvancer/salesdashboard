import {
  getLeadAmountValue,
  isAmountMissing,
  isCloseRequiredFieldsMissing,
  isTextMissing,
  getMissingCloseRequiredFields,
} from "@/lib/utils/lead-close-gate";

const isBackoutStatus = (status: string) => {
  const text = String(status).trim().toLowerCase();
  if (!text) return false;
  return (
    text === "backout" ||
    text === "backedout" ||
    text === "backed out" ||
    text === "back out" ||
    text.replace(/\s+/g, "") === "backedout" ||
    text.replace(/\s+/g, "") === "backout"
  );
};

describe("lead-close-gate", () => {
  describe("getLeadAmountValue", () => {
    it("returns the uniform `amount` key when present", () => {
      expect(getLeadAmountValue({ amount: "100" })).toBe("100");
    });

    it("falls back to the legacy `field_15` key when `amount` is missing", () => {
      expect(getLeadAmountValue({ field_15: "250" })).toBe("250");
    });

    it("prefers the uniform `amount` key over the legacy alias", () => {
      expect(
        getLeadAmountValue({ amount: "100", field_15: "250" }),
      ).toBe("100");
    });

    it("returns undefined when neither key is present", () => {
      expect(getLeadAmountValue({})).toBeUndefined();
    });

    it("handles null/undefined lead data safely", () => {
      expect(getLeadAmountValue(null)).toBeUndefined();
      expect(getLeadAmountValue(undefined)).toBeUndefined();
    });
  });

  describe("isAmountMissing", () => {
    it.each([
      [undefined, true],
      [null, true],
      [NaN, true],
      ["", true],
      ["   ", true],
      ["N/A", true],
      ["n/a", true],
      ["NA", true],
      ["abc", true],
    ])("treats %p as missing", (value, expected) => {
      expect(isAmountMissing(value)).toBe(expected);
    });

    it.each([
      [100, false],
      [0, false],
      ["100", false],
      ["100.50", false],
      ["0.01", false],
    ])("treats %p as present", (value, expected) => {
      expect(isAmountMissing(value)).toBe(expected);
    });
  });

  describe("isTextMissing", () => {
    it.each([
      [undefined, true],
      [null, true],
      ["", true],
      ["   ", true],
      ["N/A", true],
      ["n/a", true],
      ["NA", true],
    ])("treats %p as missing", (value, expected) => {
      expect(isTextMissing(value)).toBe(expected);
    });

    it.each([
      ["John", false],
      ["John Doe", false],
      ["0", false],
    ])("treats %p as present", (value, expected) => {
      expect(isTextMissing(value)).toBe(expected);
    });
  });

  describe("isCloseRequiredFieldsMissing", () => {
    it("returns false for closed leads regardless of field values", () => {
      const leadData = { amount: "", lastName: "", legalName: "" };
      const result = isCloseRequiredFieldsMissing({
        isClosed: true,
        closeStatus: "Closed",
        leadData,
        isBackoutStatus,
      });
      expect(result).toBe(false);
    });

    it("returns true when Amount is missing", () => {
      const leadData = {
        lastName: "Papasani",
        legalName: "Narendra",
      };
      expect(
        isCloseRequiredFieldsMissing({
          isClosed: false,
          closeStatus: "Closed",
          leadData,
          isBackoutStatus,
        }),
      ).toBe(true);
    });

    it("returns true when LastName is missing", () => {
      const leadData = {
        amount: "100",
        legalName: "Narendra",
      };
      expect(
        isCloseRequiredFieldsMissing({
          isClosed: false,
          closeStatus: "Closed",
          leadData,
          isBackoutStatus,
        }),
      ).toBe(true);
    });

    it("returns true when Legal Name is missing", () => {
      const leadData = {
        amount: "100",
        lastName: "Papasani",
      };
      expect(
        isCloseRequiredFieldsMissing({
          isClosed: false,
          closeStatus: "Closed",
          leadData,
          isBackoutStatus,
        }),
      ).toBe(true);
    });

    it("returns false when all three required fields are filled", () => {
      const leadData = {
        amount: "100",
        lastName: "Papasani",
        legalName: "Narendra",
      };
      expect(
        isCloseRequiredFieldsMissing({
          isClosed: false,
          closeStatus: "Closed",
          leadData,
          isBackoutStatus,
        }),
      ).toBe(false);
    });

    it("treats `N/A` as missing for Amount, LastName, and Legal Name", () => {
      const leadData = {
        amount: "N/A",
        lastName: "N/A",
        legalName: "N/A",
      };
      expect(
        isCloseRequiredFieldsMissing({
          isClosed: false,
          closeStatus: "Closed",
          leadData,
          isBackoutStatus,
        }),
      ).toBe(true);
    });

    it("treats whitespace-only values as missing", () => {
      const leadData = {
        amount: "   ",
        lastName: "   ",
        legalName: "   ",
      };
      expect(
        isCloseRequiredFieldsMissing({
          isClosed: false,
          closeStatus: "Closed",
          leadData,
          isBackoutStatus,
        }),
      ).toBe(true);
    });

    it("bypasses the gate for Backout status even when fields are missing", () => {
      const leadData = { amount: "", lastName: "", legalName: "" };
      const result = isCloseRequiredFieldsMissing({
        isClosed: false,
        closeStatus: "Backout",
        leadData,
        isBackoutStatus,
      });
      expect(result).toBe(false);
    });

    it("bypasses the gate for `Backout`, `backedout`, `Backed Out`", () => {
      ["Backout", "backedout", "Backed Out", "Back Out"].forEach(
        (status) => {
          const leadData = { amount: "", lastName: "", legalName: "" };
          const result = isCloseRequiredFieldsMissing({
            isClosed: false,
            closeStatus: status,
            leadData,
            isBackoutStatus,
          });
          expect(result).toBe(false);
        },
      );
    });

    it("accepts the legacy `field_15` Amount value", () => {
      const leadData = {
        field_15: "250",
        lastName: "Papasani",
        legalName: "Narendra",
      };
      expect(
        isCloseRequiredFieldsMissing({
          isClosed: false,
          closeStatus: "Closed",
          leadData,
          isBackoutStatus,
        }),
      ).toBe(false);
    });
  });

  describe("getMissingCloseRequiredFields", () => {
    it("returns an empty list when all three are filled", () => {
      const leadData = {
        amount: "100",
        lastName: "Papasani",
        legalName: "Narendra",
      };
      expect(getMissingCloseRequiredFields(leadData)).toEqual([]);
    });

    it("lists Amount, Last Name, and Legal Name in order when all are missing", () => {
      const leadData = { amount: "", lastName: "", legalName: "" };
      expect(getMissingCloseRequiredFields(leadData)).toEqual([
        "Total Amount to be Paid",
        "Last Name",
        "Legal Name",
      ]);
    });

    it("lists only the missing field", () => {
      const leadData = {
        amount: "100",
        lastName: "Papasani",
        legalName: "",
      };
      expect(getMissingCloseRequiredFields(leadData)).toEqual(["Legal Name"]);
    });

    it("recognizes the legacy `field_15` Amount as present", () => {
      const leadData = {
        field_15: "100",
        lastName: "Papasani",
        legalName: "Narendra",
      };
      expect(getMissingCloseRequiredFields(leadData)).toEqual([]);
    });
  });
});
