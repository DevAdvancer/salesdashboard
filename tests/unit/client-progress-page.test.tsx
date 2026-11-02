import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Page from '@/app/client-progress/page';
import { useAuth } from '@/lib/contexts/auth-context';
import * as service from '@/lib/services/client-progress-service';

jest.mock('@/lib/contexts/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/components/protected-route', () => ({ ProtectedRoute: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/lib/services/client-progress-service', () => ({
  fetchClientProgress: jest.fn(), getClientProgressAction: jest.fn(), listClientProgressEventsAction: jest.fn(),
  searchProgressSalespeopleAction: jest.fn(), createManualProgressAction: jest.fn(), updateClientProgressAction: jest.fn(), addClientProgressFeedbackAction: jest.fn(),
  getClientCardShareStatusAction: jest.fn(), publishClientCardAction: jest.fn(), revokeClientCardAction: jest.fn(),
}));
const entry = { $id: 'entry', $updatedAt: 'v1', candidateName: 'Test Client', email: 'test@example.com', phone: '', salespersonId: 'agent', salespersonName: 'Sales Agent', marketingTl: 'Marketing TL', recruiterName: 'Recruiter', progressStatus: 'New', enteredAt: '2026-11-01T12:00:00Z', source: 'manual', notes: '', finalFeedback: 'Final saved', finalSavedAt: '2026-11-01T12:00:00Z' };
let queryClient: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ user: { $id: 'agent', role: 'agent', department: 'sales' } });
  (service.fetchClientProgress as jest.Mock).mockResolvedValue({ entries: [entry] });
  (service.getClientProgressAction as jest.Mock).mockResolvedValue(entry);
  (service.listClientProgressEventsAction as jest.Mock).mockResolvedValue({ events: [], nextCursor: null });
  (service.getClientCardShareStatusAction as jest.Mock).mockResolvedValue({ active: false, expiresAt: null, includeContact: false, includeNotes: false });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: 1000 }, mutations: { retry: false } } });
});
afterEach(() => { queryClient.clear(); jest.useRealTimers(); });
function open() { return render(<QueryClientProvider client={queryClient}><Page /></QueryClientProvider>); }

test('renders assigned entries, submits search only on Apply, and Reset clears filters', async () => {
  open(); await screen.findByText('Test Client');
  expect(screen.queryByRole('button', { name: 'Add candidate' })).not.toBeInTheDocument();
  const search = screen.getByLabelText('Search clients');
  fireEvent.change(search, { target: { value: 'Alice' } });
  expect(service.fetchClientProgress).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(service.fetchClientProgress).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Alice' }), expect.any(AbortSignal)));
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  await waitFor(() => expect(search).toHaveValue(''));
  // Reset immediately reuses the fresh latest-ten snapshot; no duplicate DB read.
  expect(service.fetchClientProgress).toHaveBeenCalledTimes(2);
});

test('explicitly disables the global polling interval', async () => {
  jest.useFakeTimers(); open();
  await screen.findByText('Test Client');
  expect(service.fetchClientProgress).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(31 * 60 * 1000); });
  expect(service.fetchClientProgress).toHaveBeenCalledTimes(1);
});

test('the list has no pages and returning from a detail reuses its recent result', async () => {
  open(); await screen.findByText('Test Client');
  expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
  expect(screen.getByText('Maximum 10 results', { exact: false })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  await screen.findByText('Client details');
  fireEvent.click(screen.getByRole('button', { name: 'Back to clients' }));
  await screen.findByText('Test Client');
  expect(service.fetchClientProgress).toHaveBeenCalledTimes(1);
});

test('background refresh keeps existing rows visible', async () => {
  open(); await screen.findByText('Test Client');
  let finish!: (value: { entries: typeof entry[] }) => void;
  (service.fetchClientProgress as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await screen.findByText('Updating…');
  expect(screen.getByText('Test Client')).toBeInTheDocument();
  expect(screen.queryByText('Loading clients…')).not.toBeInTheDocument();
  await act(async () => { finish({ entries: [entry] }); });
  await waitFor(() => expect(screen.queryByText('Updating…')).not.toBeInTheDocument());
});

test('detail reads are lazy, recruiter/Marketing TL are locked, and final feedback stays locked after first save', async () => {
  open(); await screen.findByText('Test Client');
  expect(service.getClientProgressAction).not.toHaveBeenCalled();
  expect(service.listClientProgressEventsAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  await screen.findByText('Client details');
  const status = screen.getByLabelText('Progress status');
  expect(status).toHaveValue('New');
  expect(Array.from((status as HTMLSelectElement).options).map(option => option.text)).toEqual(['New', 'Placed', 'Backout', 'Hold', 'Temp Hold', 'Low priority', 'Marketing in progress']);
  expect(screen.getByLabelText('Recruiter name')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('Marketing TL')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('Final feedback')).toHaveAttribute('readonly');
  expect(screen.getByRole('button', { name: 'View client card' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Share client card' })).not.toBeInTheDocument();
  expect(service.getClientProgressAction).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(service.listClientProgressEventsAction).toHaveBeenCalledTimes(1));
});

test('date filters use the custom calendar without submitting or fetching on open', async () => {
  open(); await screen.findByText('Test Client');
  const from = screen.getByLabelText('Added from (Eastern)');
  expect(from.tagName).toBe('BUTTON');
  fireEvent.click(from);
  expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument();
  expect(service.fetchClientProgress).toHaveBeenCalledTimes(1);
});

test('only Admin sees link management and opening its preview does not publish anything', async () => {
  (useAuth as jest.Mock).mockReturnValue({ user: { $id: 'admin', role: 'admin', department: 'sales', isActive: true } });
  open(); await screen.findByText('Test Client');
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Share client card' }));
  await screen.findByText('Share this client card');
  expect(await screen.findByRole('button', { name: 'Create share link' })).toBeInTheDocument();
  expect(service.getClientCardShareStatusAction).toHaveBeenCalledWith('entry');
  expect(service.publishClientCardAction).not.toHaveBeenCalled();
  expect(service.revokeClientCardAction).not.toHaveBeenCalled();
});
