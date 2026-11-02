import * as actions from '@/app/actions/client-progress';
import type { ProgressFilters } from '@/lib/client-progress';

async function unwrap<T>(promise: Promise<{ ok: true; data: T } | { ok: false; error: string }>) {
  const result = await promise;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
export const listClientProgressAction = (input: Parameters<typeof actions.listClientProgressAction>[0]) => unwrap(actions.listClientProgressAction(input));
export async function fetchClientProgress(filters: ProgressFilters, signal?: AbortSignal): Promise<Awaited<ReturnType<typeof listClientProgressAction>>> {
  const response = await fetch('/api/client-progress/list', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ filters }), signal,
  });
  if ((response.status === 401 || response.status === 403) && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('crm-access-recheck'));
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load clients. Please retry.');
  return result;
}
export const getClientProgressAction = (id: string) => unwrap(actions.getClientProgressAction(id));
export const listClientProgressEventsAction = (input: Parameters<typeof actions.listClientProgressEventsAction>[0]) => unwrap(actions.listClientProgressEventsAction(input));
export const searchProgressSalespeopleAction = (search: string) => unwrap(actions.searchProgressSalespeopleAction(search));
export const createManualProgressAction = (input: unknown) => unwrap(actions.createManualProgressAction(input));
export const updateClientProgressAction = (input: unknown) => unwrap(actions.updateClientProgressAction(input));
export const addClientProgressFeedbackAction = (input: unknown) => unwrap(actions.addClientProgressFeedbackAction(input));
export const getClientCardShareStatusAction = (id: string) => unwrap(actions.getClientCardShareStatusAction(id));
export const publishClientCardAction = (input: unknown) => unwrap(actions.publishClientCardAction(input));
export const revokeClientCardAction = (id: string) => unwrap(actions.revokeClientCardAction(id));
