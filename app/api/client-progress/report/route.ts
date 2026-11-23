import { z } from 'zod';
import type { Models } from 'node-appwrite';
import { canManageProgress } from '@/lib/client-progress';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { getProgressReportClients, getProgressReportFeedback, getProgressReportSummary, progressReportCsv } from '@/lib/server/client-progress-report';
import { crmAccessEnabled } from '@/lib/server/crm-access';
import { withCrmRequestContext } from '@/lib/server/crm-request-context';
import { getAuthenticatedAccount, getAuthenticatedUserDoc } from '@/lib/server/current-user';
import type { User } from '@/lib/types';

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,35}$/);
const range = z.strictObject({ from: z.iso.date(), to: z.iso.date() }).refine(value => value.from <= value.to);
const inputSchema = z.discriminatedUnion('view', [
  z.strictObject({ view: z.literal('summary'), range }),
  z.strictObject({ view: z.literal('person'), range, authorId: id }),
  z.strictObject({ view: z.literal('feedback'), range, authorId: id, entryId: id, cursor: id.optional() }),
  z.strictObject({ view: z.literal('export'), range, authorId: id.optional(), search: z.string().trim().max(200).optional() }),
]);
const headers = { 'Cache-Control': 'private, no-store' };

function csvResponse(rows: AsyncGenerator<string>, filename: string) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const row = await rows.next();
        if (cancelled) return;
        if (row.done) controller.close();
        else controller.enqueue(encoder.encode(row.value));
      } catch (error) {
        if (!cancelled) throw error;
      }
    },
    async cancel() {
      cancelled = true;
      await rows.return(undefined);
    },
  });
  return new Response(body, { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"` } });
}

export async function POST(request: Request) {
  return withCrmRequestContext(async () => {
    const db = (await createAdminClient()).databases.uncachedReads;
    const actor = await (async () => {
      if (crmAccessEnabled()) return getAuthenticatedUserDoc();
      const account = await getAuthenticatedAccount();
      return db.getDocument<Models.Document & Pick<User, 'role' | 'department' | 'isActive'>>(
        DATABASE_ID, COLLECTIONS.USERS, account.$id,
      );
    })().catch(() => null);
    if (!actor || !canManageProgress(actor)) {
      return Response.json({ error: 'Only Sales Admin can view Client Progress reports.' }, { status: 403, headers });
    }

    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: 'Check the report dates and filters.' }, { status: 400, headers });
    const input = parsed.data;
    try {
      switch (input.view) {
        case 'summary':
          return Response.json(await getProgressReportSummary(db, input.range), { headers });
        case 'person':
          return Response.json(await getProgressReportClients(db, input.range, input.authorId), { headers });
        case 'feedback':
          return Response.json(await getProgressReportFeedback(db, input.range, input.authorId, input.entryId, input.cursor), { headers });
        case 'export':
          return csvResponse(progressReportCsv(db, input.range, input.authorId, input.search), `client-progress-${input.range.from}-to-${input.range.to}.csv`);
      }
    } catch {
      return Response.json({ error: 'Could not load the report. Try again or choose a shorter date range.' }, { status: 500, headers });
    }
  });
}
