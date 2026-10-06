import { crmPermissionPattern, normalizeCrmOrigin, normalizeProfileUrl, sameProfile } from "@/lib/utils/linkedin-extension-url";

describe("extension URLs", () => {
  it.each([
    "https://www.linkedin.com/in/person-123/?trk=public#about",
    "http://linkedin.com/in/person-123", "linkedin.com/in/person-123/",
  ])("canonicalizes %s", url => {
    expect(normalizeProfileUrl(url)).toBe("https://www.linkedin.com/in/person-123");
  });
  it.each(["https://linkedin.com.evil.test/in/person", "https://evil.test/in/person",
    "https://user:password@linkedin.com/in/person", "https://linkedin.com:444/in/person",
    "https://linkedin.com/company/example", "https://linkedin.com/sales/lead/123",
    "javascript:alert(1)", "https://linkedin.com/in/a/extra", "https://linkedin.com/in/%2Fperson", ""]) (
    "rejects unsupported or deceptive URL %s", url => expect(() => normalizeProfileUrl(url)).toThrow());
  it("matches old tracking links without equating different people", () => {
    expect(sameProfile("https://linkedin.com/in/alex/?trk=test", "https://www.linkedin.com/in/alex")).toBe(true);
    expect(sameProfile("https://linkedin.com/in/alex", "https://linkedin.com/in/alexander")).toBe(false);
  });
  it("permits HTTP only for local development", () => {
    expect(normalizeCrmOrigin("http://localhost:5000/linkedin-requests")).toBe("http://localhost:5000");
    expect(normalizeCrmOrigin("https://crm.example.com/path")).toBe("https://crm.example.com");
    expect(() => normalizeCrmOrigin("http://crm.example.com")).toThrow();
    expect(() => normalizeCrmOrigin("https://user:secret@crm.example.com")).toThrow();
    expect(crmPermissionPattern("http://localhost:5000")).toBe("http://localhost/*");
  });
});
