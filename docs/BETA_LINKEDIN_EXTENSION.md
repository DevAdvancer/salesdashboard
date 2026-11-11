# LinkedIn Conversations beta

Admins manage individual grants under **Beta → LinkedIn Conversations**. The `linkedin-conversations` feature is available to active Sales agents, team leads, and admins. A grant enables Accepted Connections and conversation exports. Agents see their own invitations, team leads see their own and their team's, and admins can export across Sales. The agent who recorded an invitation can add messages after acceptance, including after the CRM archives the request on withdrawal.

Granted agents and team leads can download LinkedIn Helper v2.1.0 from **LinkedIn Requests**. Check the profile in the extension, send the invitation manually on LinkedIn, then paste the exact invitation text into the extension before recording it. **Connection Accepted** opens the conversation in CRM. The workbook contains the invitation and its saved messages, with Eastern date filters by sent or accepted date.

## Appwrite rollout

Preview the schema with the deployment's Appwrite settings and review the proposed changes before applying.

```powershell
bun run setup:linkedin-conversations:dry
bun run setup:linkedin-conversations:apply
```

If the preview reports that `beta_feature_access` is missing, use `bun run setup:beta-access:dry` and review the preview before running `bun run setup:beta-access:apply`. Apply the conversation schema before granting access. Invitation text and follow-ups live in a server-only collection. The optional request field identifies the current invitation attempt. Resends retain the previous attempt under its original sender and team.

## Extension package

LinkedIn Requests links to `public/downloads/crm-hub-linkedin-helper-2.1.0-chrome.zip` for beta users and the v2.0.0 package for standard users. Build the package with `bun run zip` in `extensions/linkedin-helper`, then copy the generated ZIP from `.output` to `public/downloads`. The version detected in the CRM tab comes from the extension manifest. The server reads the individual grant when bootstrapping the popup and recording an invitation.
