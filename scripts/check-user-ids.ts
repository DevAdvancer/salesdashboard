import { createAdminClient } from '../lib/server/appwrite';
import { COLLECTIONS, DATABASE_ID } from '../lib/constants/appwrite';

async function main() {
    const { databases, users } = await createAdminClient();
    
    const dbUsers = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS);
    console.log(`Database users count: ${dbUsers.documents.length}`);
    
    const authUsers = await users.list();
    console.log(`Auth users count: ${authUsers.users.length}`);
    
    let mismatchCount = 0;
    for (const dbUser of dbUsers.documents) {
        try {
            await users.get(dbUser.$id);
        } catch (e) {
            console.log(`ERROR: DB User ${dbUser.name} (${dbUser.email}) ID ${dbUser.$id} DOES NOT exist in Auth!`);
            mismatchCount++;
        }
    }
    console.log(`Total mismatches: ${mismatchCount}`);
}
main().catch(console.error);
