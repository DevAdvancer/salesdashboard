
import { Client, Databases, Permission, Role } from 'node-appwrite';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!;
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!;
const apiKey = process.env.APPWRITE_API_KEY!;
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'crm-database-1';
const collectionId = process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID || 'leads';
const auditCollectionId = process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID || 'audit_logs';

if (!apiKey) {
    console.error('API Key missing');
    process.exit(1);
}

const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey);

const databases = new Databases(client);

async function run() {
    const leadId = process.argv[2];
    const actorId = process.argv[3];
    const actorName = process.argv[4];

    if (!leadId) {
        console.error('Lead ID required');
        process.exit(1);
    }

    try {
        // 1. Get the lead
        const lead = await databases.getDocument(
            databaseId,
            collectionId,
            leadId
        );

        // 2. Prepare permissions
        // Start with existing permissions to avoid breaking visibility for others
        const permissionSet = new Set(lead.$permissions || []);

        // Ensure owner has full access
        permissionSet.add(Permission.read(Role.user(lead.ownerId)));
        permissionSet.add(Permission.update(Role.user(lead.ownerId)));
        permissionSet.add(Permission.delete(Role.user(lead.ownerId)));

        // Ensure assigned agent has update access
        if (lead.assignedToId) {
            permissionSet.add(Permission.read(Role.user(lead.assignedToId)));
            permissionSet.add(Permission.update(Role.user(lead.assignedToId)));
        }

        // Add explicit 'users' read access to ensure visibility for Managers/Admins
        // NOTE: In a stricter environment, we should only add the specific Manager/Admin role.
        // For now, removing the global 'users' read to comply with least privilege,
        // unless it's strictly required for visibility. 
        // If visibility issues recur, consider adding specific role labels like 'label:manager' instead.
        // permissionSet.add(Permission.read(Role.users())); 
        
        // Instead, let's ensure the Manager/Admin labels have access if your system uses labels
        // Or if you rely on collection-level permissions for Managers, then document-level isn't needed for them.
        // If we MUST ensure visibility for a specific upper role:
        // permissionSet.add(Permission.read(Role.label('manager')));
        
        // For this fix, I will remove the global read and rely on the owner/assigned + collection permissions.
        // If you need global visibility for all authenticated users, uncomment the line below.
        // permissionSet.add(Permission.read(Role.users()));

        const permissions = Array.from(permissionSet);

        // 3. Update the lead
        await databases.updateDocument(
            databaseId,
            collectionId,
            leadId,
            {
                isClosed: false,
                status: 'Reopened',
            },
            permissions
        );

        // 4. Log audit (if actor provided)
        if (actorId && actorName) {
            try {
                await databases.createDocument(
                    databaseId,
                    auditCollectionId,
                    'unique()',
                    {
                        action: 'LEAD_UPDATE',
                        actorId: actorId,
                        actorName: actorName,
                        targetId: leadId,
                        targetType: 'LEAD',
                        metadata: JSON.stringify({ isClosed: false, method: 'worker_script' }),
                        performedAt: new Date().toISOString(),
                    }
                );
            } catch (e) {
                // Ignore audit error
            }
        }

        console.log(JSON.stringify({ success: true }));
        process.exit(0);

    } catch (error: any) {
        console.error(JSON.stringify({ success: false, error: error.message }));
        process.exit(1);
    }
}

run();
