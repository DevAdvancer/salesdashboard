/**
 * Rename company display names across leads, linkedin_accounts, and form_config.
 *
 * Renames:
 *   "SilverSpace Inc."  →  "Silverspace INC"
 *   "Vizva Inc."        →  "Vizva INC"
 *
 * Collections touched:
 *   - leads             (company stored inside the JSON `data` field)
 *   - linkedin_accounts (company is a top-level attribute)
 *   - form_config       (company options stored inside the JSON `fields` field)
 *
 * Run:
 *   bun run migrate:company-names            # dry-run (safe, no writes)
 *   bun run migrate:company-names -- --apply # apply changes
 */

import { Client, Databases, Query } from 'node-appwrite';
import * as dotenv from 'dotenv';
import * as path from 'path';

// ─── Env ─────────────────────────────────────────────────────────────────────

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ENDPOINT   = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT  || 'https://cloud.appwrite.io/v1';
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!;
const API_KEY    = process.env.APPWRITE_API_KEY!;
const DATABASE_ID =
  process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'crm-database-1';

const LEADS_COLLECTION          = process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID          || 'leads';
const LINKEDIN_ACCOUNTS_COLLECTION = process.env.NEXT_PUBLIC_APPWRITE_LINKEDIN_ACCOUNTS_COLLECTION_ID || 'linkedin_accounts';
const FORM_CONFIG_COLLECTION    = process.env.NEXT_PUBLIC_APPWRITE_FORM_CONFIG_COLLECTION_ID    || 'form_config';

if (!PROJECT_ID || !API_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_APPWRITE_PROJECT_ID or APPWRITE_API_KEY in .env.local');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

console.log('Config:', {
  ENDPOINT,
  PROJECT_ID: PROJECT_ID.substring(0, 4) + '***',
  DATABASE_ID,
  APPLY,
});

// ─── Client ───────────────────────────────────────────────────────────────────

const databases = new Databases(
  new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setKey(API_KEY),
);

// ─── Rename map ───────────────────────────────────────────────────────────────

const RENAMES: Record<string, string> = {
  'SilverSpace Inc.': 'Silverspace INC',
  'Vizva Inc.':       'Vizva INC',
};

function applyRename(value: string): string {
  return RENAMES[value] ?? value;
}

// ─── Pagination helper ────────────────────────────────────────────────────────

async function listAllDocuments(collectionId: string, extraQueries: string[] = []) {
  const docs: Record<string, unknown>[] = [];
  let cursor: string | null = null;

  for (;;) {
    const queries = [...extraQueries, Query.orderAsc('$id'), Query.limit(100)];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const res = await databases.listDocuments(DATABASE_ID, collectionId, queries);
    docs.push(...(res.documents as unknown as Record<string, unknown>[]));
    if (res.documents.length < 100) break;
    cursor = (res.documents[res.documents.length - 1] as { $id: string }).$id;
  }

  return docs;
}

// ─── Leads ────────────────────────────────────────────────────────────────────

async function migrateLeads(): Promise<{ found: number; updated: number; failed: number }> {
  console.log('\n📋 Scanning leads...');
  const all = await listAllDocuments(LEADS_COLLECTION);

  const toUpdate: { id: string; oldCompany: string; newData: string }[] = [];

  for (const doc of all) {
    const id = doc['$id'] as string;
    if (typeof doc['data'] !== 'string') continue;

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(doc['data'] as string); } catch { continue; }

    const company = typeof parsed['company'] === 'string' ? parsed['company'] : null;
    if (!company || !RENAMES[company]) continue;

    parsed['company'] = RENAMES[company];
    toUpdate.push({ id, oldCompany: company, newData: JSON.stringify(parsed) });
  }

  console.log(`  Found ${toUpdate.length} lead(s) to update.`);
  for (const { id, oldCompany } of toUpdate.slice(0, 5)) {
    console.log(`  - ${id}: "${oldCompany}" → "${RENAMES[oldCompany]}"`);
  }
  if (toUpdate.length > 5) console.log(`  ... and ${toUpdate.length - 5} more`);

  if (!APPLY) return { found: toUpdate.length, updated: 0, failed: 0 };

  let updated = 0, failed = 0;
  for (const { id, newData } of toUpdate) {
    try {
      await databases.updateDocument(DATABASE_ID, LEADS_COLLECTION, id, { data: newData });
      updated++;
      if (updated % 25 === 0) console.log(`  ... ${updated}/${toUpdate.length} updated`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${id}: ${(err as Error).message}`);
    }
  }
  return { found: toUpdate.length, updated, failed };
}

// ─── LinkedIn accounts ────────────────────────────────────────────────────────

async function migrateLinkedinAccounts(): Promise<{ found: number; updated: number; failed: number }> {
  console.log('\n🔗 Scanning linkedin_accounts...');

  // Query directly for the two old values
  const targets = await Promise.all(
    Object.keys(RENAMES).map((oldName) =>
      listAllDocuments(LINKEDIN_ACCOUNTS_COLLECTION, [Query.equal('company', oldName)]),
    ),
  ).then((results) => results.flat());

  console.log(`  Found ${targets.length} account(s) to update.`);
  for (const doc of targets.slice(0, 5)) {
    const old = doc['company'] as string;
    console.log(`  - ${doc['$id']}: "${old}" → "${RENAMES[old]}"`);
  }
  if (targets.length > 5) console.log(`  ... and ${targets.length - 5} more`);

  if (!APPLY) return { found: targets.length, updated: 0, failed: 0 };

  let updated = 0, failed = 0;
  for (const doc of targets) {
    const id = doc['$id'] as string;
    const newCompany = RENAMES[doc['company'] as string];
    try {
      await databases.updateDocument(DATABASE_ID, LINKEDIN_ACCOUNTS_COLLECTION, id, { company: newCompany });
      updated++;
    } catch (err) {
      failed++;
      console.error(`  ✗ ${id}: ${(err as Error).message}`);
    }
  }
  return { found: targets.length, updated, failed };
}

// ─── Form config ──────────────────────────────────────────────────────────────

type FormField = { key: string; type: string; options?: string[]; [k: string]: unknown };

async function migrateFormConfig(): Promise<{ found: number; updated: number; failed: number }> {
  console.log('\n⚙️  Scanning form_config...');
  const all = await listAllDocuments(FORM_CONFIG_COLLECTION);

  const toUpdate: { id: string; newFields: string }[] = [];

  for (const doc of all) {
    const id = doc['$id'] as string;
    if (typeof doc['fields'] !== 'string') continue;

    let fields: FormField[];
    try { fields = JSON.parse(doc['fields'] as string); } catch { continue; }
    if (!Array.isArray(fields)) continue;

    let changed = false;
    const updated = fields.map((field) => {
      if (!Array.isArray(field.options)) return field;
      const newOptions = field.options.map((opt) => {
        const renamed = applyRename(opt);
        if (renamed !== opt) changed = true;
        return renamed;
      });
      return { ...field, options: newOptions };
    });

    if (changed) toUpdate.push({ id, newFields: JSON.stringify(updated) });
  }

  console.log(`  Found ${toUpdate.length} form_config document(s) to update.`);

  if (!APPLY) return { found: toUpdate.length, updated: 0, failed: 0 };

  let updated = 0, failed = 0;
  for (const { id, newFields } of toUpdate) {
    try {
      await databases.updateDocument(DATABASE_ID, FORM_CONFIG_COLLECTION, id, { fields: newFields });
      updated++;
    } catch (err) {
      failed++;
      console.error(`  ✗ ${id}: ${(err as Error).message}`);
    }
  }
  return { found: toUpdate.length, updated, failed };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 Company name migration: ${APPLY ? 'APPLY' : 'DRY RUN (pass --apply to write)'}`);
  console.log('   Renames:');
  for (const [from, to] of Object.entries(RENAMES)) {
    console.log(`     "${from}" → "${to}"`);
  }

  const leads    = await migrateLeads();
  const linkedin = await migrateLinkedinAccounts();
  const forms    = await migrateFormConfig();

  console.log('\n' + '═'.repeat(55));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(55));
  console.log(`  Leads:            found=${leads.found}  updated=${leads.updated}  failed=${leads.failed}`);
  console.log(`  LinkedIn accounts: found=${linkedin.found}  updated=${linkedin.updated}  failed=${linkedin.failed}`);
  console.log(`  Form configs:     found=${forms.found}  updated=${forms.updated}  failed=${forms.failed}`);

  if (!APPLY) {
    console.log('\nDRY RUN complete — no documents were changed.');
    console.log('Re-run with --apply to apply the migration.');
  } else {
    const anyFailed = leads.failed + linkedin.failed + forms.failed;
    if (anyFailed > 0) {
      console.log(`\n⚠️  ${anyFailed} update(s) failed. Review errors above and re-run.`);
      process.exit(1);
    }
    console.log('\n✅ Migration complete.');
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
