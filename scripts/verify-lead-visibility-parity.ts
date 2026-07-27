/**
 * Lead visibility parity check.
 *
 * Recomputes, per user, the four numbers that must NOT move when the `leads`
 * and `users` collection permissions are changed from `read("any")` to
 * `read("users")`:
 *
 *   owned    - leads where ownerId === user
 *   assigned - leads where assignedToId === user
 *   app      - leads visible through the application's role scoping
 *              (the number the dashboard shows)
 *   doc      - leads carrying an explicit read("user:<id>") grant
 *              (what documentSecurity would enforce if it were enabled)
 *
 * It diffs those against tests/fixtures/lead-visibility-baseline.json and
 * exits non-zero on any difference.
 *
 * Run it BEFORE the console permission change to confirm the baseline still
 * matches, and AFTER to confirm nothing moved:
 *
 *   bun run verify:visibility
 *
 * This is read-only. It issues GET requests and never writes.
 *
 * The `app` computation mirrors listLeadsAction (app/actions/lead.ts:1379-1427)
 * over the whole lead universe, with no status or date filters, so it measures
 * visibility scope rather than any particular list page. Keep it in step with
 * that function; tests/unit/leads/lead-visibility-matrix.test.ts locks the
 * semantics on the application side.
 */

import { config } from 'dotenv';
import { Client, Databases, Query } from 'node-appwrite';
import { getSpecialBranchLeadAccess } from '../lib/constants/special-lead-access';
import { COLLECTIONS, DATABASE_ID } from '../lib/constants/appwrite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

config({ path: '.env.local' });
config({ path: '.env' });

const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY;
// DATABASE_ID and COLLECTIONS already apply the NEXT_PUBLIC_APPWRITE_* env
// overrides with the same defaults, so reading those vars again here would just
// duplicate the fallback literals in a second place.
const USERS_ID = COLLECTIONS.USERS;
const LEADS_ID = COLLECTIONS.LEADS;

const ADMIN_LIKE = ['admin', 'developer', 'monitor', 'operations'];

// Appwrite documents are dynamically shaped: the attributes differ per
// collection and are not typed in this repo, so a permissive record is the
// honest type here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = Record<string, any>;

if (!ENDPOINT || !PROJECT_ID || !API_KEY) {
  console.error(
    'Missing NEXT_PUBLIC_APPWRITE_ENDPOINT, NEXT_PUBLIC_APPWRITE_PROJECT_ID or APPWRITE_API_KEY.'
  );
  process.exit(2);
}

const databases = new Databases(
  new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setKey(API_KEY)
);

/** Cursor walk at the maximum page size Appwrite allows. */
async function walk(collectionId: string): Promise<AnyDoc[]> {
  const out: AnyDoc[] = [];
  let cursor: string | null = null;
  for (;;) {
    const queries = [Query.limit(5000)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const res = await databases.listDocuments(DATABASE_ID, collectionId, queries);
    const docs = res.documents as unknown as AnyDoc[];
    out.push(...docs);
    if (docs.length < 5000) return out;
    cursor = docs[docs.length - 1].$id;
  }
}

function appVisibleCount(user: AnyDoc, users: AnyDoc[], leads: AnyDoc[]): number | 'DENIED' {
  const department = user.department || 'sales';
  const role = user.role;

  // assertSalesCrmAccess (app/actions/lead.ts:662)
  if (department === 'resume' && !ADMIN_LIKE.includes(role)) return 'DENIED';

  // listLeadsAction widens both agents and team leads by a per-email branch
  // grant (app/actions/lead.ts, getSpecialBranchLeadAccess). Omitting it here
  // understates the count for any user holding one, so the parity check would
  // report a spurious drift the first time it ran.
  //
  // Not modelled: the additional backed-out widening that
  // appendTeamLeadLeadVisibilityQuery applies from the caller-supplied
  // branchIds. That depends on request input rather than stored state, it only
  // matches leads that are both closed and backed out, and this script measures
  // the whole lead universe with no status filter.
  const specialBranchId = getSpecialBranchLeadAccess(user.email as string | undefined);
  const inSpecialBranch = (l: AnyDoc) =>
    Boolean(specialBranchId) && l.branchId === specialBranchId;

  if (role === 'agent') {
    return leads.filter(
      (l) => l.assignedToId === user.$id || l.ownerId === user.$id || inSpecialBranch(l)
    ).length;
  }

  if (role === 'lead_generation') {
    return leads.filter((l) => l.ownerId === user.$id).length;
  }

  if (ADMIN_LIKE.includes(role)) {
    // Admin-like roles read everything, then the department scope is applied
    // in memory via leadMatchesDepartmentScope (app/actions/lead.ts:642).
    const salesIds = new Set(
      users.filter((u) => (u.department || 'sales') === 'sales').map((u) => u.$id)
    );
    return leads.filter(
      (l) =>
        salesIds.has(l.ownerId) ||
        (typeof l.assignedToId === 'string' && salesIds.has(l.assignedToId))
    ).length;
  }

  if (role === 'team_lead') {
    // getTeamLeadLeadVisibilityScope (app/actions/lead.ts:523): owners are the
    // team lead plus their agents; assignment additionally includes their
    // lead_generation users.
    const team = users.filter((u) => u.teamLeadId === user.$id);
    const ownerVisible = new Set([
      user.$id,
      ...team.filter((u) => u.role === 'agent').map((u) => u.$id),
    ]);
    const assignVisible = new Set([
      user.$id,
      ...team.filter((u) => u.role === 'agent' || u.role === 'lead_generation').map((u) => u.$id),
    ]);
    return leads.filter(
      (l) =>
        ownerVisible.has(l.ownerId) ||
        (typeof l.assignedToId === 'string' && assignVisible.has(l.assignedToId)) ||
        inSpecialBranch(l)
    ).length;
  }

  return 0;
}

async function main() {
  const baselinePath = resolve(process.cwd(), 'tests/fixtures/lead-visibility-baseline.json');
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

  console.log(`Reading ${DATABASE_ID} ...`);
  const [users, leads] = await Promise.all([walk(USERS_ID), walk(LEADS_ID)]);
  console.log(`  users: ${users.length}  leads: ${leads.length}`);

  const docGrants = new Map<string, number>();
  for (const lead of leads) {
    for (const perm of (lead.$permissions as string[]) ?? []) {
      const match = /^read\("user:([^"]+)"\)$/.exec(perm);
      if (match) docGrants.set(match[1], (docGrants.get(match[1]) ?? 0) + 1);
    }
  }

  // The baseline stores a truncated SHA-256 of each Appwrite document id rather
  // than the id itself, so the committed fixture carries no production
  // identifiers. Recompute the same hash here to line the two up.
  const hashId = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 16);

  const current = new Map(
    users.map((u) => [
      hashId(u.$id),
      {
        role: u.role,
        owned: leads.filter((l) => l.ownerId === u.$id).length,
        assigned: leads.filter((l) => l.assignedToId === u.$id).length,
        app: appVisibleCount(u, users, leads),
        doc: docGrants.get(u.$id) ?? 0,
      },
    ])
  );

  const problems: string[] = [];

  if (leads.length !== baseline.totals.leads) {
    problems.push(
      `lead count changed: baseline ${baseline.totals.leads}, now ${leads.length}. ` +
        `Re-capture the baseline if this is expected churn.`
    );
  }

  for (const expected of baseline.users) {
    const actual = current.get(expected.idHash);
    if (!actual) {
      problems.push(`${expected.label} (${expected.idHash}) is missing from the users collection`);
      continue;
    }
    for (const field of ['owned', 'assigned', 'app', 'doc'] as const) {
      if (String(actual[field]) !== String(expected[field])) {
        problems.push(
          `${String(expected.label).padEnd(18)} ${field.padEnd(9)} baseline=${String(expected[field]).padStart(6)} now=${String(actual[field]).padStart(6)}`
        );
      }
    }
    current.delete(expected.idHash);
  }

  for (const [idHash, row] of current) {
    problems.push(`new user not in baseline: ${idHash} (${row.role})`);
  }

  if (problems.length === 0) {
    console.log(`\nPARITY OK - all ${baseline.users.length} users match the baseline exactly.`);
    console.log('owned / assigned / app / doc are unchanged.');
    return;
  }

  console.error(`\nPARITY FAILED - ${problems.length} difference(s):\n`);
  for (const p of problems) console.error('  ' + p);
  console.error('\nDo not proceed with the permission change until these are explained.');
  process.exit(1);
}

main().catch((error) => {
  console.error('verify-lead-visibility-parity failed:', error);
  process.exit(2);
});
