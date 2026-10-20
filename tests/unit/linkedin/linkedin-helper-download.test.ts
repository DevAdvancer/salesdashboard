/** @jest-environment node */
jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));
jest.mock('@/app/actions/beta', () => ({ getMyLinkedinHelperAccessAction: jest.fn() }));
jest.mock('@/lib/server/current-user', () => ({ getAuthenticatedUserDoc: jest.fn() }));
import fc from 'fast-check';
import { readFile } from 'node:fs/promises';
import { getMyLinkedinHelperAccessAction } from '@/app/actions/beta';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { GET } from '@/app/api/extension/linkedin/download/route';
import { canUseLinkedinExtension } from '@/lib/server/linkedin-extension-policy';
import { VALID_ROLES } from '@/lib/types';

beforeEach(() => {
  jest.resetAllMocks();
  (readFile as jest.Mock).mockResolvedValue(Buffer.from('zip'));
});

it('serves beta bytes only to selected eligible users across all roles and departments', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...VALID_ROLES), fc.constantFrom('sales', 'resume'), fc.boolean(), fc.boolean(),
    async (role, department, isActive, granted) => {
      (readFile as jest.Mock).mockClear();
      const actor = { role, department, isActive };
      (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue(actor);
      (getMyLinkedinHelperAccessAction as jest.Mock).mockResolvedValue(canUseLinkedinExtension(actor) && granted);
      const result = await GET();
      expect(result.headers.get('cache-control')).toBe('private, no-store');
      expect(result.headers.get('vary')).toBe('Cookie');
      if (!canUseLinkedinExtension(actor)) {
        expect(result.status).toBe(403);
        expect(readFile).not.toHaveBeenCalled();
      } else {
        expect(result.status).toBe(200);
        expect(result.headers.get('content-disposition')).toBe('attachment; filename="LinkedIn Helper.zip"');
        const path = (readFile as jest.Mock).mock.calls[0][0].replaceAll('\\', '/');
        expect(path).toContain(granted ? '/releases/linkedin-helper/LinkedIn Helper.zip' : '/public/downloads/crm-hub-linkedin-helper-1.7.0-chrome.zip');
      }
    }));
});

it('fails closed on signed-out sessions or authorization storage failures, never exposing raw errors', async () => {
  (getMyLinkedinHelperAccessAction as jest.Mock).mockRejectedValue(new Error('private SDK detail'));
  const result = await GET();
  expect(result.status).toBe(503);
  expect(readFile).not.toHaveBeenCalled();
  expect(await result.text()).not.toContain('SDK');
});
