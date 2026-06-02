/**
 * Email service using Microsoft Graph API (Outlook / Microsoft 365).
 *
 * Uses the existing Azure AD app registration (client_credentials flow)
 * with the Mail.Send application permission already granted.
 *
 * Sends from the acting user's mailbox.
 * Always BCCs abhirupvizva@gmail.com (or DUPLICATE_ALERT_BCC_EMAIL env var).
 */

const TENANT_ID = process.env.NEXT_PUBLIC_AZURE_TENANT_ID!;
const CLIENT_ID = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;
const BCC_EMAIL =
  process.env.DUPLICATE_ALERT_BCC_EMAIL ?? 'abhirupvizva@gmail.com';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:5000';

const GRAPH_TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

/** Acquire an app-only access token using client_credentials flow */
async function getGraphAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: GRAPH_SCOPE,
  });

  const res = await fetch(GRAPH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to acquire Graph token: ${res.status} ${text}`);
  }

  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export interface DuplicateAlertEmailInput {
  /** Email address of the acting user — used as sender AND excluded from recipients */
  actorEmail: string;
  actorName: string;

  /** The lead ID that was being created/edited */
  leadId: string;

  /** Client details for the email body */
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientLinkedinUrl?: string;

  /** Which fields were flagged as duplicates */
  duplicateFields: Array<{
    field: 'email' | 'phone' | 'linkedinProfileUrl';
    existingLeadId: string;
  }>;

  /** How many times this client has triggered a duplicate in the past */
  attemptCount: number;

  /** List of recipient emails (admins + TLs), actor email will be filtered out */
  recipientEmails: string[];

  /** 'create' or 'update' — shown in the subject line */
  context: 'create' | 'update';
}

const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  phone: 'Phone',
  linkedinProfileUrl: 'LinkedIn Profile URL',
};

function buildEmailHtml(input: DuplicateAlertEmailInput): string {
  const { actorName, clientName, clientEmail, clientPhone, clientLinkedinUrl, duplicateFields, attemptCount, context } =
    input;

  const contextLabel = context === 'create' ? 'creating' : 'editing';
  const attemptText =
    attemptCount === 1
      ? '1 duplicate attempt'
      : `${attemptCount} duplicate attempts`;

  const duplicateRows = duplicateFields
    .map((w) => {
      const label = FIELD_LABELS[w.field] ?? w.field;
      const leadLink = `${APP_URL}/leads/${encodeURIComponent(w.existingLeadId)}`;
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-weight:600;">${label}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
            <a href="${leadLink}" style="color:#4f46e5;text-decoration:underline;">
              View existing lead →
            </a>
          </td>
        </tr>`;
    })
    .join('');

  const clientDetails = [
    clientName ? `<strong>Name:</strong> ${clientName}` : null,
    clientEmail ? `<strong>Email:</strong> ${clientEmail}` : null,
    clientPhone ? `<strong>Phone:</strong> ${clientPhone}` : null,
    clientLinkedinUrl ? `<strong>LinkedIn:</strong> <a href="${clientLinkedinUrl}" style="color:#4f46e5;">${clientLinkedinUrl}</a>` : null,
  ]
    .filter(Boolean)
    .join('<br/>');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f9fafb;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:#dc2626;padding:20px 32px;">
              <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">
                ⚠️ Duplicate Lead ${context === 'create' ? 'Creation' : 'Update'} Blocked
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 32px;">
              <p style="margin:0 0 16px;color:#374151;font-size:15px;">
                <strong>${actorName}</strong> was blocked while ${contextLabel} a lead because the following fields already exist in the system.
                This client has triggered <strong>${attemptText}</strong> total.
              </p>

              <!-- Client Details -->
              ${clientDetails ? `
              <div style="background:#f3f4f6;border-radius:6px;padding:14px 16px;margin-bottom:20px;font-size:14px;color:#374151;line-height:1.7;">
                ${clientDetails}
              </div>` : ''}

              <!-- Duplicate Fields Table -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:20px;">
                <thead>
                  <tr style="background:#f9fafb;">
                    <th style="padding:10px 12px;text-align:left;font-size:13px;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;">Duplicate Field</th>
                    <th style="padding:10px 12px;text-align:left;font-size:13px;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;">Existing Lead</th>
                  </tr>
                </thead>
                <tbody>
                  ${duplicateRows}
                </tbody>
              </table>

              <p style="margin:0;font-size:13px;color:#9ca3af;">
                This is an automated alert. The acting user has <strong>not</strong> been notified via this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;font-size:12px;color:#9ca3af;">
              Sales CRM &mdash; Duplicate Lead Alert System
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildEmailText(input: DuplicateAlertEmailInput): string {
  const { actorName, clientName, clientEmail, clientPhone, duplicateFields, attemptCount, context } = input;
  const contextLabel = context === 'create' ? 'creating' : 'editing';
  const lines = [
    `Duplicate Lead ${context === 'create' ? 'Creation' : 'Update'} Blocked`,
    '',
    `${actorName} was blocked while ${contextLabel} a lead.`,
    `This client has triggered ${attemptCount} duplicate attempt(s) total.`,
    '',
    'Client Details:',
    clientName ? `  Name: ${clientName}` : '',
    clientEmail ? `  Email: ${clientEmail}` : '',
    clientPhone ? `  Phone: ${clientPhone}` : '',
    '',
    'Duplicate Fields:',
    ...duplicateFields.map(
      (w) =>
        `  ${FIELD_LABELS[w.field] ?? w.field}: ${APP_URL}/leads/${encodeURIComponent(w.existingLeadId)}`,
    ),
  ];
  return lines.filter((l) => l !== undefined).join('\n');
}

/**
 * Send a duplicate lead alert email via Microsoft Graph.
 * - Sends FROM the acting user's mailbox
 * - Sends TO all admins + team leads (excluding the acting user)
 * - BCCs abhirupvizva@gmail.com
 */
export async function sendDuplicateAlertEmail(
  input: DuplicateAlertEmailInput,
): Promise<void> {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    console.warn('[email-service] Azure credentials not configured, skipping email.');
    return;
  }

  // Filter out the acting user from recipients
  const toEmails = input.recipientEmails.filter(
    (e) => e.toLowerCase() !== input.actorEmail.toLowerCase(),
  );

  if (toEmails.length === 0) {
    console.warn('[email-service] No recipients after excluding actor, skipping email.');
    return;
  }

  let token: string;
  try {
    token = await getGraphAccessToken();
  } catch (err) {
    console.error('[email-service] Could not acquire Graph token:', err);
    return;
  }

  const subject =
    `⚠️ Duplicate Lead ${input.context === 'create' ? 'Creation' : 'Update'} Blocked` +
    (input.clientName ? ` — ${input.clientName}` : '');

  const mailPayload = {
    message: {
      subject,
      body: {
        contentType: 'HTML',
        content: buildEmailHtml(input),
      },
      toRecipients: toEmails.map((email) => ({
        emailAddress: { address: email },
      })),
      bccRecipients: [
        { emailAddress: { address: BCC_EMAIL } },
      ],
    },
    saveToSentItems: false,
  };

  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(input.actorEmail)}/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mailPayload),
      },
    );

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[email-service] Graph sendMail failed: ${res.status} ${errorText}`);
    } else {
      console.log(`[email-service] Duplicate alert email sent from ${input.actorEmail} to ${toEmails.length} recipient(s).`);
    }
  } catch (err) {
    console.error('[email-service] Error sending duplicate alert email:', err);
  }
}
