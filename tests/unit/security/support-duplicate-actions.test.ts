import { checkDuplicateSubject } from "@/app/actions/assessment";
import { checkDuplicateInterviewSubject } from "@/app/actions/interview";
import { createAdminClient, createSessionClient } from "@/lib/server/appwrite";

jest.mock("node-appwrite", () => ({
  ID: {
    unique: jest.fn(() => "unique-id"),
  },
  Query: {
    equal: jest.fn((field: string, value: unknown) => `equal:${field}:${JSON.stringify(value)}`),
    limit: jest.fn((limit: number) => `limit:${limit}`),
  },
}));

jest.mock("@/lib/server/appwrite", () => ({
  createSessionClient: jest.fn(),
  createAdminClient: jest.fn(),
}));

const mockCreateSessionClient = createSessionClient as jest.MockedFunction<typeof createSessionClient>;
const mockCreateAdminClient = createAdminClient as jest.MockedFunction<typeof createAdminClient>;

function mockAuthenticatedSession() {
  mockCreateSessionClient.mockResolvedValue({
    account: {
      get: jest.fn().mockResolvedValue({ $id: "user-123" }),
    },
  } as any);
}

function mockAttemptList(sentSubjects: string[]) {
  const listDocuments = jest.fn().mockResolvedValue({
    documents: [
      {
        $id: "attempt-1",
        leadId: "lead-123",
        userId: "user-123",
        attemptCount: 1,
        lastAttemptAt: "2026-05-28T12:00:00.000Z",
        sentSubjects,
      },
    ],
  });

  mockCreateAdminClient.mockResolvedValue({
    databases: {
      listDocuments,
    },
  } as any);

  return listDocuments;
}

describe("support duplicate subject actions", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("requires an authenticated session before checking assessment attempts", async () => {
    mockCreateSessionClient.mockRejectedValue(new Error("No session"));

    await expect(checkDuplicateSubject("lead-123", "Follow up")).resolves.toBe(false);

    expect(mockCreateSessionClient).toHaveBeenCalledTimes(1);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated session before checking interview attempts", async () => {
    mockCreateSessionClient.mockRejectedValue(new Error("No session"));

    await expect(checkDuplicateInterviewSubject("lead-123", "Screening")).resolves.toBe(false);

    expect(mockCreateSessionClient).toHaveBeenCalledTimes(1);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("keeps duplicate assessment detection working for authenticated users", async () => {
    mockAuthenticatedSession();
    const listDocuments = mockAttemptList(["Follow up"]);

    await expect(checkDuplicateSubject("lead-123", " follow   up ")).resolves.toBe(true);

    expect(listDocuments).toHaveBeenCalledTimes(1);
  });

  it("keeps duplicate interview detection working for authenticated users", async () => {
    mockAuthenticatedSession();
    const listDocuments = mockAttemptList(["Screening"]);

    await expect(checkDuplicateInterviewSubject("lead-123", "screening")).resolves.toBe(true);

    expect(listDocuments).toHaveBeenCalledTimes(1);
  });
});
