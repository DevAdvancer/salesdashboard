import { createAdminClient } from '../lib/server/appwrite';
import { createNotificationsForRecipients } from '../lib/server/notifications';

async function main() {
    const { databases, users } = await createAdminClient();
    const userList = await users.list();
    const testUser = userList.users.find(u => u.email === 'abhirupvizva@gmail.com') || userList.users[0];
    
    console.log("Creating notification for", testUser.email, "id:", testUser.$id);
    await createNotificationsForRecipients(
        databases,
        [testUser.$id],
        {
            type: 'lead_assignment',
            title: 'Lead assigned (Script Test)',
            body: 'Lead Script Test is assigned to you.',
            targetId: 'test-lead-id',
            targetType: 'LEAD',
        }
    );
    console.log("Done");
}

main().catch(console.error);
