import { databases } from '@/lib/appwrite';

/** Browser lookups use the gated HTTP adapter; server lookups invoke the same
 * authorization policy in process, without forwarding authentication cookies. */
export const referenceDatabases = new Proxy(databases, {
  get(target, property) {
    if ((property === 'getDocument' || property === 'listDocuments') && typeof window === 'undefined' && process.env.NEXT_PUBLIC_CRM_SERVER_DATA === 'true') {
      return async (databaseId: string, collectionId: string, idOrQueries?: string | string[], queries?: string[]) =>
        (await import('@/app/actions/crm-reference')).readCrmReferenceAction({
          databaseId, collectionId, ...(property === 'getDocument' ? { documentId: idOrQueries as string, queries } : { queries: idOrQueries as string[] }),
        });
    }
    const value = Reflect.get(target, property);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
