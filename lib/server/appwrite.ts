import { Client, Account, Databases, Users } from "node-appwrite";
import { cookies } from "next/headers";

export async function createSessionClient() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);

  const cookieStore = await cookies();
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!;
  
  // Try different cookie name formats
  let session = cookieStore.get(`a_session_${projectId}`);
  
  if (!session || !session.value) {
    // Try legacy format
    session = cookieStore.get(`a_session_${projectId}_legacy`);
  }
  
  if (!session || !session.value) {
    // Try without prefix
    session = cookieStore.get(projectId);
  }
  
  if (!session || !session.value) {
    const allCookies = cookieStore.getAll();
    console.error('Session cookie not found.');
    console.error('Expected cookie name:', `a_session_${projectId}`);
    console.error('Available cookies:', allCookies.map(c => ({ name: c.name, hasValue: !!c.value })));
    throw new Error("No session");
  }

  client.setSession(session.value);

  return {
    get account() {
      return new Account(client);
    },
    get databases() {
      return new Databases(client);
    },
  };
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
      return new Databases(client);
    },
    get users() {
      return new Users(client);
    },
  };
}
