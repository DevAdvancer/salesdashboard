'use server';
import { withCrmRequestContext } from '@/lib/server/crm-request-context';
import { listMyTeamAttendanceAction } from './list';
import { getAttendanceFlagSummaryAction } from './report';

/** Read-only bundle: one HTTP action and one fresh authorization snapshot. */
export async function loadAttendanceTeamAction(input: { currentUserId: string; teamLeadId?: string; dateKey?: string }) {
  return withCrmRequestContext(async () => {
    const [attendance, summary] = await Promise.all([
      listMyTeamAttendanceAction(input),
      getAttendanceFlagSummaryAction({ currentUserId: input.currentUserId, teamLeadId: input.teamLeadId, referenceDateKey: input.dateKey }),
    ]);
    return { attendance, summary };
  });
}
