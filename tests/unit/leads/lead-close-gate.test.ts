import {
  getLeadAmountValue,
  isAmountMissing,
  isCloseRequiredFieldsMissing,
  isTextMissing,
  getMissingCloseRequiredFields,
  isPaymentDetailsMissing,
  getMissingPaymentFields,
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

    it("returns true when LinkedIn Profile URL is missing", () => {
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
      ).toBe(true);
    });

    it("returns true when LinkedIn Profile URL is blank", () => {
      const leadData = {
        amount: "100",
        lastName: "Papasani",
        legalName: "Narendra",
        linkedinProfileUrl: "",
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

    it("returns true when LinkedIn Profile URL is N/A", () => {
      const leadData = {
        amount: "100",
        lastName: "Papasani",
        legalName: "Narendra",
        linkedinProfileUrl: "N/A",
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

    it("returns false when all required fields including LinkedIn Profile URL are filled", () => {
      const leadData = {
        amount: "100",
        lastName: "Papasani",
        legalName: "Narendra",
        linkedinProfileUrl: "https://linkedin.com/in/test",
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

    it("treats `N/A` as missing for Amount, LastName, Legal Name, and LinkedIn Profile URL", () => {
      const leadData = {
        amount: "N/A",
        lastName: "N/A",
        legalName: "N/A",
        linkedinProfileUrl: "N/A",
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

    it("bypasses the gate for Backout status even when LinkedIn Profile URL is missing", () => {
      const leadData = { amount: "100", lastName: "Test", legalName: "Name" };
      const result = isCloseRequiredFieldsMissing({
        isClosed: false,
        closeStatus: "Backout",
        leadData,
        isBackoutStatus,
      });
      expect(result).toBe(false);
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

    it("accepts the legacy `field_15` Amount value (LinkedIn URL still required)", () => {
      const leadData = {
        field_15: "250",
        lastName: "Papasani",
        legalName: "Narendra",
        linkedinProfileUrl: "https://linkedin.com/in/test",
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

    it("accepts LinkedIn values stored under the legacy aliases before closing", () => {
      const leadData = {
        amount: "250",
        lastName: "Papasani",
        legalName: "Narendra",
        field_16: "https://linkedin.com/in/legacy-test",
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
    it("returns an empty list when all four are filled", () => {
      const leadData = {
        amount: "100",
        lastName: "Papasani",
        legalName: "Narendra",
        linkedinProfileUrl: "https://linkedin.com/in/test",
      };
      expect(getMissingCloseRequiredFields(leadData)).toEqual([]);
    });

    it("lists Amount, Last Name, Legal Name, and LinkedIn Profile URL in order when all are missing", () => {
      const leadData = {
        amount: "",
        lastName: "",
        legalName: "",
        linkedinProfileUrl: "",
      };
      expect(getMissingCloseRequiredFields(leadData)).toEqual([
        "Total Amount to be Paid",
        "Last Name",
        "Legal Name",
        "LinkedIn Profile URL",
      ]);
    });

    it("lists only the missing field", () => {
      const leadData = {
        amount: "100",
        lastName: "Papasani",
        legalName: "Narendra",
        linkedinProfileUrl: "https://linkedin.com/in/test",
      };
      expect(getMissingCloseRequiredFields(leadData)).toEqual([]);
    });

    it("lists missing LinkedIn Profile URL specifically", () => {
      const leadData = {
        amount: "100",
        lastName: "Papasani",
        legalName: "Narendra",
      };
      expect(getMissingCloseRequiredFields(leadData)).toEqual([
        "LinkedIn Profile URL",
      ]);
    });

    it("recognizes the legacy `field_15` Amount as present but LinkedIn URL is still required", () => {
      const leadData = {
        field_15: "100",
        lastName: "Papasani",
        legalName: "Narendra",
      };
      expect(getMissingCloseRequiredFields(leadData)).toEqual([
        "LinkedIn Profile URL",
      ]);
    });

    it("does not report LinkedIn as missing when only the legacy field_16 alias is filled", () => {
      const leadData = {
        amount: "100",
        lastName: "Papasani",
        legalName: "Narendra",
        field_16: "https://linkedin.com/in/legacy-test",
      };
      expect(getMissingCloseRequiredFields(leadData)).toEqual([]);
    });
  });

  describe("isPaymentDetailsMissing", () => {
    it("returns false when both paymentPercent and paymentMonths are filled", () => {
      const values = { paymentPercent: "50", paymentMonths: "12" };
      expect(isPaymentDetailsMissing(values, "Closed")).toBe(false);
    });

    it("returns true when paymentPercent is missing", () => {
      const values = { paymentPercent: "", paymentMonths: "12" };
      expect(isPaymentDetailsMissing(values, "Closed")).toBe(true);
    });

    it("returns true when paymentMonths is missing", () => {
      const values = { paymentPercent: "50", paymentMonths: "" };
      expect(isPaymentDetailsMissing(values, "Closed")).toBe(true);
    });

    it("returns true for N/A-like values in paymentPercent", () => {
      const values = { paymentPercent: "N/A", paymentMonths: "12" };
      expect(isPaymentDetailsMissing(values, "Closed")).toBe(true);
    });

    it("returns true for N/A-like values in paymentMonths", () => {
      const values = { paymentPercent: "50", paymentMonths: "n/a" };
      expect(isPaymentDetailsMissing(values, "Closed")).toBe(true);
    });

    it("returns true for whitespace-only values", () => {
      const values = { paymentPercent: "   ", paymentMonths: "   " };
      expect(isPaymentDetailsMissing(values, "Closed")).toBe(true);
    });

    it("returns false for undefined/null paymentPercent and paymentMonths when status is Backout", () => {
      const values = { paymentPercent: undefined, paymentMonths: null };
      expect(isPaymentDetailsMissing(values, "Backout")).toBe(false);
    });

    it("returns false for undefined/null paymentPercent and paymentMonths when status is Backed Out", () => {
      const values = { paymentPercent: undefined, paymentMonths: null };
      expect(isPaymentDetailsMissing(values, "Backed Out")).toBe(false);
    });
  });

  describe("getMissingPaymentFields", () => {
    it("returns empty array when both fields are filled", () => {
      const values = { paymentPercent: "50", paymentMonths: "12" };
      expect(getMissingPaymentFields(values, "Closed")).toEqual([]);
    });

    it("lists both fields when both are missing", () => {
      const values = { paymentPercent: "", paymentMonths: "" };
      expect(getMissingPaymentFields(values, "Closed")).toEqual([
        "Payment Percentage",
        "Payment Months",
      ]);
    });

    it("lists only Payment Percentage when it is missing", () => {
      const values = { paymentPercent: "", paymentMonths: "12" };
      expect(getMissingPaymentFields(values, "Closed")).toEqual([
        "Payment Percentage",
      ]);
    });

    it("returns empty array for Backout status even when fields are missing", () => {
      const values = { paymentPercent: "", paymentMonths: "" };
      expect(getMissingPaymentFields(values, "Backout")).toEqual([]);
    });
  });
});
