import { NextResponse, type NextRequest } from "next/server";
import { Query } from "node-appwrite";
import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { createNotificationsForRecipients } from "@/lib/server/notifications";

function getAuthorizationToken(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isAuthorized(request: NextRequest): { authorized: boolean; debug?: any } {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const providedToken = getAuthorizationToken(request);
  const providedHeader = request.headers.get('x-cron-secret');
  const provided = providedToken ?? providedHeader;
  
  if (!expected) {
    return { authorized: false, debug: { reason: 'No CRON_SECRET in env' } };
  }
  
  const authorized = Boolean(provided) && provided === expected;
  if (!authorized) {
    return { 
      authorized: false, 
      debug: { 
        reason: 'Mismatch', 
        hasAuthHeader: !!authHeader,
        providedLength: provided?.length,
        expectedLength: expected?.length
      } 
    };
  }
  
  return { authorized: true };
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = isAuthorized(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: "Unauthorized", debug: auth.debug }, { status: 401 });
  }

  try {
    const { databases } = await createAdminClient();

    const response = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.LINKEDIN_REQUESTS,
      [
        Query.equal("isActive", true),
        Query.equal("status", ["sent", "accepted"]),
        Query.limit(5000)
      ]
    );

    const activeAgentIds = new Set<string>();
    
    for (const doc of response.documents) {
      if (doc.agentId) {
        activeAgentIds.add(doc.agentId);
      }
    }

    if (activeAgentIds.size > 0) {
      await createNotificationsForRecipients(databases, Array.from(activeAgentIds), {
        type: 'linkedin_friday_warning',
        title: 'LinkedIn Withdrawal Warning',
        body: 'Monday auto withdraw will run soon. Please review and process your active LinkedIn connections.',
      });
    }

    return NextResponse.json({
      success: true,
      agentsNotified: activeAgentIds.size,
    });
  } catch (error: any) {
    console.error("Friday warning error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
