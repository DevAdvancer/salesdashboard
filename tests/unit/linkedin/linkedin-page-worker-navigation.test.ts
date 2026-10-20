/** @jest-environment node */
jest.mock('crm-shared/utils/linkedin-extension-url', () => jest.requireActual('@/lib/utils/linkedin-extension-url'), { virtual: true });
jest.mock('wxt/utils/define-background', () => ({ defineBackground: (main: unknown) => main }), { virtual: true });
jest.mock('wxt/browser', () => ({ browser: {
  runtime: { id: 'helper', getURL: (path: string) => `chrome-extension://helper${path}`, onMessage: { addListener: jest.fn() } },
  permissions: { contains: jest.fn() },
  tabs: { get: jest.fn(), query: jest.fn(), onUpdated: { addListener: jest.fn() }, onRemoved: { addListener: jest.fn() } },
  scripting: { executeScript: jest.fn() },
  storage: { local: { get: jest.fn(), set: jest.fn() }, session: { get: jest.fn(), set: jest.fn() } },
} }), { virtual: true });

jest.mock("crm-shared/utils/eastern-date", () => jest.requireActual("@/lib/utils/eastern-date"), { virtual: true });
import { browser } from 'wxt/browser';
import startWorker from '@/extensions/linkedin-helper/entrypoints/background';
import type { ExtensionResponse } from '@/lib/types/linkedin-extension';

const originalProfile = 'https://www.linkedin.com/in/original';
const currentProfile = 'https://www.linkedin.com/in/current';
const origin = 'http://localhost:5000';
const account = { id: 'account', name: 'Main', company: 'Vizva', type: 'main', connectionLimit: 25 };
const sender = { id: 'helper', frameId: 0, url: originalProfile, tab: { id: 7, url: originalProfile, incognito: false } };
let session: Record<string, any>;
let local: Record<string, any>;
let crmOperations: Array<{ operation: string; targetUrl: string }>;

beforeEach(() => {
  jest.clearAllMocks();
  session = {};
  crmOperations = [];
  local = { crmOrigin: origin, trackingLock: { origin, userId: 'agent', accountId: 'account' } };
  (browser.storage.session.get as jest.Mock).mockImplementation(async key => ({ [key]: JSON.parse(JSON.stringify(session[key] ?? null)) }));
  (browser.storage.session.set as jest.Mock).mockImplementation(async values => Object.assign(session, JSON.parse(JSON.stringify(values))));
  (browser.storage.local.get as jest.Mock).mockImplementation(async key => ({ [key]: local[key] }));
  (browser.storage.local.set as jest.Mock).mockImplementation(async values => Object.assign(local, values));
  (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
  (browser.tabs.get as jest.Mock).mockResolvedValue({ id: 7, url: currentProfile, incognito: false });
  (browser.tabs.query as jest.Mock).mockResolvedValue([{ id: 9, url: `${origin}/linkedin-requests`, status: 'complete', incognito: false }]);
  (browser.scripting.executeScript as jest.Mock).mockImplementation(async options => {
    if (options.args.length === 3) return []; // Publishing the installed version in the CRM tab.
    const input = options.args[1];
    crmOperations.push(input);
    return [{ result: { status: 200, data: { account, user: { id: 'agent', name: 'Agent' },
      targetUrl: input.targetUrl, today: '2026-10-19', revision: 'revision', state: 'new', canRecord: true,
      used: 0, limit: 25, remaining: 25, history: [], previousRequest: null,
      ...(input.operation === 'record' ? { mode: 'created', state: 'active_request', canRecord: false } : {}),
    } } }];
  });
  (startWorker as unknown as () => void)();
});

async function message(input: Record<string, unknown>, from = sender): Promise<ExtensionResponse<any>> {
  const handler = (browser.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
  return new Promise(resolve => handler(input, from, resolve));
}

it('reproduces the screenshot: the original document URL differs, but the current tab profile is available', async () => {
  const result = await message({ type: 'page-status', targetUrl: currentProfile });
  expect(result).toMatchObject({ ok: true, data: { check: { targetUrl: currentProfile, state: 'new', remaining: 25 } } });
  expect(browser.tabs.get).toHaveBeenCalledWith(7);
  expect(crmOperations).toEqual([{ operation: 'check', accountId: 'account', targetUrl: currentProfile }]);
});

it('allows profile navigation from a document originally loaded on the LinkedIn feed', async () => {
  expect(await message({ type: 'page-status', targetUrl: currentProfile }, { ...sender, url: 'https://www.linkedin.com/feed/' }))
    .toMatchObject({ ok: true, data: { check: { targetUrl: currentProfile } } });
});

it('rejects a delayed message for the previous profile before contacting CRM', async () => {
  expect(await message({ type: 'page-status', targetUrl: originalProfile }))
    .toMatchObject({ ok: false, code: 'PROFILE_CHANGED' });
  expect(crmOperations).toHaveLength(0);
});

it('still requires the locked account rather than treating popup availability as send permission', async () => {
  local.trackingLock = null;
  expect(await message({ type: 'page-status', targetUrl: currentProfile }))
    .toMatchObject({ ok: false, error: expect.stringContaining('lock the account') });
  expect(crmOperations).toHaveLength(0);
});

it('prepares and records on the current SPA profile, bound to the original tab and locked account', async () => {
  const prepared = await message({ type: 'page-prepare', targetUrl: currentProfile });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) throw new Error(prepared.error);
  const attemptId = prepared.data.attempt.id;
  expect(await message({ type: 'page-validate', targetUrl: currentProfile, attemptId })).toMatchObject({ ok: true });
  expect(await message({ type: 'page-sent', targetUrl: currentProfile, attemptId })).toMatchObject({ ok: true });
  expect(crmOperations.filter(input => input.operation === 'record'))
    .toEqual([expect.objectContaining({ accountId: 'account', targetUrl: currentProfile, expectedUserId: 'agent' })]);
});

it('does not record a tracked invitation from an old profile after the tab navigates again', async () => {
  const prepared = await message({ type: 'page-prepare', targetUrl: currentProfile });
  if (!prepared.ok) throw new Error(prepared.error);
  (browser.tabs.get as jest.Mock).mockResolvedValue({ id: 7, url: 'https://www.linkedin.com/in/another', incognito: false });
  expect(await message({ type: 'page-sent', targetUrl: currentProfile, attemptId: prepared.data.attempt.id }))
    .toMatchObject({ ok: false, code: 'PROFILE_CHANGED' });
  expect(crmOperations.filter(input => input.operation === 'record')).toHaveLength(0);
});

it('avoids the redundant pre-save check through the actual worker', async () => {
  const prepared = await message({ type: 'page-prepare', targetUrl: currentProfile });
  if (!prepared.ok) throw new Error(prepared.error);
  crmOperations.length = 0;
  expect(await message({ type: 'page-sent', targetUrl: currentProfile, attemptId: prepared.data.attempt.id })).toMatchObject({ ok: true });
  expect(crmOperations.map(input => input.operation)).toEqual(['record']);
});

it('reuses the initial checked profile through preparation and saves with just two API calls', async () => {
  await message({ type: 'page-status', targetUrl: currentProfile });
  const prepared = await message({ type: 'page-prepare', targetUrl: currentProfile });
  if (!prepared.ok) throw new Error(prepared.error);
  expect(crmOperations.map(input => input.operation)).toEqual(['check']);
  await message({ type: 'page-sent', targetUrl: currentProfile, attemptId: prepared.data.attempt.id });
  expect(crmOperations.map(input => input.operation)).toEqual(['check', 'record']);
});

it('prechecks multiple open profile tabs and restores their results without repeated CRM calls', async () => {
  const urls = new Map([[7, currentProfile], [8, originalProfile], [10, currentProfile]]);
  (browser.tabs.get as jest.Mock).mockImplementation(async id => ({ id, url: urls.get(id), incognito: false }));
  const from = (id: number) => ({ ...sender, url: urls.get(id)!, tab: { ...sender.tab, id } });
  await Promise.all([7, 8, 10].map(id => message({ type: 'page-status', targetUrl: urls.get(id) }, from(id))));
  expect(crmOperations.filter(input => input.operation === 'check')).toHaveLength(2);
  expect(session.trackingPreviews).toHaveLength(2);
  crmOperations.length = 0;
  (startWorker as unknown as () => void)(); // Session receipts survive a suspended service worker.
  const handler = (browser.runtime.onMessage.addListener as jest.Mock).mock.calls.at(-1)![0];
  for (const id of [8, 7, 10]) {
    const response = await new Promise(resolve => handler({ type: 'page-status', targetUrl: urls.get(id) }, from(id), resolve));
    expect(response).toMatchObject({ ok: true, data: { check: { targetUrl: urls.get(id) } } });
  }
  expect(crmOperations).toHaveLength(0);
});

it('drops shared previews when the connected CRM tab navigates', async () => {
  await message({ type: 'page-status', targetUrl: currentProfile });
  const updated = (browser.tabs.onUpdated.addListener as jest.Mock).mock.calls.at(-1)![0];
  updated(9, { status: 'loading' }, { url: `${origin}/login` });
  await message({ type: 'page-status', targetUrl: currentProfile });
  expect(crmOperations.filter(input => input.operation === 'check')).toHaveLength(2);
});

it('shares the page check with the popup, keeps manual refresh fresh and respects removed CRM permission', async () => {
  await message({ type: 'page-status', targetUrl: currentProfile });
  const popup = { ...sender, url: 'chrome-extension://helper/popup.html' };
  const input = { operation: 'check', accountId: 'account', targetUrl: currentProfile };
  expect(await message({ type: 'crm-api', input }, popup)).toMatchObject({ ok: true, data: { targetUrl: currentProfile } });
  expect(crmOperations).toHaveLength(1);
  expect(await message({ type: 'crm-api', input, fresh: true }, popup)).toMatchObject({ ok: true });
  expect(crmOperations).toHaveLength(2);
  (browser.permissions.contains as jest.Mock).mockResolvedValue(false);
  expect(await message({ type: 'crm-api', input }, popup)).toMatchObject({ ok: false });
  expect(await message({ type: 'page-status', targetUrl: currentProfile })).toMatchObject({ ok: false });
  expect(crmOperations).toHaveLength(2);
});

it('clears all preview receipts after the server rejects beta access', async () => {
  await message({ type: 'page-status', targetUrl: currentProfile });
  const normal = (browser.scripting.executeScript as jest.Mock).getMockImplementation()!;
  let deny = true;
  (browser.scripting.executeScript as jest.Mock).mockImplementation(options => {
    if (options.args.length !== 3 && deny) { deny = false; return Promise.resolve([{ result: { status: 403, data: { error: 'Beta access removed' } } }]); }
    return normal(options);
  });
  expect(await message({ type: 'page-status', targetUrl: currentProfile, fresh: true })).toMatchObject({ ok: false });
  expect(session.trackingPreviews).toEqual([]);
  await message({ type: 'page-status', targetUrl: currentProfile });
  expect(crmOperations.filter(input => input.operation === 'check')).toHaveLength(2);
});

it('checks the current profile without waiting for a previous profile status request', async () => {
  const normalFetch = (browser.scripting.executeScript as jest.Mock).getMockImplementation()!;
  let release!: (value: any) => void;
  let started!: () => void;
  const slow = new Promise(resolve => { release = resolve; });
  const oldStarted = new Promise<void>(resolve => { started = resolve; });
  (browser.scripting.executeScript as jest.Mock).mockImplementation(options => {
    if (options.args[1]?.targetUrl === originalProfile) { started(); return slow; }
    return normalFetch(options);
  });
  (browser.tabs.get as jest.Mock).mockResolvedValue({ id: 7, url: originalProfile, incognito: false });
  const previous = message({ type: 'page-status', targetUrl: originalProfile });
  await oldStarted;
  (browser.tabs.get as jest.Mock).mockResolvedValue({ id: 7, url: currentProfile, incognito: false });
  expect(await message({ type: 'page-status', targetUrl: currentProfile })).toMatchObject({ ok: true, data: { check: { targetUrl: currentProfile } } });
  release(await normalFetch({ args: [origin, { operation: 'check', accountId: 'account', targetUrl: originalProfile }] }));
  await previous;
});

it('routes explicit recovery through the actual worker and clears the original attempt once', async () => {
  const prepared = await message({ type: 'page-prepare', targetUrl: currentProfile });
  if (!prepared.ok) throw new Error(prepared.error);
  const attemptId = prepared.data.attempt.id;
  expect(await message({ type: 'page-recover', targetUrl: currentProfile, attemptId, confirmedPending: true },
    { ...sender, tab: { ...sender.tab, id: 8 } })).toMatchObject({ ok: false });
  expect(await message({ type: 'page-recover', targetUrl: currentProfile, attemptId, confirmedPending: true })).toMatchObject({ ok: true });
  expect(await message({ type: 'page-recover', targetUrl: currentProfile, attemptId, confirmedPending: true })).toMatchObject({ ok: false });
  expect(crmOperations.filter(input => input.operation === 'record')).toHaveLength(1);
  expect(session.trackingAttempts).toEqual([]);
});

it.each([
  { ...sender, id: 'different-extension' },
  { ...sender, frameId: 1 },
  { ...sender, url: 'https://not-linkedin.example/in/person' },
  { ...sender, tab: { ...sender.tab, incognito: true } },
])('keeps rejecting untrusted message senders: %o', async from => {
  expect(await message({ type: 'page-status', targetUrl: currentProfile }, from)).toMatchObject({ ok: false });
  expect(browser.tabs.get).not.toHaveBeenCalled();
  expect(crmOperations).toHaveLength(0);
});
