import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { createSessionClient } from "@/lib/server/appwrite";

jest.mock("@/lib/server/appwrite", () => ({
  createSessionClient: jest.fn(),
  createAdminClient: jest.fn(),
}));

const mockCreateSessionClient = createSessionClient as jest.MockedFunction<typeof createSessionClient>;

describe("server current-user helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("allows the authenticated account id", async () => {
    mockCreateSessionClient.mockResolvedValue({
      account: {
        get: jest.fn().mockResolvedValue({ $id: "user-123" }),
      },
    } as any);

    await expect(assertAuthenticatedUserId("user-123")).resolves.toMatchObject({ $id: "user-123" });
  });

  it("rejects browser-supplied ids that do not match the session", async () => {
    mockCreateSessionClient.mockResolvedValue({
      account: {
        get: jest.fn().mockResolvedValue({ $id: "user-123" }),
      },
    } as any);

    await expect(assertAuthenticatedUserId("admin-999")).rejects.toThrow("Unauthorized");
  });

  it("rejects missing caller ids", async () => {
    await expect(assertAuthenticatedUserId("")).rejects.toThrow("Unauthorized");
    expect(mockCreateSessionClient).not.toHaveBeenCalled();
  });
});
