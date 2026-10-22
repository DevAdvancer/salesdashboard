import { NextRequest, NextResponse } from 'next/server';
import { Query, Storage, Client } from 'node-appwrite';
import { BUCKETS, COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { crmAccessEnabled, securityDatabase } from '@/lib/server/crm-access';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || request.headers.get('x-cron-secret');
  if (!expected || provided !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!crmAccessEnabled()) return NextResponse.json({ skipped: true });
  try {
    const databases = securityDatabase();
    const rows = await listAllDocuments<{ $id: string; data: string }>({ databases, databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.SECURITY_CHALLENGES,
      queries: [Query.lessThanEqual('expiresAt', new Date().toISOString()), Query.select(['$id', 'data'])],
    });
    const storage = new Storage(new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
      .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!).setKey(process.env.APPWRITE_API_KEY!));
    for (const row of rows) {
      const data = JSON.parse(row.data);
      if (data.kind === 'resume-upload') for (const part of data.parts as string[]) {
        try { await storage.deleteFile(BUCKETS.RESUMES, part); }
        catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
      }
      await databases.deleteDocument(DATABASE_ID, COLLECTIONS.SECURITY_CHALLENGES, row.$id);
    }
    return NextResponse.json({ ok: true, deleted: rows.length });
  } catch { return NextResponse.json({ error: 'Security cleanup could not complete.' }, { status: 503 }); }
}
