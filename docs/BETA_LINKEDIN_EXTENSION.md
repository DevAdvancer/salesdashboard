# LinkedIn Conversations

General release begins on **November 21, 2026 at 9:00 AM EST** (`2026-11-21T14:00:00.000Z`, 7:30 PM IST). The release code must be deployed for the launch to take effect. Before that instant, individual grants under **Beta → LinkedIn Conversations** control access. At launch, every active Sales agent, team lead, and admin can use Accepted Connections and conversation exports. Individual grant controls retire and Beta leaves the navigation. Existing browser tabs update at the launch time.

Agents see their own invitations, team leads see their own and their team's, and admins can export across Sales. The agent who recorded an invitation can add messages after acceptance, including after the CRM archives the request on withdrawal. Each Friday at 9:00 AM Eastern, eligible senders with invitations that week receive their own Excel report. After launch, recipients include eligible users without beta grants.

Conversation exports and the conversation-enabled LinkedIn Reports export use one worksheet per sender. Admin workbooks give each agent and team lead a separate sheet. Team leads export their own and their team's requests, with the selected admin team filter applied when present. Worksheets show sender and Main/Sudo account names, company, profile URL, dates, status, invitation text, and conversation. Internal conversation, request, CRM sender, and LinkedIn account document IDs are omitted.

LinkedIn Requests offers **LinkedIn Helper v2.2.0** at launch. Download, extract, and reload the new extension, then refresh accounts or reopen its popup. Check the profile in the extension, send the invitation manually on LinkedIn, then paste the exact invitation text into the extension before recording it. Recording preserves the clipboard contents for conversation-enabled accounts. Older extension builds receive guidance to update and enter invitation text when needed. **Connection Accepted** updates the request on the same page so agents can continue accepting other requests. Use **Open conversation** to view the saved thread and **Accepted Connections** for conversation exports. The workbook contains the invitation and its saved messages, with Eastern date filters by sent or accepted date.

## Appwrite rollout

Preview the schema with the deployment's Appwrite settings and review the proposed changes before applying.

```powershell
bun run setup:linkedin-conversations:dry
bun run setup:linkedin-conversations:apply
```

If the preview reports that `beta_feature_access` is missing, use `bun run setup:beta-access:dry` and review the preview before running `bun run setup:beta-access:apply`. Apply the conversation schema before granting access. Invitation text and follow-ups live in a server-only collection. The optional request field identifies the current invitation attempt. Resends retain the previous attempt under its original sender and team.

## Extension package

At launch, LinkedIn Requests links to `public/downloads/crm-hub-linkedin-helper-2.2.0-chrome.zip` for eligible extension users. Before launch, beta users receive v2.1.1 and standard users receive v2.0.0. Build the package with `bun run zip` in `extensions/linkedin-helper`, then copy the generated ZIP from `.output` to `public/downloads`. The version detected in the CRM tab comes from the extension manifest. The server checks release time and user eligibility on bootstrap and recording. The `conversationsBeta` response field remains available for installed v2.1 helpers and represents conversation access after launch.
