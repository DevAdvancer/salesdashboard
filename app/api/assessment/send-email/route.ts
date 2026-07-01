import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAccount } from "@/lib/server/current-user";
import { cookies } from "next/headers";
import {
  SUPPORT_EMAIL_MAX_JSON_PAYLOAD_BYTES,
  SUPPORT_EMAIL_MAX_JSON_PAYLOAD_LABEL,
} from "@/lib/utils/support-email-attachments";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Internal Server Error";
}

export async function POST(request: NextRequest) {
  try {
    // Enforce authentication via Appwrite session
    await getAuthenticatedAccount();

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > SUPPORT_EMAIL_MAX_JSON_PAYLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `Support email payload is too large. Keep combined attachments under ${SUPPORT_EMAIL_MAX_JSON_PAYLOAD_LABEL} after encoding.`,
        },
        { status: 413 },
      );
    }

    // Get the Outlook access token stored during Azure OAuth login
    const cookieStore = await cookies();
    const accessTokenCookie = cookieStore.get("outlook_access_token");

    if (!accessTokenCookie?.value) {
      return NextResponse.json(
        { error: "Not connected to Outlook. Please connect your Outlook account first." },
        { status: 401 },
      );
    }

    const accessToken = accessTokenCookie.value;

    const payload = await request.json();
    const { message, saveToSentItems } = payload;

    if (!message) {
      return NextResponse.json({ error: "Invalid payload: missing message" }, { status: 400 });
    }

    // Send via Microsoft Graph API
    const graphPayload = {
      message,
      saveToSentItems: saveToSentItems ?? "true",
    };

    const graphResponse = await fetch(
      "https://graph.microsoft.com/v1.0/me/sendMail",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(graphPayload),
      },
    );

    if (!graphResponse.ok) {
      let errorDetail = "Failed to send email via Microsoft Graph";
      try {
        const errJson = await graphResponse.json();
        errorDetail = errJson?.error?.message ?? errorDetail;
      } catch {
        // ignore parse failure
      }
      return NextResponse.json({ error: errorDetail }, { status: graphResponse.status });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Error sending assessment email:", error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
