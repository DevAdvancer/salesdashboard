# LinkedIn Conversations

LinkedIn Conversations is available through normal Sales-role permissions as soon as this version is deployed. The admin-only Beta page remains in navigation and shows "No new features are currently in beta." Grant controls and the release-date gate are removed. Old grant/revoke actions permanently reject requests from stale tabs.

Sales agents, senior team leads, and lead generation users can work with their own conversations. Team leads can read their own and their team's requests. Admins, developers, monitors, and Operations have leadership read visibility across Sales. Operations conversation access is read-only. The original sender adds follow-ups after acceptance, including after a request is archived on withdrawal. Every Friday at 9:00 AM Eastern, eligible senders with invitations that week receive their own Excel report.

Conversation exports and the conversation-enabled LinkedIn Reports export use one worksheet per sender. Admin workbooks give each agent and team lead a separate sheet. Team leads export their own and their team's requests, with the selected admin team filter applied when present. Worksheets show sender and Main/Sudo account names, company, profile URL, dates, status, invitation text, and conversation. Internal conversation, request, CRM sender, and LinkedIn account document IDs are omitted.

LinkedIn Requests offers **LinkedIn Helper v2.2.1** to every eligible extension user. Download, extract, and reload the new extension, then refresh accounts or reopen its popup. Check the profile in the extension, send the invitation manually on LinkedIn, then paste the exact invitation text (up to 2,300 characters) into the extension before recording it. Recording preserves the clipboard contents for conversation-enabled accounts. Older extension builds receive guidance to update and enter invitation text when needed. **Connection Accepted** updates the request on the same page so agents can continue accepting other requests. Use **Open conversation** to view the saved thread and **Accepted Connections** for conversation exports. The workbook contains the invitation and its saved messages, with Eastern date filters by sent or accepted date.

## Appwrite rollout

Preview the schema with the deployment's Appwrite settings and review the proposed changes before applying.

```powershell
bun run setup:linkedin-conversations:dry
bun run setup:linkedin-conversations:apply
```

Apply the conversation schema before using the feature. Invitation text and follow-ups live in a server-only collection. The optional request field identifies the current invitation attempt. Resends retain the previous attempt under its original sender and team.

## Extension package

LinkedIn Requests links to `public/downloads/crm-hub-linkedin-helper-2.2.1-chrome.zip` for every eligible extension user. Build the package with `bun run zip` in `extensions/linkedin-helper`, then copy the generated ZIP from `.output` to `public/downloads`. The version detected in the CRM tab comes from the extension manifest. The server checks user eligibility on bootstrap and recording. The `conversationsBeta` response field remains for compatibility with installed helpers and represents ordinary conversation access.
