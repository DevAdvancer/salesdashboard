import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAccount } from "@/lib/server/current-user";
import { Resend } from "resend";
import {
  SUPPORT_EMAIL_MAX_JSON_PAYLOAD_BYTES,
  SUPPORT_EMAIL_MAX_JSON_PAYLOAD_LABEL,
} from "@/lib/utils/support-email-attachments";

const resend = new Resend(process.env.RESEND_API_KEY || "re_xxxxxxxxx");

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

    const payload = await request.json();
    const { message } = payload;

    if (!message) {
      return NextResponse.json({ error: "Invalid payload: missing message" }, { status: 400 });
    }

    const to = message.toRecipients?.map((r: any) => r.emailAddress.address) || [];
    const cc = message.ccRecipients?.map((r: any) => r.emailAddress.address) || [];
    const subject = message.subject || "";
    const html = message.body?.contentType?.toUpperCase() === "HTML" ? message.body.content : undefined;
    const text = message.body?.contentType?.toUpperCase() !== "HTML" ? message.body.content : undefined;

    const attachments = message.attachments?.map((att: any) => ({
      filename: att.name,
      content: Buffer.from(att.contentBytes, "base64"),
    })) || [];

    const fromEmail = process.env.RESEND_FROM_EMAIL || "Acme <onboarding@resend.dev>";

    const sendOptions: any = {
      from: fromEmail,
      to,
      subject,
    };

    if (cc.length > 0) {
      sendOptions.cc = cc;
    }

    if (html !== undefined) {
      sendOptions.html = html;
    } else if (text !== undefined) {
      sendOptions.text = text;
    }

    if (attachments.length > 0) {
      sendOptions.attachments = attachments;
    }

    const { data, error } = await resend.emails.send(sendOptions);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    console.error("Error sending interview email:", error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
