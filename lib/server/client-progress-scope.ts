import { Query, type Databases, type Models } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { type ProgressActor, type HierarchyPerson, progressHierarchyIds } from '@/lib/client-progress';

// Schema shape only; never cache memberships or authorization decisions here.
let parentFields: Promise<string[]> | undefined;
export async function resolveProgressVisibleIds(db: Databases, actor: ProgressActor) {
  if (!['team_lead', 'senior_tl'].includes(actor.role)) return [actor.$id];
  parentFields ??= db.getCollection(DATABASE_ID, COLLECTIONS.USERS).then(collection => {
    const available = new Set((collection.attributes as unknown as Array<{ key: string }>).map(attribute => attribute.key));
    return ['teamLeadId', 'managerId', 'teamLeadIds', 'managerIds', 'assistantManagerIds'].filter(field => available.has(field));
  }).catch(error => { parentFields = undefined; throw error; });
  const fields = await parentFields;
  if (!fields.length) return [actor.$id];
  let frontier = [actor.$id];
  const seen = new Set(frontier);
  const rows: HierarchyPerson[] = [];
  for (let depth = 0; frontier.length && depth < 20; depth++) {
    const next: string[] = [];
    for (let start = 0; start < frontier.length; start += 50) {
      const ids = frontier.slice(start, start + 50);
      const users = await listAllDocuments<Models.Document & HierarchyPerson>({
        databases: db, databaseId: DATABASE_ID, collectionId: COLLECTIONS.USERS,
        queries: [Query.or(fields.map(field => field.endsWith('Ids') ? Query.contains(field, ids) : Query.equal(field, ids))),
          Query.select(['$id', 'role', 'department', ...fields]), Query.orderAsc('$id')],
        pageLimit: 100, maxPages: 20, requireComplete: true, maxDocuments: 1001,
      });
      for (const user of users) {
        if (seen.has(user.$id) || (user.department || 'sales') !== (actor.department || 'sales')) continue;
        seen.add(user.$id); rows.push(user);
        if (!user.role || ['team_lead', 'senior_tl'].includes(user.role)) next.push(user.$id);
      }
      if (seen.size > 1000) throw new Error('Your hierarchy is too large for this view. Contact Admin.');
    }
    frontier = next;
  }
  if (frontier.length) throw new Error('Your hierarchy exceeds the supported depth. Contact Admin.');
  return progressHierarchyIds(actor, rows);
}
