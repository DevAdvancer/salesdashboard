import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthenticatedAccount } from "@/lib/server/current-user";
import { readErrorResponseMessage } from "@/lib/utils/http-error-response";
import {
  SUPPORT_EMAIL_MAX_JSON_PAYLOAD_BYTES,
  SUPPORT_EMAIL_MAX_JSON_PAYLOAD_LABEL,
} from "@/lib/utils/support-email-attachments";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal Server Error';
}

export async function POST(request: NextRequest) {
  try {
    await getAuthenticatedAccount();
    const cookieStore = await cookies();
    const token = cookieStore.get("outlook_access_token");

    if (!token || !token.value) {
      return NextResponse.json({ error: "Not connected to Outlook" }, { status: 401 });
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > SUPPORT_EMAIL_MAX_JSON_PAYLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `Support email payload is too large. Keep combined attachments under ${SUPPORT_EMAIL_MAX_JSON_PAYLOAD_LABEL} after encoding.`,
        },
        { status: 413 },
      );
    }

    const payload = await request.json();

    const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.value}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(await readErrorResponseMessage(response, 'Failed to send email via Graph API'));
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error sending assessment email:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
