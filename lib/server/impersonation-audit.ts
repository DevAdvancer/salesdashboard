import type { Databases } from 'node-appwrite';
import { cookies } from 'next/headers';
import { CRM_IMPERSONATION_COOKIE } from '@/lib/utils/crm-impersonation';
import { resolveSecurityIdentity } from '@/lib/server/crm-access';
import { appendLeadHistory } from '@/lib/server/lead-history';

/** Admin SDK writes must retain operator attribution too: native Appwrite
 * impersonation authorizes identity, while CRM actions use privileged storage. */
export function withImpersonationAudit(databases: Databases, auditDatabase: Databases): Databases {
  return new Proxy(databases, { get(target, property) {
    const method = Reflect.get(target, property);
    if (typeof method !== 'function') return method;
    if (!['createDocument', 'updateDocument', 'deleteDocument'].includes(String(property))) return method.bind(target);
    return async (...args: unknown[]) => {
      let jar;
      try { jar = await cookies(); } catch { /* Internal jobs have no request cookies. */ }
      if (!jar?.get(CRM_IMPERSONATION_COOKIE)?.value) return method.apply(target, args);
      const identity = await resolveSecurityIdentity();
      if (!identity.operator) throw new Error('Impersonation identity is unavailable.');
      const actor = { id: identity.operator.user.$id, name: identity.operator.user.name,
        impersonatedUserId: identity.user.$id, impersonatedUserName: identity.user.name };
      const payload = { databaseId: args[0], collectionId: args[1], documentId: args[2], operation: String(property) };
      await appendLeadHistory(auditDatabase, { eventType: 'IMPERSONATION_MUTATION_ATTEMPT', actor, payload });
      let result;
      try { result = await method.apply(target, args); }
      catch (error) {
        await appendLeadHistory(auditDatabase, { eventType: 'IMPERSONATION_MUTATION_FAILED', actor, payload });
        throw error;
      }
      await appendLeadHistory(auditDatabase, { eventType: 'IMPERSONATION_MUTATION_COMPLETED', actor, payload });
      return result;
    };
  } });
}
