/**
 * Migration Script: Team Lead Role Hierarchy
 *
 * This script documents the Appwrite schema changes applied via MCP tools.
 * It can also be run manually against the Appwrite SDK if needed.
 *
 * Changes applied:
 * 1. users.role enum updated: added 'team_lead' → ['admin', 'manager', 'team_lead', 'agent']
 * 2. users collection: added 'branchIds' (string[], optional)
 * 3. users collection: added 'teamLeadId' (string, optional)
 * 4. access_config table: dropped and recreated with role enum ['admin', 'manager', 'team_lead', 'agent']
 * 5. Existing user documents: branchId values migrated to branchIds arrays
 * 6. access_config: seeded all 28 rules (7 components × 4 roles)
 *
 * Access rules per role:
 *   admin:     all 7 components = allowed
 *   manager:   all allowed except branch-management = denied
 *   team_lead: dashboard/leads/history/user-management = allowed; field-management/settings/branch-management = denied
 *   agent:     dashboard/leads = allowed; all others = denied
 */

import { Client, Databases, Query } from 'node-appwrite';

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);

const databases = new Databases(client);
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const USERS_COLLECTION = 'users';
const ACCESS_CONFIG_COLLECTION = 'access_config';

async function migrateUserBranchIds() {
  console.log('Migrating user branchId → branchIds...');

  const users = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
    Query.limit(100),
  ]);

  for (const user of users.documents) {
    const branchId = user.branchId as string | null;
    const branchIds = (user.branchIds as string[]) || [];

    // Only migrate if branchIds is empty and branchId exists
    if (branchIds.length === 0 && branchId) {
      await databases.updateDocument(DATABASE_ID, USERS_COLLECTION, user.$id, {
        branchIds: [branchId],
      });
      console.log(`  Migrated user ${user.$id}: branchId="${branchId}" → branchIds=["${branchId}"]`);
    }
  }

  console.log('User migration complete.');
}

async function seedAllAccessRules() {
  console.log('Seeding all access_config rules (28 total)...');

  const rules = [
    // Admin — all allowed
    { id: 'ac-adm-dash', componentKey: 'dashboard', role: 'admin', allowed: true },
    { id: 'ac-adm-leads', componentKey: 'leads', role: 'admin', allowed: true },
    { id: 'ac-adm-hist', componentKey: 'history', role: 'admin', allowed: true },
    { id: 'ac-adm-users', componentKey: 'user-management', role: 'admin', allowed: true },
    { id: 'ac-adm-fields', componentKey: 'field-management', role: 'admin', allowed: true },
    { id: 'ac-adm-sett', componentKey: 'settings', role: 'admin', allowed: true },
    { id: 'ac-adm-branch', componentKey: 'branch-management', role: 'admin', allowed: true },
    // Manager — all allowed except branch-management
    { id: 'ac-mgr-dash', componentKey: 'dashboard', role: 'manager', allowed: true },
    { id: 'ac-mgr-leads', componentKey: 'leads', role: 'manager', allowed: true },
    { id: 'ac-mgr-hist', componentKey: 'history', role: 'manager', allowed: true },
    { id: 'ac-mgr-users', componentKey: 'user-management', role: 'manager', allowed: true },
    { id: 'ac-mgr-fields', componentKey: 'field-management', role: 'manager', allowed: true },
    { id: 'ac-mgr-sett', componentKey: 'settings', role: 'manager', allowed: true },
    { id: 'ac-mgr-branch', componentKey: 'branch-management', role: 'manager', allowed: false },
    // Team Lead — dashboard/leads/history/user-management allowed
    { id: 'ac-tl-dash', componentKey: 'dashboard', role: 'team_lead', allowed: true },
    { id: 'ac-tl-leads', componentKey: 'leads', role: 'team_lead', allowed: true },
    { id: 'ac-tl-hist', componentKey: 'history', role: 'team_lead', allowed: true },
    { id: 'ac-tl-users', componentKey: 'user-management', role: 'team_lead', allowed: true },
    { id: 'ac-tl-fields', componentKey: 'field-management', role: 'team_lead', allowed: false },
    { id: 'ac-tl-sett', componentKey: 'settings', role: 'team_lead', allowed: false },
    { id: 'ac-tl-branch', componentKey: 'branch-management', role: 'team_lead', allowed: false },
    // Agent — dashboard/leads allowed
    { id: 'ac-agt-dash', componentKey: 'dashboard', role: 'agent', allowed: true },
    { id: 'ac-agt-leads', componentKey: 'leads', role: 'agent', allowed: true },
    { id: 'ac-agt-hist', componentKey: 'history', role: 'agent', allowed: false },
    { id: 'ac-agt-users', componentKey: 'user-management', role: 'agent', allowed: false },
    { id: 'ac-agt-fields', componentKey: 'field-management', role: 'agent', allowed: false },
    { id: 'ac-agt-sett', componentKey: 'settings', role: 'agent', allowed: false },
    { id: 'ac-agt-branch', componentKey: 'branch-management', role: 'agent', allowed: false },
  ];

  for (const rule of rules) {
    try {
      await databases.createDocument(DATABASE_ID, ACCESS_CONFIG_COLLECTION, rule.id, {
        componentKey: rule.componentKey,
        role: rule.role,
        allowed: rule.allowed,
      });
      console.log(`  Created: ${rule.id} (${rule.role}/${rule.componentKey}=${rule.allowed})`);
    } catch (error: any) {
      if (error.code === 409) {
        console.log(`  Skipped (exists): ${rule.id}`);
      } else {
        throw error;
      }
    }
  }

  console.log('Access rules seeding complete.');
}

async function main() {
  console.log('Starting Team Lead migration...');
  await migrateUserBranchIds();
  await seedAllAccessRules();
  console.log('Migration complete!');
}

main().catch(console.error);
