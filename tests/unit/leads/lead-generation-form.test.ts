import {
  buildLeadGenerationLeadData,
  getMissingLeadGenerationFields,
} from "@/lib/utils/lead-generation-form";

describe("lead generation form helpers", () => {
  it("requires the LinkedIn profile link with the other required fields", () => {
    expect(
      getMissingLeadGenerationFields({
        firstName: "Ada",
        lastName: "Lovelace",
        phone: "(555) 123-4567",
        visaStatus: "H1B",
        linkedinProfileUrl: "",
      }),
    ).toEqual(["LinkedIn profile link"]);
  });

  it("stores LinkedIn input as linkedinProfileUrl so duplicate checks can find it", () => {
    const data = buildLeadGenerationLeadData({
      firstName: " Ada ",
      middleName: " Byron ",
      lastName: " Lovelace ",
      email: " ada@example.com ",
      phone: " (555) 123-4567 ",
      visaStatus: " H1B ",
      linkedinProfileUrl: " https://www.linkedin.com/in/ada-lovelace/ ",
      resumeFileId: "resume-1",
      resumeFileName: "ada.pdf",
      userId: "user-1",
      userName: "Generator",
    });

    expect(data).toMatchObject({
      firstName: "Ada",
      middleName: "Byron",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "(555) 123-4567",
      visaStatus: "H1B",
      linkedinProfileUrl: "https://www.linkedin.com/in/ada-lovelace/",
      sourceName: "LinkedIN/Lead",
      source: "LinkedIN/Lead",
      generatedById: "user-1",
      generatedByName: "Generator",
      resumeFileId: "resume-1",
      resumeFileName: "ada.pdf",
    });
    expect(data).not.toHaveProperty("linkedinId");
  });
});
