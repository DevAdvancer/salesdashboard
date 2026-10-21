jest.mock("node-appwrite", () => ({
  Query: {
    equal: (attribute: string, value: unknown) => JSON.stringify({ attribute, value }),
    contains: (attribute: string, value: unknown) => JSON.stringify({ contains: attribute, value }),
    select: (fields: string[]) => JSON.stringify({ select: fields }),
    limit: (value: number) => JSON.stringify({ limit: value }),
    orderDesc: (attribute: string) => JSON.stringify({ orderDesc: attribute }),
  },
  Permission: {
    read: (role: string) => `read("${role}")`, update: (role: string) => `update("${role}")`,
    delete: (role: string) => `delete("${role}")`,
  },
  Role: { user: (id: string) => `user:${id}`, label: (id: string) => `label:${id}` },
}));
jest.mock("@/lib/server/appwrite", () => ({ createAdminClient: jest.fn() }));
jest.mock("@/lib/server/current-user", () => ({ getAuthenticatedUserDoc: jest.fn() }));
jest.mock("@/lib/server/beta-feature-access", () => ({ hasLinkedinHelperAccess: jest.fn() }));
jest.mock("@/lib/server/appwrite-pagination", () => ({ listAllDocuments: jest.fn() }));
jest.mock('@/lib/server/linkedin-lead-protection',()=>({findProtectedLinkedinLead:jest.fn(),requestBlocksLinkedinProfile:jest.fn()}));
jest.mock("@/app/actions/linkedin/accounts", () => ({ listMyLinkedinAccountsAction: jest.fn() }));
jest.mock("@/app/actions/linkedin/requests", () => ({ createLinkedinRequestAction: jest.fn() }));
jest.mock("@/app/actions/linkedin/shared", () => ({
  assertAccessibleLinkedinAccount: jest.fn(), isBlockingLinkedinRequest: jest.fn(), logAuditAction: jest.fn(),
  sameLinkedinCompany: (left: string, right: string) =>
    left.toLowerCase().replace(/[^a-z0-9]/g, "") === right.toLowerCase().replace(/[^a-z0-9]/g, ""),
}));

import { createAdminClient } from "@/lib/server/appwrite";
import { getAuthenticatedUserDoc } from "@/lib/server/current-user";
import { hasLinkedinHelperAccess } from "@/lib/server/beta-feature-access";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { listMyLinkedinAccountsAction } from "@/app/actions/linkedin/accounts";
import { createLinkedinRequestAction } from "@/app/actions/linkedin/requests";
import { assertAccessibleLinkedinAccount, isBlockingLinkedinRequest } from "@/app/actions/linkedin/shared";
import { bootstrapLinkedinExtension, checkLinkedinExtension, recordLinkedinExtension } from "@/lib/server/linkedin-extension";
import { COLLECTIONS } from "@/lib/constants/appwrite";
import { findProtectedLinkedinLead,requestBlocksLinkedinProfile } from '@/lib/server/linkedin-lead-protection';

const account = { $id: "account-1", assignedUserId: "agent-1", company: "Silverspace", idName: "Account A", accountType: "main", isActive: true, connectionLimit: 3 };
const databases = { clearReadCacheForCollection: jest.fn(), createDocument: jest.fn(),
  listDocuments: jest.fn() };
const input = { accountId: account.$id, targetUrl: "https://linkedin.com/in/person/?trk=test" };
let records: any[];
let used: any[];

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers().setSystemTime(new Date("2026-10-06T02:00:00Z")); // Oct 5 in Eastern time.
  records = []; used = [];
  (findProtectedLinkedinLead as jest.Mock).mockResolvedValue(null);
  (requestBlocksLinkedinProfile as jest.Mock).mockImplementation(async (_db,r)=>r.status!=='withdrawn'&&!(r.isActive===false&&r.withdrawnAt));
  (createAdminClient as jest.Mock).mockResolvedValue({ databases });
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ $id: "agent-1", name: "Agent", role: "agent", department: "sales", isActive: true });
  (hasLinkedinHelperAccess as jest.Mock).mockResolvedValue(true);
  (listMyLinkedinAccountsAction as jest.Mock).mockResolvedValue([account]);
  (assertAccessibleLinkedinAccount as jest.Mock).mockResolvedValue(account);
  (isBlockingLinkedinRequest as jest.Mock).mockImplementation(r =>
    r.status !== "withdrawn" && !(r.isActive === false && r.withdrawnAt));
  (listAllDocuments as jest.Mock).mockImplementation(async () =>
    records.map(record => ({ company: account.company, ...record })));
  databases.listDocuments.mockImplementation(async () => ({ total: used.length, documents: [] }));
  databases.createDocument.mockResolvedValue({ $id: "saved" });
});
afterEach(() => jest.useRealTimers());

it("bootstrap returns only projected account data and the Eastern business date", async () => {
  const data = await bootstrapLinkedinExtension();
  expect(data.today).toBe("2026-10-05");
  expect(data.accounts[0]).toMatchObject({ id: "account-1", remaining: 3 });
  expect(data.accounts[0]).not.toHaveProperty("assignedUserId");
});
it("checking never writes or resends and recognizes a legacy tracking URL", async () => {
  records = [{ $id: "old", agentId: "other", targetUrl: "https://linkedin.com/in/person/?trk=old", status: "sent", isActive: true }];
  const data = await checkLinkedinExtension(input, true);
  expect(data.state).toBe("active_request");
  expect(data.previousRequest).toMatchObject({ status: "sent" });
  expect(data.history[0].requestId).toBeNull();
  expect(databases.createDocument).not.toHaveBeenCalled();
  expect(createLinkedinRequestAction).not.toHaveBeenCalled();
});
it("refuses inactive, resume, and monitoring actors before any account read", async () => {
  for (const override of [{ isActive: false }, { department: "resume" }, { role: "monitor" }]) {
    (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ role: "agent", department: "sales", isActive: true, ...override });
    await expect(checkLinkedinExtension(input)).rejects.toMatchObject({ status: 403 });
  }
  expect(assertAccessibleLinkedinAccount).not.toHaveBeenCalled();
});
it("rejects expired delegation", async () => {
  (assertAccessibleLinkedinAccount as jest.Mock).mockRejectedValue(new Error("Unauthorized"));
  await expect(checkLinkedinExtension(input)).rejects.toMatchObject({ status: 403 });
});
it("allows eligible users without a beta grant", async () => {
  (hasLinkedinHelperAccess as jest.Mock).mockResolvedValue(false);
  await expect(checkLinkedinExtension(input)).resolves.toMatchObject({ canRecord: true });
  expect(hasLinkedinHelperAccess).not.toHaveBeenCalled();
});
it("allows the same profile through another company's LinkedIn account", async () => {
  records = [{ $id: "other-company-request", targetUrl: "https://www.linkedin.com/in/person",
    company: account.company, status: "sent", isActive: true }];
  const otherAccount = { ...account, $id: "account-2", company: "Vizva INC" };
  (assertAccessibleLinkedinAccount as jest.Mock).mockResolvedValue(otherAccount);
  expect((await checkLinkedinExtension({ ...input, accountId: otherAccount.$id })).state).toBe("new");
});
it('blocks an existing lead across companies even after its request was withdrawn',async()=>{
  (findProtectedLinkedinLead as jest.Mock).mockResolvedValue({$id:'existing-lead',status:'Interested',$updatedAt:'now'});
  records=[{$id:'old',targetUrl:input.targetUrl,company:'Another company',status:'withdrawn'}];
  expect(await checkLinkedinExtension(input)).toMatchObject({state:'active_request',canRecord:false});
  await expect(recordLinkedinExtension({...input,confirmResend:false,revision:'stale'})).rejects.toMatchObject({status:409});
  expect(databases.createDocument).not.toHaveBeenCalled();
});
it("rechecks allowance at save time", async () => {
  const checked = await checkLinkedinExtension(input);
  used = Array.from({ length: 3 }, () => ({ status: "sent", isActive: true }));
  await expect(recordLinkedinExtension({ ...input, revision: checked.revision, confirmResend: false })).rejects.toMatchObject({ status: 409 });
  expect(databases.createDocument).not.toHaveBeenCalled();
});
it("records the existing CRM schema with a deterministic ID and correct owner permissions", async () => {
  const checked = await checkLinkedinExtension(input);
  await recordLinkedinExtension({ ...input, revision: checked.revision, confirmResend: false });
  expect(databases.createDocument).toHaveBeenCalledWith(expect.any(String), COLLECTIONS.LINKEDIN_REQUESTS,
    expect.stringMatching(/^ext_[a-f0-9]{32}$/), expect.objectContaining({ agentId: "agent-1", accountId: "account-1",
      targetUrl: "https://www.linkedin.com/in/person", status: "sent", dateSent: "2026-10-05T00:00:00.000Z" }),
    expect.arrayContaining(['read("user:agent-1")', 'update("user:agent-1")', 'delete("user:agent-1")']));
});
it("a database duplicate conflict never falls through into a resend", async () => {
  const checked = await checkLinkedinExtension(input);
  databases.createDocument.mockRejectedValue({ code: 409 });
  await expect(recordLinkedinExtension({ ...input, revision: checked.revision, confirmResend: false })).rejects.toMatchObject({ status: 409 });
  expect(createLinkedinRequestAction).not.toHaveBeenCalled();
});
it("explicit resend reuses the legacy URL and existing action without adding a record", async () => {
  records = [{ $id: "old", agentId: "agent-1", targetUrl: "https://linkedin.com/in/person/?trk=old",
    status: "withdrawn", isActive: true, $updatedAt: "2026-10-01T00:00:00Z" }];
  (createLinkedinRequestAction as jest.Mock).mockResolvedValue({ mode: "resent" });
  const checked = await checkLinkedinExtension(input);
  expect(checked.state).toBe("resend_available");
  await expect(recordLinkedinExtension({ ...input, revision: checked.revision, confirmResend: false })).rejects.toMatchObject({ status: 409 });
  await recordLinkedinExtension({ ...input, revision: checked.revision, confirmResend: true });
  expect(createLinkedinRequestAction).toHaveBeenCalledWith({ currentUserId: "agent-1", accountId: account.$id,
    targetUrl: records[0].targetUrl, dateSent: "2026-10-05" });
  expect(databases.createDocument).not.toHaveBeenCalled();
});
it("offers resend when an inactive accepted row has a recorded withdrawal", async () => {
  records = [{ $id: "old", agentId: "agent-1", targetUrl: input.targetUrl,
    status: "accepted", isActive: false, withdrawnAt: "2026-10-13T04:00:00.000Z",
    $updatedAt: "2026-10-14T20:39:05.852Z" }];
  const checked = await checkLinkedinExtension(input, true);
  expect(checked).toMatchObject({ state: "resend_available", canRecord: true,
    previousRequest: { status: "withdrawn" } });
  expect(checked.history[0].status).toBe("withdrawn");
});
it("rejects changed ownership/history between check and save", async () => {
  const checked = await checkLinkedinExtension(input);
  records = [{ $id: "raced", targetUrl: input.targetUrl, status: "sent", agentId: "other" }];
  await expect(recordLinkedinExtension({ ...input, revision: checked.revision, confirmResend: false })).rejects.toMatchObject({ status: 409 });
});
it("binds the checked revision to the authenticated actor", async () => {
  const checked = await checkLinkedinExtension(input);
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ $id: "agent-2", name: "Other", role: "agent", department: "sales", isActive: true });
  await expect(recordLinkedinExtension({ ...input, revision: checked.revision, confirmResend: false })).rejects.toMatchObject({ status: 409 });
  expect(databases.createDocument).not.toHaveBeenCalled();
});
it("rejects malformed URLs and unauthenticated sessions", async () => {
  await expect(checkLinkedinExtension({ ...input, targetUrl: "https://evil.test/in/person" })).rejects.toMatchObject({ status: 400 });
  (getAuthenticatedUserDoc as jest.Mock).mockRejectedValue(new Error("No session"));
  await expect(checkLinkedinExtension(input)).rejects.toMatchObject({ status: 401 });
});

it("direct recording inspects once, hides history, and returns the updated allowance", async () => {
  const saved = await recordLinkedinExtension({ ...input, confirmResend: false });
  expect(saved).toMatchObject({ mode: "created", state: "active_request", canRecord: false, used: 1, remaining: 2, history: [],
    previousRequest: { status: "sent", dateSent: "2026-10-05T00:00:00.000Z" } });
  const profileReads = (listAllDocuments as jest.Mock).mock.calls.filter(([args]) =>
    args.queries.some((q: string) => q.includes('"contains":"targetUrl"')));
  expect(profileReads).toHaveLength(1);
  expect(profileReads[0][0].queries).toContain(JSON.stringify({ contains: "targetUrl", value: "/in/person" }));
});

it.each(["sent", "withdrawn"])("direct recording of an existing %s request never creates or silently resends", async status => {
  records = [{ $id: "old", targetUrl: input.targetUrl, status, agentId: "other", isActive: true }];
  const saved = await recordLinkedinExtension({ ...input, confirmResend: false });
  expect(saved.mode).toBe("existing");
  expect(saved.state).toBe(status === "sent" ? "active_request" : "resend_available");
  expect(databases.createDocument).not.toHaveBeenCalled();
  expect(createLinkedinRequestAction).not.toHaveBeenCalled();
});

it("direct recording returns an allowance block without writing", async () => {
  used = Array.from({ length: 3 }, () => ({ status: "sent", isActive: true }));
  expect(await recordLinkedinExtension({ ...input, confirmResend: false })).toMatchObject({ mode: "existing", state: "limit_reached" });
  expect(databases.createDocument).not.toHaveBeenCalled();
});

it("availability checks hide history until it is requested", async () => {
  records = [{ $id: "old", targetUrl: input.targetUrl, status: "sent", agentId: "other" }];
  expect((await checkLinkedinExtension(input)).history).toEqual([]);
  expect((await checkLinkedinExtension(input, true)).history).toHaveLength(1);
});

it("substring candidates for longer profile slugs are not mistaken for duplicates", async () => {
  records = [{ $id: "other", targetUrl: "https://www.linkedin.com/in/person-other", status: "sent", agentId: "other" }];
  expect(await checkLinkedinExtension(input)).toMatchObject({ state: "new", previousRequest: null });
});

it("falls back for unsupported contains queries without skipping legacy duplicate protection", async () => {
  (listAllDocuments as jest.Mock).mockRejectedValueOnce({ code: 400 });
  expect((await checkLinkedinExtension(input)).state).toBe("new");
  expect((listAllDocuments as jest.Mock).mock.calls.some(([args]) =>
    !args.queries.some((q: string) => q.includes('"contains"')))).toBe(true);
});
