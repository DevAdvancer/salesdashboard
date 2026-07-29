import { Client, Databases, Query } from 'node-appwrite';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
import fs from 'fs';
if (fs.existsSync(path.resolve(process.cwd(), '.env'))) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}
if (fs.existsSync(path.resolve(process.cwd(), '.env.local'))) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });
}

const APPWRITE_ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!;
const APPWRITE_PROJECT = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!;
const APPWRITE_KEY = process.env.APPWRITE_API_KEY!;
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'crm-database-1';
const LEADS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID || 'leads';
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID || 'users';

if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT || !APPWRITE_KEY) {
    console.error('Missing required environment variables');
    process.exit(1);
}

const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT)
    .setKey(APPWRITE_KEY);

const databases = new Databases(client);

async function run() {
    const isApply = process.argv.includes(':apply');
    console.log(`Starting closedByName backfill in ${isApply ? 'APPLY' : 'DRY RUN'} mode...`);

    let cursor: string | undefined = undefined;
    const limit = 100;
    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalAlreadyHasName = 0;
    let totalUsersNotFound = 0;

    const userCache = new Map<string, { name: string } | null>();

    async function getUser(userId: string) {
        if (!userId) return null;
        if (userCache.has(userId)) return userCache.get(userId);
        try {
            const doc = await databases.getDocument(DATABASE_ID, USERS_COLLECTION_ID, userId);
            const user = { name: doc.name as string };
            userCache.set(userId, user);
            return user;
        } catch (e) {
            userCache.set(userId, null);
            return null;
        }
    }

    while (true) {
        const queries = [
            Query.equal('isClosed', true),
            Query.limit(limit)
        ];
        if (cursor) {
            queries.push(Query.cursorAfter(cursor));
        }

        const response = await databases.listDocuments(DATABASE_ID, LEADS_COLLECTION_ID, queries);
        const leads = response.documents;
        if (leads.length === 0) break;

        for (const lead of leads) {
            totalProcessed++;
            let dataObj: any = {};
            try {
                dataObj = JSON.parse(lead.data || "{}");
            } catch (e) {
                // ignore
            }

            if (dataObj.closedByName) {
                totalAlreadyHasName++;
                continue;
            }

            const closerId = lead.assignedToId || lead.ownerId;
            const user = await getUser(closerId);

            if (!user) {
                totalUsersNotFound++;
                continue;
            }

            dataObj.closedById = closerId;
            dataObj.closedByName = user.name;

            if (isApply) {
                await databases.updateDocument(DATABASE_ID, LEADS_COLLECTION_ID, lead.$id, {
                    data: JSON.stringify(dataObj)
                });
                console.log(`[APPLY] Updated lead ${lead.$id} with closedByName = ${user.name}`);
            } else {
                console.log(`[DRY RUN] Would update lead ${lead.$id} with closedByName = ${user.name}`);
            }
            totalUpdated++;
        }

        cursor = leads[leads.length - 1].$id;
        console.log(`Processed ${totalProcessed} closed leads...`);
    }

    console.log('\n--- Backfill Summary ---');
    console.log(`Mode:                 ${isApply ? 'APPLY' : 'DRY RUN'}`);
    console.log(`Total Closed Leads:   ${totalProcessed}`);
    console.log(`Already Has Name:     ${totalAlreadyHasName}`);
    console.log(`Users Not Found:      ${totalUsersNotFound}`);
    console.log(`Leads to Update:      ${totalUpdated}`);
}

run().catch(console.error);
