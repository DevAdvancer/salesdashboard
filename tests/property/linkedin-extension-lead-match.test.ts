jest.mock("node-appwrite", () => ({ Query: { select: (fields: string[]) => JSON.stringify({ select: fields }) } }));
jest.mock("@/lib/server/appwrite-pagination", () => ({ listAllDocuments: jest.fn() }));
import fc from "fast-check";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { linkedinProfileHasLead } from "@/lib/server/linkedin-extension-leads";

const databases = {} as Parameters<typeof linkedinProfileHasLead>[0];
const slug = fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-"), { minLength: 1, maxLength: 35 }).map(chars => chars.join(""));

it("matches every canonical/legacy alias across URL case and tracking variants without matching neighboring slugs", async () => {
  await fc.assert(fc.asyncProperty(slug, fc.constantFrom("linkedinProfileUrl", "linkedinProfile", "field_16"), fc.boolean(), async (name, field, matching) => {
    const targetUrl = `https://www.linkedin.com/in/${name}`;
    const storedName = matching ? name.toUpperCase() : `${name.toUpperCase()}-other`;
    (listAllDocuments as jest.Mock).mockResolvedValue([
      { data: "invalid JSON" }, { data: "null" },
      { data: JSON.stringify({ [field]: `https://linkedin.com/in/${storedName}/?trk=legacy`, owner: "private" }) },
    ]);
    expect(await linkedinProfileHasLead(databases, targetUrl)).toBe(matching);
  }), { numRuns: 100 });
});

it.each(["t%C3%A9a-kelly", "harsh%C2%AE-agarwal"])("matches percent-encoded and Unicode stored slugs: %s", async name => {
  (listAllDocuments as jest.Mock).mockResolvedValue([{ data: JSON.stringify({ linkedinProfile: `linkedin.com/in/${decodeURIComponent(name)}` }) }]);
  expect(await linkedinProfileHasLead(databases, `https://www.linkedin.com/in/${name}`)).toBe(true);
});

it("does not turn a truncated or failed scan into a not-found result", async () => {
  (listAllDocuments as jest.Mock).mockResolvedValue(Array.from({ length: 100000 }, () => ({ data: "{}" })));
  await expect(linkedinProfileHasLead(databases, "https://www.linkedin.com/in/person")).rejects.toThrow("scan limit");
  (listAllDocuments as jest.Mock).mockRejectedValue(new Error("Network failure"));
  await expect(linkedinProfileHasLead(databases, "https://www.linkedin.com/in/person")).rejects.toThrow("Network failure");
});
