import { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { QueryProvider } from '@/app/providers/query-provider';
import { makeQueryClient } from '@/lib/queries/client';
import { get } from 'idb-keyval';
jest.mock('idb-keyval', () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn() }));
jest.mock('@tanstack/react-query-devtools', () => ({ ReactQueryDevtools: () => null }));
const mockClient = makeQueryClient();
jest.mock('@/lib/queries/client', () => ({ ...jest.requireActual('@/lib/queries/client'), getQueryClient: () => mockClient }));
it('keeps dashboard children mounted once while persisted data restores', async () => {
  let restore: (value: undefined) => void = () => {}; let mounted = 0; let unmounted = 0;
  (get as jest.Mock).mockImplementation(() => new Promise(resolve => { restore = resolve; }));
  function Dashboard() { useEffect(() => { mounted++; return () => { unmounted++; }; }, []); return <p>Dashboard</p>; }
  render(<QueryProvider><Dashboard /></QueryProvider>);
  await waitFor(() => expect(get).toHaveBeenCalled());
  await act(async () => { restore(undefined); });
  expect(mounted).toBe(1); expect(unmounted).toBe(0);
});
