import { Query, type Databases } from 'node-appwrite';
import { DATABASE_ID, COLLECTIONS } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import type { User } from '@/lib/types';

/** All active Resume Team Leads (full docs). */
export async function getResumeTeamLeads(databases: Databases): Promise<User[]> {
  const users = await listAllDocuments<User>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS,
    queries: [Query.equal('role', 'team_lead')],
    pageLimit: 100,
    maxPages: 20,
  });
  return users
    .filter((u) => u.isActive !== false)
    .filter((u) => (u as unknown as { department?: string }).department === 'resume');
}

/** All active Resume Team Lead ids — the default notification target. */
export async function getResumeTeamLeadIds(databases: Databases): Promise<string[]> {
  const leads = await getResumeTeamLeads(databases);
  return leads.map((u) => u.$id);
}

export function isResumeSide(user: User): boolean {
  const dept = (user as unknown as { department?: string }).department;
  if (dept === 'resume') return true;
  // Leadership roles can act on either side.
  return (
    user.role === 'admin' ||
    user.role === 'developer' ||
    user.role === 'monitor' ||
    user.role === 'operations'
  );
}
