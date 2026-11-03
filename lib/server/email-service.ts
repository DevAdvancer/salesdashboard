/**
 * Email service using Microsoft Graph API (Outlook / Microsoft 365).
 *
 * Uses the existing Azure AD app registration (client_credentials flow)
 * with the Mail.Send application permission already granted.
 *
 * Sends from the acting user's mailbox.
 * Always BCCs abhirupvizva@gmail.com (or DUPLICATE_ALERT_BCC_EMAIL env var).
 */

import dotenv from 'dotenv';
import path from 'path';
import { createAdminClient } from '@/lib/server/appwrite';
import { excludeInactiveUserEmails } from '@/lib/server/active-email-recipients';
import { renderCrmEmail } from '@/lib/utils/crm-email-template';
import { CRM_PUBLIC_URL } from '@/lib/server/crm-url';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const TENANT_ID = process.env.NEXT_PUBLIC_AZURE_TENANT_ID!;
const CLIENT_ID = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;
const BCC_EMAIL =
  process.env.DUPLICATE_ALERT_BCC_EMAIL ?? 'Abhirup.Kumar@vizvainc.com';

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
      const leadLink = `${CRM_PUBLIC_URL}/leads/${encodeURIComponent(w.existingLeadId)}`;
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #39393b;color:#ffffff;font-weight:600;">${label}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #39393b;">
            <a href="${leadLink}" style="color:#3b82f6;text-decoration:underline;">
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
    clientLinkedinUrl ? `<strong>LinkedIn:</strong> <a href="${clientLinkedinUrl}" style="color:#3b82f6;">${clientLinkedinUrl}</a>` : null,
  ]
    .filter(Boolean)
    .join('<br/>');

  return `<p><strong>${actorName}</strong> was blocked while ${contextLabel} a lead because the following fields already exist in the system. This client has triggered <strong>${attemptText}</strong> total.</p>
    ${clientDetails ? `<div style="background:#18181b;border:1px solid #39393b;border-radius:12px;padding:16px;margin-bottom:20px;">${clientDetails}</div>` : ''}
    <table cellpadding="0" cellspacing="0"><thead><tr><th>Duplicate Field</th><th>Existing Lead</th></tr></thead><tbody>${duplicateRows}</tbody></table>
    <p style="margin-top:20px;color:#9e9ea0;">The acting user has not been notified via this email.</p>`;
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
        `  ${FIELD_LABELS[w.field] ?? w.field}: ${CRM_PUBLIC_URL}/leads/${encodeURIComponent(w.existingLeadId)}`,
    ),
  ];
  return lines.filter((l) => l !== undefined).join('\n');
}

/**
 * Send a duplicate lead alert email via Microsoft Graph.
 * - Sends FROM the acting user's mailbox
 * - Sends TO all admins + team leads (excluding the acting user)
 * - BCCs Abhirup.Kumar@vizvainc.com
 */
export async function sendDuplicateAlertEmail(
  input: DuplicateAlertEmailInput,
): Promise<void> {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    console.warn('[email-service] Azure credentials not configured, skipping email.');
    return;
  }

  // Filter out the acting user and the dummy emails from recipients
  const eligibleEmails = await excludeInactiveUserEmails((await createAdminClient()).databases, input.recipientEmails);
  const toEmails = eligibleEmails.filter(
    (e) => 
      e.toLowerCase() !== input.actorEmail.toLowerCase() && 
      e.toLowerCase() !== 'teamlead@silverspaceinc.com' &&
      e.toLowerCase() !== 'unassigned@silverspaceinc.com'
  );

  const bccEmails = await excludeInactiveUserEmails((await createAdminClient()).databases, [BCC_EMAIL]);

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
        content: renderCrmEmail({ title: subject, html: buildEmailHtml(input), crmUrl: CRM_PUBLIC_URL }),
      },
      toRecipients: toEmails.map((email) => ({
        emailAddress: { address: email },
      })),
      bccRecipients: bccEmails.map((email) => ({ emailAddress: { address: email } })),
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

import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export async function sendNotificationEmail({ to, subject, html, text, allowAllRecipients = false, attachments = [] }: {
  to: string; subject: string; html: string; text?: string; allowAllRecipients?: boolean;
  attachments?: Array<{ filename: string; content: string; contentType: string }>;
}) {
  const requested = to.split(',').map(e => e.trim()).filter(e => allowAllRecipients || (
    e.toLowerCase() !== 'unassigned@silverspaceinc.com' &&
    e.toLowerCase() !== 'teamlead@silverspaceinc.com'
  ));

  const toList = await excludeInactiveUserEmails((await createAdminClient()).databases, requested);
  if (toList.length === 0) {
    console.log(`[email-service] Skipping email to ${to} because all recipients are excluded.`);
    return null;
  }
  
  const filteredTo = toList.join(', ');

  console.log(`[email-service] Attempting to send email to ${filteredTo} with subject "${subject}"`);
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.error('[email-service] Email credentials not found in environment');
    return null;
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.GMAIL_USER,
      replyTo: process.env.GMAIL_USER,
      to: filteredTo,
      subject,
      html: renderCrmEmail({ title: subject, html, crmUrl: CRM_PUBLIC_URL }),
      text,
      attachments,
      xMailer: false, // Disables X-Mailer header to prevent Outlook from flagging as automated spam
      headers: {
        'X-Priority': '3',
        'X-MSMail-Priority': 'Normal',
        'Importance': 'Normal'
      }
    });
    console.log(`[email-service] Successfully sent email to ${filteredTo}. MessageId: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('[email-service] Nodemailer error:', error);
    return null;
  }
}
