import { createAdminClient } from '../lib/server/appwrite';

async function main() {
  const { databases, users } = await createAdminClient();
  const docs = await databases.listDocuments(process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID, 'users');
  const adminId = docs.documents.find(d => d.role === 'admin')?.\$id\;
  console.log('Admin ID:', adminId);
  if (adminId) {
    const user = await users.get(adminId);
    console.log('Admin email in Auth:', user.email);
  }
}
main().catch(console.error);
