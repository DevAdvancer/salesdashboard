import { crmPermissionPattern, normalizeCrmOrigin, normalizeProfileUrl, normalizeStoredProfileUrl, sameProfile } from "@/lib/utils/linkedin-extension-url";

describe("extension URLs", () => {
  it.each([
    "https://www.linkedin.com/in/person-123/?trk=public#about",
    "http://linkedin.com/in/person-123", "linkedin.com/in/person-123/",
    "https://linkedin.com/in/person-123",
    "linkedin.com/in/PERSON-123/details/education/",
  ])("canonicalizes %s", url => {
    expect(normalizeProfileUrl(url)).toBe("https://www.linkedin.com/in/person-123");
  });
  it.each(["https://linkedin.com.evil.test/in/person", "https://evil.test/in/person",
    "https://user:password@linkedin.com/in/person", "https://linkedin.com:444/in/person",
    "https://linkedin.com/company/example", "https://linkedin.com/sales/lead/123",
    "https://linkedin.com/in", "https://linkedin.com/in/",
    "javascript:alert(1)", "https://linkedin.com/in/a/extra", "https://linkedin.com/in/%2Fperson", ""]) (
    "rejects unsupported or deceptive URL %s", url => expect(() => normalizeProfileUrl(url)).toThrow());
  it("matches old tracking links without equating different people", () => {
    expect(sameProfile("https://linkedin.com/in/alex/?trk=test", "https://www.linkedin.com/in/alex")).toBe(true);
    expect(sameProfile("https://linkedin.com/in/alex", "https://linkedin.com/in/alexander")).toBe(false);
  });
  it("treats a final slash as the same profile and stores the slash-free form", () => {
    const plain = "https://www.linkedin.com/in/haf-48";
    expect(normalizeProfileUrl(`${plain}/`)).toBe(plain);
    expect(sameProfile(plain, `${plain}/`)).toBe(true);
  });
  it("keeps real profile slugs with accents, symbols and tildes in one canonical form", () => {
    expect(normalizeProfileUrl("linkedin.com/in/téa-kelly/"))
      .toBe("https://www.linkedin.com/in/t%C3%A9a-kelly");
    expect(normalizeProfileUrl("https://linkedin.com/in/PUNEET~SHETTY/"))
      .toBe("https://www.linkedin.com/in/puneet~shetty");
    expect(sameProfile("linkedin.com/in/harsh®-agarwal", "https://www.linkedin.com/in/harsh%C2%AE-agarwal/"))
      .toBe(true);
  });
  it("recovers one clear profile from legacy pasted text and host typos only", () => {
    expect(normalizeStoredProfileUrl("Ananya's profile linkedin.com/in/ananyashetty18"))
      .toBe("https://www.linkedin.com/in/ananyashetty18");
    expect(normalizeStoredProfileUrl("inkedin.com/in/g-pramod-sai-reddy"))
      .toBe("https://www.linkedin.com/in/g-pramod-sai-reddy");
    expect(normalizeStoredProfileUrl("https://w/ww.linkedin.com/in/harish-babu"))
      .toBe("https://www.linkedin.com/in/harish-babu");
    expect(() => normalizeStoredProfileUrl("linkedin.com/in/one/https://linkedin.com/in/two"))
      .toThrow();
    expect(() => normalizeStoredProfileUrl("person@example.com")).toThrow();
  });
  it("permits HTTP only for local development", () => {
    expect(normalizeCrmOrigin("http://localhost:5000/linkedin-requests")).toBe("http://localhost:5000");
    expect(normalizeCrmOrigin("https://crm.example.com/path")).toBe("https://crm.example.com");
    expect(() => normalizeCrmOrigin("http://crm.example.com")).toThrow();
    expect(() => normalizeCrmOrigin("https://user:secret@crm.example.com")).toThrow();
    expect(crmPermissionPattern("http://localhost:5000")).toBe("http://localhost/*");
  });
});
