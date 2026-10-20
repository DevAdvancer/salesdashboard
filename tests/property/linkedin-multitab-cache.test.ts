jest.mock('crm-shared/utils/linkedin-extension-url', () => jest.requireActual('@/lib/utils/linkedin-extension-url'), { virtual: true });
jest.mock('crm-shared/utils/eastern-date', () => jest.requireActual('@/lib/utils/eastern-date'), { virtual: true });
import fc from 'fast-check';
import { PageTracking, type TrackingLock, type TrackingRequest } from '@/extensions/linkedin-helper/lib/page-tracking';

it('shares a canonical profile result only within the same CRM origin, user and account for any tab', async () => {
  await fc.assert(fc.asyncProperty(fc.record({ origin: fc.boolean(), user: fc.boolean(), account: fc.boolean(), profile: fc.boolean() }),
    fc.integer({ min: 1, max: 10000 }), fc.constantFrom('', '/', '?trk=profile', '/?trk=other#top'), async (changed, tab, suffix) => {
      const initial = { origin: 'https://crm.example.test', userId: 'agent', accountId: 'account' };
      let lock: TrackingLock = { ...initial };
      const request = jest.fn(async (_origin, input) => ({ user: { id: lock.userId, name: 'Agent' }, today: '2026-10-20',
        account: { id: lock.accountId, name: 'Main', company: 'Silverspace', type: 'main', connectionLimit: 25 },
        targetUrl: input.targetUrl, revision: 'rev', state: 'new', canRecord: true, used: 0, limit: 25, remaining: 25, history: [], previousRequest: null }));
      const tracking = new PageTracking({ lock: async () => lock, setLock: async value => { lock = value!; },
        attempts: async () => [], saveAttempts: async () => {} }, request as TrackingRequest, () => Date.parse('2026-10-20T15:00:00Z'));
      await tracking.handle(initial.origin, 1, { type: 'page-status', targetUrl: 'https://www.linkedin.com/in/person' });
      lock = { origin: changed.origin ? 'https://other.example.test' : initial.origin,
        userId: changed.user ? 'other-agent' : initial.userId, accountId: changed.account ? 'other-account' : initial.accountId };
      const targetUrl = `https://www.linkedin.com/in/${changed.profile ? 'other' : 'person'}`;
      const result = await tracking.handle(lock.origin, tab, { type: 'page-status', targetUrl: targetUrl + suffix });
      expect(result).toMatchObject({ check: { user: { id: lock.userId }, account: { id: lock.accountId }, targetUrl } });
      expect(request).toHaveBeenCalledTimes(Object.values(changed).some(Boolean) ? 2 : 1);
    }));
});
