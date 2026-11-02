/** @jest-environment node */
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/client-progress/list/route';
import { listClientProgressAction } from '@/app/actions/client-progress';

jest.mock('@/app/actions/client-progress', () => ({ listClientProgressAction: jest.fn() }));
const action = listClientProgressAction as jest.Mock;
beforeEach(() => { jest.clearAllMocks(); });
function request(body: unknown) { return new NextRequest('http://localhost/api/client-progress/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

test('returns the authenticated scoped action result without HTTP caching', async () => {
  action.mockResolvedValue({ ok: true, data: { entries: [{ $id: 'entry' }] } });
  const response = await POST(request({ filters: { search: 'Test' } }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ entries: [{ $id: 'entry' }] });
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(action).toHaveBeenCalledWith({ filters: { search: 'Test' } });
});

test.each([{ cursor: 'older-record' }, { role: 'admin' }, { actorId: 'someone-else' }])('rejects pagination and client-supplied identity: %o', async extra => {
  const response = await POST(request({ filters: {}, ...extra }));
  expect(response.status).toBe(400);
  expect(action).not.toHaveBeenCalled();
});

test('does not return data when the session/permission check fails', async () => {
  action.mockResolvedValue({ ok: false, error: 'Access denied.' });
  const response = await POST(request({ filters: {} }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Access denied.' });
});
