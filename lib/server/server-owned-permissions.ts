import type { Databases } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';

/** Roles, activation and attendance are server-owned; preserve client read scope only. */
export function withServerOwnedPermissions(databases: Databases): Databases {
  return new Proxy(databases, {
    get(target, property, receiver) {
      const method = Reflect.get(target, property, receiver);
      if (typeof method !== 'function') return method;
      if (property !== 'createDocument' && property !== 'updateDocument') return method.bind(target);
      return async (...args: unknown[]) => {
        if (args[0] === DATABASE_ID && [COLLECTIONS.USERS, COLLECTIONS.ATTENDANCE].includes(String(args[1]))) {
          let permissions = args[4] as string[] | undefined;
          if (!permissions && property === 'updateDocument') {
            permissions = (await target.getDocument(String(args[0]), String(args[1]), String(args[2]))).$permissions;
          }
          args[4] = (permissions || []).filter(permission => permission.startsWith('read('));
        }
        return method.apply(target, args);
      };
    },
  });
}
