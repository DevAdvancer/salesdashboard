import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { createSessionClient } from "@/lib/server/appwrite";
import { assertCrmAccess } from '@/lib/server/crm-access';
jest.mock('@/lib/server/crm-access', () => ({ assertCrmAccess: jest.fn() }));

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
  it('enforces attendance and email verification inside authenticated server actions', async () => {
    const oldFlag = process.env.CRM_ACCESS_ENFORCEMENT;
    process.env.CRM_ACCESS_ENFORCEMENT = 'true';
    try {
      mockCreateSessionClient.mockResolvedValue({ account: { get: jest.fn().mockResolvedValue({ $id: 'user-123' }) } } as any);
      (assertCrmAccess as jest.Mock).mockRejectedValueOnce(new Error('Verify your email to access CRM.'));
      await expect(assertAuthenticatedUserId('user-123')).rejects.toThrow('Verify your email');
      expect(assertCrmAccess).toHaveBeenCalled();
    } finally {
      if (oldFlag === undefined) delete process.env.CRM_ACCESS_ENFORCEMENT;
      else process.env.CRM_ACCESS_ENFORCEMENT = oldFlag;
    }
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
