import {
  getLinkedinProfileDefaultValues,
  getLinkedinProfileValue,
  isLinkedinProfileField,
} from "@/lib/utils/lead-linkedin-field";
import { FormField } from "@/lib/types";

describe("lead linkedin field helpers", () => {
  const linkedinProfileUrlField: FormField = {
    id: "configured-linkedin",
    type: "text",
    label: "LinkedIn Profile URL",
    key: "linkedinUrl",
    required: false,
    visible: true,
    order: 10,
  };

  const legacyField16Field: FormField = {
    id: "field_16",
    type: "text",
    label: "field_16",
    key: "field_16",
    required: true,
    visible: true,
    order: 13,
  };

  it("recognizes a configured LinkedIn profile URL field by label", () => {
    expect(isLinkedinProfileField(linkedinProfileUrlField)).toBe(true);
  });

  it("reads the configured LinkedIn value for duplicate checks", () => {
    expect(
      getLinkedinProfileValue(
        { linkedinUrl: " https://linkedin.com/in/example " },
        [linkedinProfileUrlField],
      ),
    ).toBe("https://linkedin.com/in/example");
  });

  it("builds default values for configured LinkedIn fields and canonical storage", () => {
    expect(
      getLinkedinProfileDefaultValues(
        [linkedinProfileUrlField],
        " https://linkedin.com/in/accepted-request ",
      ),
    ).toEqual({
      linkedinProfileUrl: "https://linkedin.com/in/accepted-request",
      linkedinUrl: "https://linkedin.com/in/accepted-request",
    });
  });

  it("recognizes the legacy field_16 key as a LinkedIn profile alias on read", () => {
    expect(isLinkedinProfileField(legacyField16Field)).toBe(true);
    expect(
      getLinkedinProfileValue(
        { field_16: "https://linkedin.com/in/legacy" },
        [legacyField16Field],
      ),
    ).toBe("https://linkedin.com/in/legacy");
  });

  it("falls back to field_16 when no configured field has a value", () => {
    expect(
      getLinkedinProfileValue(
        { field_16: "https://linkedin.com/in/legacy-fallback" },
        [],
      ),
    ).toBe("https://linkedin.com/in/legacy-fallback");
  });

  it("does not write back to the legacy field_16 key (read-only alias)", () => {
    expect(
      getLinkedinProfileDefaultValues(
        [legacyField16Field],
        "https://linkedin.com/in/new-value",
      ),
    ).toEqual({
      linkedinProfileUrl: "https://linkedin.com/in/new-value",
    });
  });
});

