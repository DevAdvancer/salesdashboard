import {
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
});
