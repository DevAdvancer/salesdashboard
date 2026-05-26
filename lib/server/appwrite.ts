import { Client, Account, Databases, Users } from "node-appwrite";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import {
  createAppwriteReadCacheStores,
  createReadThroughDatabases,
} from "@/lib/utils/appwrite-read-cache";

const adminDatabaseCacheStores = createAppwriteReadCacheStores();
const sessionDatabaseCacheStores = createAppwriteReadCacheStores();

function namespaceForSecret(prefix: string, value: string) {
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
  const allCookies = cookieStore.getAll();
  const sessionCandidates = [
    ...exactCookieNames
      .map((name) => cookieStore.get(name))
      .filter((cookie): cookie is { name: string; value: string } => Boolean(cookie?.value)),
    ...allCookies.filter(
      (cookie) =>
        cookie.name.startsWith("a_session_") &&
        Boolean(cookie.value) &&
        !exactCookieNames.includes(cookie.name)
    ),
  ];

  const uniqueCandidates = Array.from(
    new Map(sessionCandidates.map((cookie) => [cookie.name, cookie])).values()
  );

  for (const session of uniqueCandidates) {
    const client = new Client()
      .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
      .setProject(projectId)
      .setSession(session.value);

    try {
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
    get users() {
      return new Users(client);
    },
  };
}
