import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertExtensionRequest, LinkedinExtensionError } from "@/lib/server/linkedin-extension-policy";
import { bootstrapLinkedinExtension, checkLinkedinExtension, recordLinkedinExtension } from "@/lib/server/linkedin-extension";
import { getMyLinkedinHelperAccessAction } from '@/app/actions/beta';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  operation: z.enum(["check", "history", "record"]),
  accountId: z.string().min(1).max(36),
  targetUrl: z.string().min(1).max(2048),
  revision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  confirmResend: z.boolean().default(false),
  expectedUserId: z.string().min(1).max(36).optional(),
}).strict();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  if (error instanceof LinkedinExtensionError) return json({ error: error.message }, error.status);
  // Never expose Appwrite scopes, document contents, or raw SDK diagnostics to the browser.
  return json({ error: "CRM could not complete the request. Retry, or contact your administrator." }, 500);
}

async function assertReleaseAccess(request: NextRequest) {
  // v1.7 has no channel header and keeps its existing permissions and API contract.
  if (request.headers.get('x-crm-extension-channel') === 'beta' && !await getMyLinkedinHelperAccessAction()) {
    throw new LinkedinExtensionError(403, 'Your account is not selected for the LinkedIn Helper beta. Use the v1.7 download from LinkedIn Requests.');
  }
}

export async function GET(request: NextRequest) {
  try { assertExtensionRequest(request); await assertReleaseAccess(request); return json(await bootstrapLinkedinExtension()); }
  catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertExtensionRequest(request);
    await assertReleaseAccess(request);
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      throw new LinkedinExtensionError(415, "Send a JSON request.");
    }
    const body = await request.text();
    if (body.length > 4096) throw new LinkedinExtensionError(413, "Request too large.");
    let parsed;
    try { parsed = JSON.parse(body); } catch { throw new LinkedinExtensionError(400, "Invalid JSON request."); }
    const validation = inputSchema.safeParse(parsed);
    if (!validation.success) throw new LinkedinExtensionError(400, "Invalid extension request.");
    const input = validation.data;
    if (input.operation === "record") {
      if (input.confirmResend && !input.revision) throw new LinkedinExtensionError(400, "Check the profile before confirming a resend.");
      return json(await recordLinkedinExtension(input));
    }
    return json(await checkLinkedinExtension(input, input.operation === "history"));
  } catch (error) { return failure(error); }
}
