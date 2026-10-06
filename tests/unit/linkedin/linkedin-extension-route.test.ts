/** @jest-environment node */
jest.mock("@/lib/server/linkedin-extension", () => ({
  bootstrapLinkedinExtension: jest.fn(), checkLinkedinExtension: jest.fn(), recordLinkedinExtension: jest.fn(),
}));
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/extension/linkedin/route";
import { bootstrapLinkedinExtension, checkLinkedinExtension, recordLinkedinExtension } from "@/lib/server/linkedin-extension";
import { LinkedinExtensionError } from "@/lib/server/linkedin-extension-policy";

const url = "https://crm.example.com/api/extension/linkedin";
const headers = { "x-crm-extension": "linkedin-helper-v1", "sec-fetch-site": "same-origin",
  origin: "https://crm.example.com", "content-type": "application/json" };
beforeEach(() => jest.resetAllMocks());
it("blocks cross-origin, missing source and missing bridge header before authentication", async () => {
  for (const invalid of [{}, { ...headers, origin: "https://evil.test" }, { ...headers, "sec-fetch-site": "cross-site" }]) {
    const response = await GET(new NextRequest(url, { headers: invalid }));
    expect(response.status).toBe(403);
  }
  expect(bootstrapLinkedinExtension).not.toHaveBeenCalled();
});
it("accepts the same-origin GET referer and disables response caching", async () => {
  (bootstrapLinkedinExtension as jest.Mock).mockResolvedValue({ accounts: [] });
  const response = await GET(new NextRequest(url, { headers: { "x-crm-extension": "linkedin-helper-v1",
    "sec-fetch-site": "same-origin", referer: "https://crm.example.com/linkedin-requests" } }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("requires valid payload and a revision for explicit resends", async () => {
  for (const body of ["{", JSON.stringify({ operation: "record", accountId: "a", targetUrl: "url", confirmResend: true }),
    JSON.stringify({ operation: "check", accountId: "a", targetUrl: "url", currentUserId: "victim" })]) {
    const response = await POST(new NextRequest(url, { method: "POST", headers, body }));
    expect(response.status).toBe(400);
  }
  expect(recordLinkedinExtension).not.toHaveBeenCalled();
  expect(checkLinkedinExtension).not.toHaveBeenCalled();
});
it("redacts raw SDK errors but reports safe authentication errors", async () => {
  (bootstrapLinkedinExtension as jest.Mock).mockRejectedValue(new Error("secret key / missing scopes"));
  const failed = await GET(new NextRequest(url, { headers }));
  expect(failed.status).toBe(500);
  expect(JSON.stringify(await failed.json())).not.toContain("secret");
  (bootstrapLinkedinExtension as jest.Mock).mockRejectedValue(new LinkedinExtensionError(401, "Sign in to CRM."));
  expect((await GET(new NextRequest(url, { headers }))).status).toBe(401);
});

it("allows direct recording while history remains an explicit operation", async () => {
  (recordLinkedinExtension as jest.Mock).mockResolvedValue({ mode: "created" });
  expect((await POST(new NextRequest(url, { method: "POST", headers, body: JSON.stringify({ operation: "record", accountId: "a", targetUrl: "url" }) }))).status).toBe(200);
  (checkLinkedinExtension as jest.Mock).mockResolvedValue({ history: [] });
  await POST(new NextRequest(url, { method: "POST", headers, body: JSON.stringify({ operation: "history", accountId: "a", targetUrl: "url" }) }));
  expect(checkLinkedinExtension).toHaveBeenCalledWith(expect.objectContaining({ operation: "history" }), true);
});
