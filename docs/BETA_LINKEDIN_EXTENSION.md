# LinkedIn Helper beta rollout

The Beta page is visible to active CRM admins. It lists active Sales users whose roles can use LinkedIn Requests. An admin can enable or remove each user's extension access. The CRM server checks the saved choice on every extension request, including account loading, history checks, and recording.

## Schema

The feature uses `beta_feature_access` in the CRM Appwrite database. Each record stores `feature`, `userId`, and `enabled`; a unique index covers `(feature, userId)`. The collection is read and written only through authenticated server code using the admin Appwrite client.

Run the scoped dry run before applying the schema:

```powershell
bun run setup:beta-access:dry
bun run setup:beta-access:apply
```

The general `setup:appwrite` command may propose other schema and backfill changes. Use the scoped command for this rollout. Apply the schema before deploying the CRM code, because the new server gate defaults to denying access until an enabled record exists.

## Extension package

The bundled version is 1.6.0 at `public/downloads/crm-hub-linkedin-helper-1.6.0-chrome.zip`. The CRM's installation guide links to that file. When replacing it in a later release, build the extension with `bun run zip` in `extensions/linkedin-helper`, copy the generated ZIP into `public/downloads`, and update the version in the guide.

The extension publishes its version to the connected CRM tab. The LinkedIn Requests page labels the current build as detected, an older reporting build as needing an update, and an older build with no version signal as not detected. This browser status is only a local visual aid; the server allowlist controls CRM access.
