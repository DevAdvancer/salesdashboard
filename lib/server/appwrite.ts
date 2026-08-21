import { Client, Account, Databases, Storage, Users } from "node-appwrite";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import {
  createAppwriteReadCacheStores,
  createReadThroughDatabases,
} from "@/lib/utils/appwrite-read-cache";
import { bumpRequestCount } from "@/lib/server/appwrite-request-meter";

const adminDatabaseCacheStores = createAppwriteReadCacheStores();
const sessionDatabaseCacheStores = createAppwriteReadCacheStores();

function namespaceForSecret(prefix: string, value: string) {
  // Trigger cache reset
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

export async function createSessionClient() {
  const cookieStore = await cookies();
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!;
  const appJwt = cookieStore.get("crm_appwrite_jwt");

  if (appJwt?.value) {
    const client = new Client()
      .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
      .setProject(projectId)
      .setJWT(appJwt.value);

    return {
      get account() {
        return new Account(client);
      },
      get databases() {
        return createReadThroughDatabases(new Databases(client), {
          namespace: namespaceForSecret("session-jwt", appJwt.value),
          stores: sessionDatabaseCacheStores,
        });
      },
    };
  }

  const exactCookieNames = [
    `a_session_${projectId}`,
    `a_session_${projectId}_legacy`,
    projectId,
  ];
  const sessionCandidates = exactCookieNames
    .map((name) => cookieStore.get(name))
    .filter((cookie): cookie is { name: string; value: string } => Boolean(cookie?.value));

  // Each candidate below costs one Appwrite /v1/account request, and this path runs
  // before any authentication. The defense is building the candidate list from
  // `exactCookieNames` only: probing every a_session_* cookie on the request let an
  // anonymous caller turn one HTTP request carrying N crafted cookies into N Appwrite
  // requests. Never reinstate a catch-all prefix match here.
  //
  // The slice is a backstop for that rule, not the rule itself. It must stay >= the
  // length of `exactCookieNames`, otherwise adding a legitimate cookie name above
  // would silently drop it and those users would stop authenticating with no error.
  const MAX_SESSION_CANDIDATES = Math.max(3, exactCookieNames.length);
  const uniqueCandidates = Array.from(
    new Map(sessionCandidates.map((cookie) => [cookie.name, cookie])).values()
  ).slice(0, MAX_SESSION_CANDIDATES);

  for (const session of uniqueCandidates) {
    const client = new Client()
      .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
      .setProject(projectId)
      .setSession(session.value);

    try {
      // Metered: this probe is a real /v1/account request and it is the exact call
      // the candidate cap above exists to bound. Leaving it uncounted would make the
      // request meter blind to the abuse path it is meant to prove is closed.
      bumpRequestCount();
      await new Account(client).get();

      return {
        get account() {
          return new Account(client);
        },
        get databases() {
          return createReadThroughDatabases(new Databases(client), {
            namespace: namespaceForSecret("session-cookie", session.value),
            stores: sessionDatabaseCacheStores,
          });
        },
      };
    } catch {
      // Ignore stale or unrelated Appwrite session cookies and try the next candidate.
    }
  }

  throw new Error("No session");
}

export async function createAdminClient() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!);

  return {
    get account() {
      return new Account(client);
    },
    get databases() {
      return createReadThroughDatabases(new Databases(client), {
        namespace: "admin",
        stores: adminDatabaseCacheStores,
      });
    },
    get storage() {
      return new Storage(client);
    },
    get users() {
      return new Users(client);
    },
  };
}
